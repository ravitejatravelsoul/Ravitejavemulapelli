import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getTask } from "../domain/tasks.ts";
import { getAgentRole } from "../domain/agent-roles.ts";
import { getProjectIdea } from "../domain/projects.ts";
import { listArtifactsForProject, createArtifact, createApproval, getApproval, recordDecision } from "../domain/project-outputs.ts";
import { listWorkspaceFileRecords } from "../domain/workspace.ts";
import { workspaceExists, readFile } from "../workspace/workspace-service.ts";
import { createIncident, updateIncident, findLatestIncidentFor, getIncident } from "../domain/office-incidents.ts";
import {
  createSemanticRepairPlan,
  updateSemanticRepairPlan,
  findLatestPlanForSignature,
  getSemanticRepairPlan,
  type SemanticRepairPlanRow,
} from "../domain/semantic-repair.ts";
import { detectSemanticFailureLoop, buildRepairPlan, type ClassificationEvidence } from "./semantic-failure-detection.ts";
import { checkSemanticRepairConsistency } from "./semantic-repair-consistency.ts";
import { recordEvent, recordAuditEntry } from "../domain/events.ts";
import { retryEscalatedTask } from "../control/task-transitions.ts";
import { executeTask, type ExecuteTaskResult } from "../agents/agent-runner.ts";
import { ClaudeAdapter, isClaudeConfigured } from "../providers/claude/claude-adapter.ts";
import type { TaskContext } from "../providers/types.ts";

/**
 * Office Engineer — semantic repair, Sections 2-5 of the follow-up
 * brief: given a detected semantic failure loop (semantic-failure-
 * detection.ts), gather the authoritative evidence, build and persist a
 * structured repair plan BEFORE touching anything, and — once an owner
 * explicitly approves it — run exactly one bounded, targeted repair
 * call through the SAME approval/budget/context-budget/usage-tracking/
 * retry-drift machinery every normal agent attempt already goes
 * through (via `executeTask`'s new `contextOverride`), never a
 * separate, weaker, or privileged paid path.
 */

export const SYMPTOM_SEMANTIC_REPAIR_REQUIRED = "semantic-repair-required";

/** The directly-affected files for a task — real attribution via workspace_files.lastModifiedByTaskId, never the whole workspace. This is what makes the repair context "targeted" rather than a dump of the whole project. */
async function loadAffectedFiles(db: DatabaseSync, projectId: string, taskId: string): Promise<Array<{ path: string; content: string }>> {
  if (!workspaceExists(projectId)) return [];
  const records = listWorkspaceFileRecords(db, projectId).filter((f) => f.lastModifiedByTaskId === taskId);
  const files: Array<{ path: string; content: string }> = [];
  for (const record of records) {
    try {
      files.push({ path: record.path, content: await readFile(projectId, record.path) });
    } catch {
      // File record exists but the file itself is gone — skip rather
      // than fail the whole evidence-gathering pass over one stale row.
    }
  }
  return files;
}

async function gatherEvidence(db: DatabaseSync, projectId: string, taskId: string, failureReasons: string[]): Promise<ClassificationEvidence> {
  const idea = getProjectIdea(db, projectId);
  const artifacts = listArtifactsForProject(db, projectId);
  const architecture = artifacts.filter((a) => a.type === "architecture").sort((a, b) => b.version - a.version)[0] ?? null;
  const code = artifacts.filter((a) => a.type === "code").sort((a, b) => b.version - a.version)[0] ?? null;
  const affectedFiles = await loadAffectedFiles(db, projectId, taskId);
  return {
    authoritativeUserRequest: idea?.rawText ?? "",
    architectureContent: architecture?.content ?? null,
    codeArtifactContent: code?.content ?? null,
    affectedFiles,
    failureReasons,
  };
}

export type ProposeSemanticRepairResult =
  | { status: "not-detected" }
  | { status: "already-in-flight"; plan: SemanticRepairPlanRow }
  | { status: "already-escalated"; plan: SemanticRepairPlanRow }
  | { status: "already-rejected"; plan: SemanticRepairPlanRow }
  | { status: "proposed"; plan: SemanticRepairPlanRow }
  | { status: "escalated-needs-owner"; plan: SemanticRepairPlanRow };

/**
 * DETECT -> CLASSIFY -> INSPECT -> DETERMINE SOURCE OF TRUTH -> BUILD
 * REPAIR PLAN, in one deterministic, free pass (no AI call). Safe to run
 * against ANY project, including a frozen/blocked one — this only ever
 * reads evidence and, at most, persists an incident + a PROPOSED plan
 * documenting the observation. It never touches a task's status, never
 * spends budget, and never applies a file change.
 */
/**
 * Requirement 1 of the state-consistency fix: an Office Engineer
 * incident must accurately reflect the currently-active repair cycle —
 * this must hold not only at the instant a NEW plan is created, but
 * every time `proposeSemanticRepair` runs and finds an ALREADY-ACTIVE
 * plan too. Without this, the exact real gap this closes: a plan
 * created before this fix existed (status PROPOSED) sits under an
 * incident still reading ESCALATED from a PRIOR, unrelated signature —
 * and every subsequent detection call would hit the dedup ("already-in-
 * flight") path, which never touched incident status at all, leaving
 * the inconsistency permanently unfixed even after this code shipped.
 * Idempotent and cheap: a no-op whenever the incident is already active.
 */
function ensureIncidentReflectsActivePlan(db: DatabaseSync, incident: import("../domain/office-incidents.ts").OfficeIncidentRow, plan: SemanticRepairPlanRow, actorId: string): import("../domain/office-incidents.ts").OfficeIncidentRow {
  const planIsActive = plan.status !== "ESCALATED" && plan.status !== "REJECTED";
  const incidentIsTerminal = incident.status === "ESCALATED" || incident.status === "RESOLVED";
  if (!planIsActive || !incidentIsTerminal) return incident;

  const previousStatus = incident.status;
  const reopened = updateIncident(db, incident.id, {
    status: "INVESTIGATING",
    diagnosis: `${incident.diagnosis} — Reopened: plan ${plan.id} (signature ${plan.failureSignature}) is active while the incident had been left ${previousStatus}. Prior plan/history is preserved unchanged.`,
    resolvedAt: null,
  });
  recordEvent(db, {
    projectId: plan.projectId,
    type: "office_engineer.incident_reopened",
    payload: { taskId: plan.taskId, incidentId: incident.id, planId: plan.id, previousStatus, newFailureSignature: plan.failureSignature },
    actor: actorId,
  });
  return reopened;
}

export async function proposeSemanticRepair(db: DatabaseSync, taskId: string, actorId = "office-engineer"): Promise<ProposeSemanticRepairResult> {
  const task = getTask(db, taskId);
  if (!task) return { status: "not-detected" };

  const loop = detectSemanticFailureLoop(db, task);
  if (!loop.detected) return { status: "not-detected" };

  const existing = findLatestPlanForSignature(db, taskId, loop.signature);
  if (existing) {
    // A repeat of an already-escalated or already-rejected signature
    // must never spawn a new, independent repair cycle — this is the
    // "second same-signature failure escalates" bound from Section 5,
    // enforced here at detection time as well as in the execution path.
    if (existing.status === "ESCALATED") return { status: "already-escalated", plan: existing };
    if (existing.status === "REJECTED") return { status: "already-rejected", plan: existing };
    const incidentForExisting = getIncident(db, existing.incidentId);
    if (incidentForExisting) ensureIncidentReflectsActivePlan(db, incidentForExisting, existing, actorId);
    return { status: "already-in-flight", plan: existing };
  }

  const evidence = await gatherEvidence(db, task.projectId, taskId, loop.semanticFailures.map((f) => f.reason));
  const plan = buildRepairPlan(evidence, loop.semanticFailures.map((f) => f.reason));

  // Reuses the SAME incident lineage for this task/symptom across its
  // whole repair history — including one that previously reached a
  // terminal state (ESCALATED or RESOLVED) — rather than fragmenting
  // into a fresh, disconnected row every time a new problem arises.
  let incident =
    findLatestIncidentFor(db, { projectId: task.projectId, taskId, symptom: SYMPTOM_SEMANTIC_REPAIR_REQUIRED }) ??
    createIncident(db, {
      symptom: SYMPTOM_SEMANTIC_REPAIR_REQUIRED,
      projectId: task.projectId,
      taskId,
      status: "INVESTIGATING",
      diagnosis: `Task "${task.title}" (role ${task.roleId}) has repeated a semantic (non-operational) failure ${loop.semanticFailures.length} time(s): ${plan.rootCause}`,
    });

  let estimatedRepairCostUsd: number | null = null;
  if (isClaudeConfigured() && plan.classification === "IMPLEMENTATION_WRONG") {
    const role = getAgentRole(db, task.roleId);
    if (role) {
      const context = buildTargetedRepairContext(task, evidence, plan);
      const adapter = new ClaudeAdapter();
      estimatedRepairCostUsd = adapter.estimateCost({ role: role.id, task: context, instructions: repairInstructions(plan) }).estimatedCostUsd;
    }
  }

  const planRow = createSemanticRepairPlan(db, {
    incidentId: incident.id,
    projectId: task.projectId,
    taskId,
    roleId: task.roleId,
    failureSignature: loop.signature,
    plan,
    estimatedRepairCostUsd,
  });

  recordEvent(db, {
    projectId: task.projectId,
    type: "office_engineer.semantic_repair_proposed",
    payload: { taskId, incidentId: incident.id, planId: planRow.id, classification: plan.classification, failureSignature: loop.signature },
    actor: actorId,
  });

  // State-consistency fix: a genuinely NEW plan means a genuinely active
  // repair cycle just started — an incident left over at a terminal
  // status (ESCALATED from a prior, unrelated failure signature, or
  // RESOLVED from a prior successful repair) must never keep showing
  // that stale status while a fresh PROPOSED plan sits active under it.
  // Reopening here, unconditionally and BEFORE any classification-
  // specific branch below, means every path (including the plain
  // IMPLEMENTATION_WRONG default, which had no other status-setting code
  // at all) starts from a correctly "active" incident; a branch below may
  // still re-escalate it immediately afterward (e.g.
  // OWNER_CLARIFICATION_REQUIRED), which is a real, honest state
  // transition, not the silent staleness this fixes.
  incident = ensureIncidentReflectsActivePlan(db, incident, getSemanticRepairPlan(db, planRow.id)!, actorId);

  if (plan.classification === "OWNER_CLARIFICATION_REQUIRED" || plan.classification === "BOTH_INCONSISTENT") {
    // Section 4: "If OWNER_CLARIFICATION_REQUIRED: STOP and surface the
    // question to the owner." A genuine architecture-vs-implementation
    // conflict (BOTH_INCONSISTENT) is the same kind of stop — neither
    // side can be safely assumed authoritative from static evidence
    // alone, so this never proceeds toward an automatic repair.
    updateIncident(db, incident.id, {
      status: "ESCALATED",
      diagnosis: `${incident.diagnosis} — ${plan.rootCause} This requires owner judgment, not an automatic repair.`,
    });
    updateSemanticRepairPlan(db, planRow.id, { status: "ESCALATED" });
    recordEvent(db, { projectId: task.projectId, type: "office_engineer.escalated", payload: { taskId, incidentId: incident.id, planId: planRow.id, reason: plan.rootCause }, actor: actorId });
    return { status: "escalated-needs-owner", plan: getSemanticRepairPlan(db, planRow.id)! };
  }

  if (plan.classification === "ARCHITECTURE_STALE") {
    // Section 6: "create an auditable architecture-remediation path
    // before code changes." Reuses the EXISTING `major_architecture_
    // replacement` approval kind rather than inventing a parallel
    // approval mechanism — the owner reviews and approves/rejects this
    // exactly like any other approval-gated action in this codebase.
    const approval = createApproval(db, {
      projectId: task.projectId,
      taskId,
      kind: "major_architecture_replacement",
      requestedBy: actorId,
      context: {
        reason: `Office Engineer semantic-repair diagnosis: ${plan.rootCause}`,
        planId: planRow.id,
        incidentId: incident.id,
      },
    });
    updateSemanticRepairPlan(db, planRow.id, { architectureApprovalId: approval.id });
    updateIncident(db, incident.id, { status: "INVESTIGATING", diagnosis: `${incident.diagnosis} — awaiting owner approval to update the architecture artifact (approval ${approval.id}).` });
    recordEvent(db, { projectId: task.projectId, type: "office_engineer.architecture_remediation_requested", payload: { taskId, incidentId: incident.id, planId: planRow.id, approvalId: approval.id }, actor: actorId });
  }

  return { status: "proposed", plan: getSemanticRepairPlan(db, planRow.id)! };
}

/**
 * Section 6 — applied only once the `major_architecture_replacement`
 * approval `proposeSemanticRepair` created for an ARCHITECTURE_STALE
 * plan has actually been APPROVED. Records a NEW versioned architecture
 * artifact (the old version is never deleted or overwritten — real
 * history preserved, exactly like every other artifact revision in this
 * codebase) plus a decision explaining why, then reopens ONLY the
 * affected task for a fresh normal attempt against the corrected
 * architecture — every other task's status is left untouched ("invalidate
 * only dependent downstream work").
 */
export function applyApprovedArchitectureRemediation(db: DatabaseSync, planId: string, actorId: string, newArchitectureContent: string): SemanticRepairPlanRow {
  const plan = getSemanticRepairPlan(db, planId);
  if (!plan) throw new Error(`Semantic repair plan ${planId} does not exist.`);
  if (plan.classification !== "ARCHITECTURE_STALE") throw new Error(`Plan ${planId} is not an ARCHITECTURE_STALE plan.`);
  if (!plan.architectureApprovalId) throw new Error(`Plan ${planId} has no associated architecture-replacement approval.`);
  const approval = getApproval(db, plan.architectureApprovalId);
  if (!approval || approval.status !== "APPROVED") {
    throw new Error(`Architecture-replacement approval ${plan.architectureApprovalId} is not APPROVED — refusing to change the architecture artifact.`);
  }

  const priorVersions = listArtifactsForProject(db, plan.projectId).filter((a) => a.type === "architecture");
  const nextVersion = Math.max(0, ...priorVersions.map((a) => a.version)) + 1;
  createArtifact(db, { projectId: plan.projectId, taskId: plan.taskId, type: "architecture", content: newArchitectureContent, version: nextVersion });
  recordDecision(db, {
    projectId: plan.projectId,
    type: "decision",
    summary: `Architecture updated (v${nextVersion}) to resolve a semantic repair diagnosis.`,
    rationale: plan.rootCause,
    madeBy: actorId,
  });

  const task = getTask(db, plan.taskId);
  if (task && task.status === "BLOCKED") {
    retryEscalatedTask(db, task.id, actorId, `Office Engineer: architecture corrected (v${nextVersion}); rerunning implementation against it.`);
  }

  const updated = updateSemanticRepairPlan(db, planId, { status: "APPLIED", repairResult: `Architecture updated to v${nextVersion}; original task re-queued for a normal attempt.` });
  updateIncident(db, plan.incidentId, { status: "RESOLVED", resolvedAt: Date.now(), retryResult: `Architecture updated to v${nextVersion}.` });
  recordEvent(db, { projectId: plan.projectId, type: "office_engineer.architecture_remediation_applied", payload: { taskId: plan.taskId, planId, version: nextVersion }, actor: actorId });
  recordAuditEntry(db, { actor: actorId, action: "office_engineer.architecture_remediation_applied", targetType: "task", targetId: plan.taskId });
  return updated;
}

const REPAIR_PRESERVE_STANDARD =
  "This is a targeted patch, not a redesign. Preserve the current architecture contract. Modify only the files necessary to satisfy the exact reported failure. Do not rename or reinvent established interfaces/classes/modules unless the failure genuinely requires it. Return complete, structured fileOperations for every file you change. Preserve already-working behavior in every file you are not required to change.";

function repairInstructions(plan: { rootCause: string; requiredChanges: string[] }): string {
  return [
    "Perform a targeted semantic repair for this task.",
    REPAIR_PRESERVE_STANDARD,
    `Root cause: ${plan.rootCause}`,
    `Required change(s): ${plan.requiredChanges.join(" ")}`,
  ].join("\n");
}

/**
 * The small, hand-curated context Section 3 requires — authoritative
 * request, only the relevant architecture text, only the directly
 * affected files, and the exact failure being repaired. Deliberately
 * NOT `buildTaskContext()`'s normal output, which would include the
 * project's full scoped artifact/decision set. Pure and independently
 * testable (no DB access) — evidence/plan are already-gathered inputs.
 */
export function buildTargetedRepairContext(task: { id: string; projectId: string; roleId: string; title: string }, evidence: ClassificationEvidence, plan: { classification: string; rootCause: string; authoritativeContract: string; requiredChanges: string[]; mustPreserve: string[] }): TaskContext {
  return {
    projectId: task.projectId,
    taskId: task.id,
    roleId: task.roleId,
    taskTitle: task.title,
    projectSummary: "(semantic repair — see remediationContext for the full targeted brief)",
    authoritativeUserRequest: evidence.authoritativeUserRequest,
    projectTitle: "",
    relevantArtifacts: evidence.architectureContent ? [{ type: "architecture", content: evidence.architectureContent }] : [],
    relevantDecisions: [],
    relevantFiles: evidence.affectedFiles,
    remediationContext: {
      attemptNumber: 2, // always framed as a corrective attempt — the retry-drift gate must run for a repair call.
      failureReason: evidence.failureReasons[evidence.failureReasons.length - 1] ?? null,
      failingChecks: evidence.failureReasons,
      currentFiles: evidence.affectedFiles,
      preserveRequirements: [REPAIR_PRESERVE_STANDARD, `Authoritative contract: ${plan.authoritativeContract}.`, ...plan.mustPreserve].join(" "),
    },
  };
}

export function approveSemanticRepairPlan(db: DatabaseSync, planId: string, actorId: string): SemanticRepairPlanRow {
  const plan = getSemanticRepairPlan(db, planId);
  if (!plan) throw new Error(`Semantic repair plan ${planId} does not exist.`);
  if (plan.status !== "PROPOSED") throw new Error(`Plan ${planId} is "${plan.status}", not PROPOSED — nothing to approve.`);
  const updated = updateSemanticRepairPlan(db, planId, { status: "APPROVED" });
  recordEvent(db, { projectId: plan.projectId, type: "office_engineer.semantic_repair_approved", payload: { planId, taskId: plan.taskId }, actor: actorId });
  recordAuditEntry(db, { actor: actorId, action: "office_engineer.semantic_repair_approved", targetType: "task", targetId: plan.taskId });
  return updated;
}

export function rejectSemanticRepairPlan(db: DatabaseSync, planId: string, actorId: string, note?: string): SemanticRepairPlanRow {
  const plan = getSemanticRepairPlan(db, planId);
  if (!plan) throw new Error(`Semantic repair plan ${planId} does not exist.`);
  if (plan.status !== "PROPOSED") throw new Error(`Plan ${planId} is "${plan.status}", not PROPOSED — nothing to reject.`);
  const updated = updateSemanticRepairPlan(db, planId, { status: "REJECTED", repairResult: note ?? null });
  updateIncident(db, plan.incidentId, { status: "ESCALATED", retryResult: note ?? "Owner rejected the proposed repair plan." });
  recordEvent(db, { projectId: plan.projectId, type: "office_engineer.semantic_repair_rejected", payload: { planId, taskId: plan.taskId, note }, actor: actorId });
  recordAuditEntry(db, { actor: actorId, action: "office_engineer.semantic_repair_rejected", targetType: "task", targetId: plan.taskId });
  return updated;
}

export interface ExecuteApprovedRepairOptions {
  /** Test-injection point — same pattern as ExecuteTaskOptions.claudeClientOverride. Real (non-test) operation never sets this. */
  claudeClientOverride?: import("../providers/claude/claude-adapter.ts").ClaudeAdapterOptions["client"];
  /** Test-injection point for the semantic-repair-consistency check's own Ollama call (separate from `claudeClientOverride`, which only covers the main repair call) — lets a test prove the scoped-guard plumbing deterministically, without depending on whether a real Ollama server happens to be reachable. Real (non-test) operation never sets this. */
  intentCheckFetch?: typeof fetch;
}

export type SemanticRepairExecutionResult = { status: "repaired"; plan: SemanticRepairPlanRow; taskResult: ExecuteTaskResult } | { status: "failed"; plan: SemanticRepairPlanRow; reason: string };

/**
 * Section 5 — CONTROLLED REPAIR EXECUTION. Only proceeds for an
 * APPROVED, IMPLEMENTATION_WRONG plan. Exactly ONE bounded attempt: on
 * any outcome other than a genuine success, the plan moves to a
 * terminal ESCALATED state and is never automatically retried — a
 * repeat of the same failure signature will find this ESCALATED plan
 * via `proposeSemanticRepair`'s dedup check and refuse to spawn a new
 * cycle, rather than spending again.
 */
export async function executeApprovedSemanticRepair(db: DatabaseSync, planId: string, actorId: string, options: ExecuteApprovedRepairOptions = {}): Promise<SemanticRepairExecutionResult> {
  const plan = getSemanticRepairPlan(db, planId);
  if (!plan) throw new Error(`Semantic repair plan ${planId} does not exist.`);
  if (plan.status !== "APPROVED") {
    return { status: "failed", plan, reason: `Plan is "${plan.status}", not APPROVED — refusing to execute.` };
  }
  if (plan.classification !== "IMPLEMENTATION_WRONG") {
    return { status: "failed", plan, reason: `Classification "${plan.classification}" is not repaired through this path (ARCHITECTURE_STALE uses the architecture-remediation path; BOTH_INCONSISTENT/OWNER_CLARIFICATION_REQUIRED require owner input, never an automatic code repair).` };
  }

  const task = getTask(db, plan.taskId);
  if (!task) return { status: "failed", plan, reason: "Task no longer exists." };

  if (task.status === "BLOCKED") {
    const retry = retryEscalatedTask(db, task.id, actorId, `Office Engineer: granting a fresh, targeted attempt window for an approved semantic repair (plan ${plan.id}).`);
    if (!retry.ok) {
      updateSemanticRepairPlan(db, planId, { status: "ESCALATED", repairResult: retry.reason });
      updateIncident(db, plan.incidentId, { status: "ESCALATED", retryResult: retry.reason });
      return { status: "failed", plan: getSemanticRepairPlan(db, planId)!, reason: retry.reason };
    }
  } else if (task.status !== "PENDING") {
    return { status: "failed", plan, reason: `Task status is "${task.status}" — only a BLOCKED or PENDING task can receive a repair attempt.` };
  }

  const evidence = await gatherEvidence(db, task.projectId, task.id, [plan.rootCause]);
  const context = buildTargetedRepairContext(task, evidence, plan);

  updateSemanticRepairPlan(db, planId, { status: "REPAIRING" });
  updateIncident(db, plan.incidentId, { status: "REPAIRING", repairAction: "Targeted semantic repair call (one bounded attempt).", repairProvider: "claude" });
  recordEvent(db, { projectId: task.projectId, type: "office_engineer.semantic_repair_repairing", payload: { taskId: task.id, planId }, actor: actorId });

  // The generic whole-product retry-drift checker is deliberately
  // replaced for this one bounded call — see agent-runner.ts's
  // `retryDriftCheckOverride` docblock for the full incident this
  // closes. `authoritativeUserRequest` here is still the REAL whole
  // product request (from `evidence`, never redefined by the repair
  // contract); the plan's own fields are passed as a SEPARATE, narrower
  // scope constraint, never merged into one ambiguous string.
  const retryDriftCheckOverride: NonNullable<Parameters<typeof executeTask>[2]>["retryDriftCheckOverride"] = async (authoritativeUserRequest, currentFiles, proposedOperations, fetchImpl) => {
    const check = await checkSemanticRepairConsistency({
      authoritativeUserRequest,
      authoritativeContract: plan.authoritativeContract,
      allowedFilePaths: plan.affectedFiles,
      requiredChanges: plan.requiredChanges,
      mustPreserve: plan.mustPreserve,
      exactFailureReason: plan.rootCause,
      currentFiles,
      proposedOperations,
      fetchImpl,
    });
    // "unavailable" fails OPEN here, matching checkRetryDriftBeforeMaterialization's
    // own documented behavior for this exact checkpoint (a pre-write
    // safety net, not the final claim of correctness — real QA remains
    // authoritative) — only a real "inconsistent" verdict ever rejects.
    return check.outcome === "inconsistent" ? { consistent: false, reason: check.reason } : { consistent: true };
  };

  const taskResult = await executeTask(db, task.id, {
    contextOverride: context,
    retryDriftCheckOverride,
    claudeClientOverride: options.claudeClientOverride,
    intentCheckFetch: options.intentCheckFetch,
  });

  let actualRepairCostUsd: number | null = null;
  if (taskResult.agentRun) {
    const row = db.prepare("SELECT SUM(costUsd) as total FROM ai_usage WHERE agentRunId = ?").get(taskResult.agentRun.id) as { total: number | null } | undefined;
    actualRepairCostUsd = row?.total ?? null;
  }

  if (taskResult.outcome === "succeeded") {
    const resolved = updateSemanticRepairPlan(db, planId, { status: "VERIFIED", actualRepairCostUsd, repairResult: "The repaired task reached DONE through the normal pipeline (retry-drift-checked, fileOperations applied)." });
    updateIncident(db, plan.incidentId, { status: "RESOLVED", resolvedAt: Date.now(), retryResult: "Semantic repair succeeded; original task DONE." });
    recordEvent(db, { projectId: task.projectId, type: "office_engineer.semantic_repair_resolved", payload: { taskId: task.id, planId }, actor: actorId });
    recordAuditEntry(db, { actor: actorId, action: "office_engineer.semantic_repair_applied", targetType: "task", targetId: task.id });
    return { status: "repaired", plan: resolved, taskResult };
  }

  const reason = taskResult.reason ?? `Repair attempt outcome: ${taskResult.outcome}.`;
  const escalated = updateSemanticRepairPlan(db, planId, { status: "ESCALATED", actualRepairCostUsd, repairResult: reason });
  updateIncident(db, plan.incidentId, { status: "ESCALATED", retryResult: `The one bounded semantic repair attempt did not succeed: ${reason}` });
  recordEvent(db, { projectId: task.projectId, type: "office_engineer.escalated", payload: { taskId: task.id, planId, reason }, actor: actorId });
  return { status: "failed", plan: escalated, reason };
}
