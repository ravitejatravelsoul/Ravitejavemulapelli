import "server-only";
import type { DatabaseSync } from "node:sqlite";
// Relative + extension-explicit imports throughout this file — required
// for plain `node --test` resolution (see lib/ai-office/db/client.ts's
// comment) and, not incidentally, what makes this the *only* module
// that imports a provider adapter (docs/ai-office/09-budget-and-cost-controls.md
// §2's single-entry-point rule, verified by
// lib/ai-office/agents/__tests__/import-boundary.test.ts).
import {
  getTask,
  updateTaskStatus,
  createTaskAttempt,
  updateTaskAttemptStatus,
  createAgentRunForAttempt,
  updateAgentRunStatus,
  listTasksForProject,
  listTaskAttempts,
  getAgentRun,
  type TaskRow,
  type TaskAttemptRow,
  type AgentRunRow,
} from "../domain/tasks.ts";
import { getProject, updateProjectStatus, type ProjectRow } from "../domain/projects.ts";
import { getAgentRole, type AgentRoleRow } from "../domain/agent-roles.ts";
import {
  createArtifact,
  recordDecision,
  recordTestResult,
  recordFailure,
  listUnresolvedFailures,
  resolveFailure,
  listArtifactsForProject,
  createApproval,
  listApprovalsForProject,
} from "../domain/project-outputs.ts";
import { recordEvent } from "../domain/events.ts";
import { recordAiUsage } from "../domain/budget.ts";
import { refreshProjectMemory } from "../domain/project-memory.ts";
import { buildTaskContext } from "./context-builder.ts";
import { authorizeBudget } from "./budget-gate.ts";
import { isReviewRole, isDevelopmentRole, findRemediationTargets, findStaleDownstreamReviews } from "./remediation.ts";
import { checkIntentConsistency } from "./intent-consistency.ts";
import { SimulatedAdapter } from "../providers/simulated/simulated-adapter.ts";
import { OllamaAdapter } from "../providers/ollama/ollama-adapter.ts";
import { listInstalledOllamaModels } from "../providers/ollama/ollama-inventory.ts";
import type { AIProviderAdapter } from "../providers/types.ts";
import { LocalModelRouter, type ModelFailureContext } from "./model-router.ts";
import { routeProvider } from "./provider-router.ts";
import { ClaudeAdapter, isClaudeConfigured } from "../providers/claude/claude-adapter.ts";
import {
  authorizeBudget as authorizeLiveBudget,
  reconcileReservationWithUsage,
  releaseReservation,
  getBudgetSnapshot,
} from "../budget/budget-service.ts";
import { applyFileOperations } from "../workspace/apply-file-operations.ts";
import { workspaceExists, listFiles } from "../workspace/workspace-service.ts";
import { validateWorkspaceIntegrity, describeIntegrityFailure } from "../workspace/workspace-integrity.ts";
import { runQABrowserVerification } from "../workspace/qa-browser-verification.ts";
import { getWorkspace, listWorkspaceFileRecords, setDeliveryState } from "../domain/workspace.ts";

/**
 * AgentRunner — the central execution boundary between a claimed Task
 * and a provider adapter. Phase 4 scope only: `executeTask()` runs
 * exactly one already-PENDING task per call, driven directly by test
 * code (or, later, a test/dev harness) — no dispatch loop, no
 * eligibility-selection policy. See
 * docs/ai-office/04-agent-architecture.md §5 and the Phase 4 status
 * note in docs/ai-office/11-implementation-phases.md.
 */

export type ExecuteTaskOutcome = "not-eligible" | "budget-refused" | "claude-blocked" | "succeeded" | "retried" | "escalated";

export interface ExecuteTaskResult {
  outcome: ExecuteTaskOutcome;
  task: TaskRow;
  taskAttempt?: TaskAttemptRow;
  agentRun?: AgentRunRow;
  reason?: string;
}

/** Per-attempt bound on the adapter call — docs/ai-office/03-system-architecture.md §9.6's "generous default of 5 minutes." SimulatedAdapter never approaches this; it exists so a hung/slow provider (a real one, Phase 7+, or a test double) can never stall the Runner forever. */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

class AdapterTimeoutError extends Error {}

/**
 * Provider/execution failure vs. task/deliverable failure (follow-up
 * brief Part 17) — a real acceptance run showed a malformed-JSON
 * provider response and a 120s provider timeout each consume one of a
 * developer's real (small, 3-attempt) retry budget exactly like a
 * genuine bad implementation would, even though neither says anything
 * about whether the code itself was right. This function is the single
 * shared classifier: every reason string this codebase itself generates
 * for a pure infrastructure/protocol failure (never a role's own
 * reported failure, which is always semantic) matches one of these
 * patterns. Matched against *known, controlled* message prefixes this
 * codebase produces itself (OllamaConnectionError/OllamaTimeoutError/
 * AdapterTimeoutError/malformedResult's exact wording) — not a guess
 * against arbitrary free text, so this stays a precise, low-risk
 * classification rather than fragile string-sniffing.
 */
function isOperationalFailureReason(reason: string): boolean {
  return (
    /^Ollama request timed out/.test(reason) ||
    /^Could not reach Ollama/.test(reason) ||
    /^Ollama responded with HTTP/.test(reason) ||
    /Ollama's (HTTP response body|model output) was not valid JSON/.test(reason) ||
    /did not match the expected structured shape/.test(reason) ||
    /^Execution timed out after/.test(reason) ||
    /^Operational:/.test(reason)
  );
}

/** The real model the immediately preceding attempt for this task actually used, if any — how LocalModelRouter knows what to escalate past on a semantic retry (Part M). */
function getPreviousAttemptModel(db: DatabaseSync, taskId: string, currentAttemptNumber: number): string | null {
  if (currentAttemptNumber <= 1) return null;
  const previous = listTaskAttempts(db, taskId).find((a) => a.attemptNumber === currentAttemptNumber - 1);
  if (!previous?.agentRunId) return null;
  return getAgentRun(db, previous.agentRunId)?.model ?? null;
}

/**
 * Whether this attempt's model choice should escalate past whatever the
 * previous attempt used — role-agnostic (unlike RemediationContext, which
 * is development-role-only prompt content): a real *task/deliverable*
 * failure (QA rejection, bad implementation, review rejection) may
 * escalate; a purely operational hiccup (timeout, malformed JSON,
 * connection error) must not (Part M) — the SAME
 * `isOperationalFailureReason` classifier used for retry-budget
 * accounting decides which one this was, so the two concerns can never
 * silently disagree.
 */
function buildModelFailureContext(db: DatabaseSync, task: TaskRow, attemptNumber: number): ModelFailureContext | undefined {
  if (attemptNumber <= 1) return undefined;
  const lastFailureReason = listUnresolvedFailures(db, task.projectId)
    .filter((f) => f.taskId === task.id)
    .map((f) => f.reason)
    .pop();
  return {
    isSemanticFailure: lastFailureReason ? !isOperationalFailureReason(lastFailureReason) : true,
    previousModel: getPreviousAttemptModel(db, task.id, attemptNumber),
  };
}

/**
 * Development deliverable contract, part 1 (local multi-model routing
 * follow-up) — whether this task's PURPOSE is to implement/change real
 * files, derived from the task's own intent (its title), not bare
 * `role.id` alone: a future development-role task that isn't an
 * implementation task (e.g. "Review frontend code", "Investigate a
 * flaky test") must never be forced through the zero-fileOperations
 * gate below just because its role happens to be development. Today,
 * every task orchestrator.ts actually plans for frontend-developer/
 * backend-developer is titled "Implement <domain> — <idea title>"
 * (see orchestrator.ts's `titleFor` map) — this recognizes that same
 * intent generically, by pattern, rather than hardcoding a role id.
 */
function isImplementationIntentTask(role: AgentRoleRow, task: TaskRow): boolean {
  return isDevelopmentRole(role) && /^implement\b/i.test(task.title.trim());
}

/**
 * A single adapter call, never throwing — synthesizes the same FAILED
 * result the old inline try/catch in `executeTask` used to, just
 * factored out so it can be wrapped with bounded in-process retries
 * below.
 */
async function runAdapterOnce(
  adapter: AIProviderAdapter,
  input: Parameters<AIProviderAdapter["runAgentTask"]>[0],
  timeoutMs: number,
): Promise<import("../providers/types.ts").AgentTaskResult> {
  try {
    return await callAdapterWithTimeout(adapter, input, timeoutMs);
  } catch (error) {
    const timedOut = error instanceof AdapterTimeoutError;
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: "FAILED",
      output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason } },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      raw: { timedOut, threw: !timedOut },
    };
  }
}

/** Small and bounded on purpose — not a second retry ceiling, just enough to absorb one transient blip before it ever consumes a real, counted task attempt. */
const MAX_OPERATIONAL_RETRIES = 2;

/**
 * Wraps a single logical task execution with bounded, immediate,
 * in-process retries for operational failures only — a real semantic
 * result (SUCCEEDED, or FAILED for a reason that isn't operational)
 * returns immediately on the first attempt that produces one. Still
 * bounded: if the adapter is persistently broken, this eventually gives
 * up and returns the last operational failure, which then flows through
 * the normal retry/escalation path exactly like before — never an
 * infinite loop, just no longer wasting a real retry on the first
 * transient hiccup.
 */
async function runAdapterWithOperationalRetries(
  adapter: AIProviderAdapter,
  input: Parameters<AIProviderAdapter["runAgentTask"]>[0],
  timeoutMs: number,
): Promise<import("../providers/types.ts").AgentTaskResult> {
  let result = await runAdapterOnce(adapter, input, timeoutMs);
  // Accumulated, not just the last attempt's — a paid provider (Claude)
  // can incur real, billable usage on an in-process retry that still
  // ends in failure (e.g. a syntactically-valid-but-schema-mismatched
  // response, unlike a network timeout/connection error, which never
  // bills). Every real token this "one logical execution" actually
  // consumed must be reflected in what gets reconciled against the
  // budget reservation afterward — dropping an earlier attempt's usage
  // here would silently under-report real spend (controlled Claude LIVE
  // pilot, Part 6). A free provider's usage is always {0,0,$0} per call,
  // so this sums to the same total as before for Ollama/Simulated.
  let totalInputTokens = result.usage.inputTokens;
  let totalOutputTokens = result.usage.outputTokens;
  let totalCostUsd = result.usage.costUsd;
  let retries = 0;
  while (result.status === "FAILED" && isOperationalFailureReason(result.output.failure?.reason ?? "") && retries < MAX_OPERATIONAL_RETRIES) {
    retries += 1;
    result = await runAdapterOnce(adapter, input, timeoutMs);
    totalInputTokens += result.usage.inputTokens;
    totalOutputTokens += result.usage.outputTokens;
    totalCostUsd += result.usage.costUsd;
  }
  return { ...result, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd } };
}

/**
 * Release Agent's real (non-fixture) pre-flight gate (Phase 8 Part K) —
 * must not say "Ready" merely because preceding task statuses are DONE.
 * A project with no `workspaces` row at all is a legacy/pure-text
 * project: the gate does not apply and release proceeds exactly as
 * before. A project *with* a workspace must have at least one real
 * file, a `VERIFIED` delivery state, and no unresolved failure.
 */
function checkReleaseReadiness(db: DatabaseSync, projectId: string): { ready: true } | { ready: false; reason: string } {
  const workspace = getWorkspace(db, projectId);
  if (!workspace) return { ready: true };

  const fileCount = listWorkspaceFileRecords(db, projectId).length;
  if (fileCount === 0) {
    return { ready: false, reason: "Release blocked: this project has a workspace but no real deliverable files exist yet." };
  }
  if (workspace.deliveryState !== "VERIFIED") {
    return {
      ready: false,
      reason: `Release blocked: the real deliverable's verification state is "${workspace.deliveryState}", not VERIFIED.`,
    };
  }
  if (listUnresolvedFailures(db, projectId).length > 0) {
    return { ready: false, reason: "Release blocked: unresolved failure(s) remain for this project." };
  }
  return { ready: true };
}

/**
 * Intent-consistency gate, checkpoint 1 of 3 (Phase 8 follow-up — see
 * lib/ai-office/agents/intent-consistency.ts's docblock for the
 * incident this closes). Before a development role starts real work,
 * for an `ollama` project, compares the planning artifacts it's about
 * to build from against the project's authoritative user request. Real
 * providers only — SimulatedAdapter's fixtures are deliberately
 * idea-independent (Phase 8 Part E), so there is nothing meaningful to
 * compare for a SIMULATED project, and running this against Ollama
 * regardless of project provider would be a silent cross-provider
 * dependency this codebase explicitly forbids.
 *
 * Deliberately tolerant of "unavailable" (the check itself failing to
 * run) — this is a pre-development advisory pass, not the final claim
 * of correctness; the real deliverable still has to pass real QA
 * (checkpoint 2) before anything is called VERIFIED, and *that* gate
 * does not tolerate "unavailable" the same way (see the QA block below).
 * Only a real "inconsistent" verdict blocks development here.
 */
async function checkPlanConsistencyBeforeDevelopment(
  authoritativeUserRequest: string,
  planningArtifacts: Array<{ type: string; content: string }>,
  fetchImpl?: typeof fetch,
): Promise<{ consistent: true } | { consistent: false; reason: string }> {
  if (planningArtifacts.length === 0) return { consistent: true };
  const candidate = planningArtifacts.map((a) => `[${a.type}]\n${a.content}`).join("\n\n");
  const check = await checkIntentConsistency({ authoritativeUserRequest, candidate, checkpointLabel: "planned architecture/UX", fetchImpl });
  return check.outcome === "inconsistent" ? { consistent: false, reason: check.reason } : { consistent: true };
}

/**
 * Intent-consistency gate, checkpoint 3 of 3 — see its call site's
 * comment in `executeTask` for the full "why." `currentFiles` is the
 * real, current workspace state (the same data the corrective-attempt
 * prompt itself was built from); `proposedOperations` is what the model
 * just asked to write. Deliberately tolerant of "unavailable" for the
 * same reason checkpoint 1 is — see that function's docblock.
 */
async function checkRetryDriftBeforeMaterialization(
  authoritativeUserRequest: string,
  currentFiles: Array<{ path: string; content: string }>,
  proposedOperations: import("../providers/types.ts").FileOperationPayload[],
  fetchImpl?: typeof fetch,
): Promise<{ consistent: true } | { consistent: false; reason: string }> {
  // Nothing "previous" to drift away from yet — a first real attempt at
  // this task, not a correction of one, so there's no drift risk to
  // check.
  if (currentFiles.length === 0) return { consistent: true };
  const writeOps = proposedOperations.filter((op) => op.action === "write");
  if (writeOps.length === 0) return { consistent: true };

  const standard = [
    authoritativeUserRequest,
    "",
    "This must also still be served by the previously-working deliverable below — a corrective attempt must preserve it except where fixing the reported failure genuinely requires a change:",
    ...currentFiles.map((f) => `--- ${f.path} ---\n${f.content}`),
  ].join("\n");
  const candidate = writeOps.map((op) => `--- ${op.path} ---\n${op.content ?? ""}`).join("\n\n");

  const check = await checkIntentConsistency({
    authoritativeUserRequest: standard,
    candidate,
    checkpointLabel: "corrective attempt output",
    fetchImpl,
  });
  return check.outcome === "inconsistent" ? { consistent: false, reason: check.reason } : { consistent: true };
}

/**
 * Side effect of a failed plan-consistency check: reopens whichever
 * DONE planning task(s) actually produced the inconsistent architecture/
 * UX-spec artifact(s), so the *real* source of the problem gets redone —
 * not just the development task that happened to notice it. Reuses the
 * exact same primitives (updateTaskStatus, recordFailure, recordEvent)
 * every other failure path in this file already uses; the normal
 * dependency-eligibility mechanics then keep the development task
 * ineligible until the reopened planning task is DONE again for real.
 */
function reopenPlanningTasksForRework(db: DatabaseSync, projectId: string, reason: string): void {
  const artifacts = listArtifactsForProject(db, projectId);
  const planningTypes = new Set(["architecture", "ux-spec"]);
  const latestByType = new Map<string, (typeof artifacts)[number]>();
  for (const artifact of artifacts) {
    if (planningTypes.has(artifact.type)) latestByType.set(artifact.type, artifact);
  }

  for (const artifact of latestByType.values()) {
    if (!artifact.taskId) continue;
    const planningTask = getTask(db, artifact.taskId);
    if (!planningTask || planningTask.status !== "DONE") continue; // already being reworked or never completed
    updateTaskStatus(db, planningTask.id, "PENDING");
    recordFailure(db, { projectId, taskId: planningTask.id, reason: `Intent-consistency check failed: ${reason}` });
    recordEvent(db, {
      projectId,
      type: "task.invalidated_by_upstream_change",
      payload: { taskId: planningTask.id, reason: `Intent-consistency check failed: ${reason}` },
      actor: "system",
    });
  }
}

/**
 * Bounds `adapter.runAgentTask()` with `Promise.race` against a timer —
 * the standard, correct way to bound async work in Node (a Promise
 * cannot be forcibly cancelled, only stopped-waiting-for; safe here
 * because neither SimulatedAdapter nor this codebase's own code has any
 * side effect tied to the loser of the race actually completing).
 */
function callAdapterWithTimeout(
  adapter: AIProviderAdapter,
  input: Parameters<AIProviderAdapter["runAgentTask"]>[0],
  timeoutMs: number,
): Promise<import("../providers/types.ts").AgentTaskResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AdapterTimeoutError(`Execution timed out after ${timeoutMs}ms.`)), timeoutMs);

    // A malformed/misbehaving adapter can throw *synchronously* —
    // before ever returning a Promise — rather than rejecting one.
    // `adapter.runAgentTask(input).then(...)` would never reach
    // `.then()` in that case, leaving `timer` uncleared for its full
    // duration (up to the real 5-minute default) even though the
    // Promise below still settles correctly via the executor's
    // implicit catch. Caught explicitly so a synchronous throw clears
    // the timer exactly like an asynchronous rejection does.
    let pending: Promise<import("../providers/types.ts").AgentTaskResult>;
    try {
      pending = adapter.runAgentTask(input);
    } catch (syncError) {
      clearTimeout(timer);
      reject(syncError);
      return;
    }

    pending.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface ExecuteTaskOptions {
  /** Explicit, deterministic scenario selector — "success" (default), "failure", "retry-success". Never random. */
  scenario?: string;
  /** Defaults to the project's own `provider` column (SimulatedAdapter or OllamaAdapter) — this parameter exists for test injection (including a deliberately slow/hanging test double, to prove timeout behavior), not for overriding a real project's configured provider. */
  provider?: AIProviderAdapter;
  /** Overrides DEFAULT_TASK_TIMEOUT_MS — tests use a short value so timeout tests run fast. */
  timeoutMs?: number;
  /** Test-injection point for the intent-consistency gates' own Ollama call (separate from `provider`, which only covers the main adapter call) — lets a test prove the gates' plumbing deterministically, without a real Ollama server. Real (non-test) runner operation never sets this. */
  intentCheckFetch?: typeof fetch;
  /** Test-injection point for local-model detection (Part A) — bypasses the real `listInstalledOllamaModels()` call. Real (non-test) runner operation never sets this; ignored when `options.provider` is already given. */
  availableModelsOverride?: string[];
  /** Test-injection point for the real OllamaAdapter's own HTTP call when executeTask constructs it internally via LocalModelRouter (separate from `intentCheckFetch`, which only covers the intent-consistency gates' own call). Real (non-test) runner operation never sets this; ignored when `options.provider` is already given. */
  ollamaFetchImpl?: typeof fetch;
  /** Test-injection point for the real ClaudeAdapter's own Anthropic client when executeTask constructs it internally via the controlled Claude LIVE pilot's provider-routing/approval/budget gate (separate from `options.provider`, which bypasses that gate entirely). Real (non-test) runner operation never sets this; ignored when `options.provider` is already given. Still requires `isClaudeConfigured()` to hold (a real or test `ANTHROPIC_API_KEY`/pricing configuration) — this only replaces the HTTP client, never the configuration check itself. */
  claudeClientOverride?: import("../providers/claude/claude-adapter.ts").ClaudeAdapterOptions["client"];
}

/** The reused ApprovalKind for Claude paid-AI-use approval — see migration 006's docblock for why a new enum value isn't added instead. Project-scoped, never task-scoped: the whole point is a one-time "may this project use paid AI at all" decision (controlled Claude LIVE pilot, Part 9). */
const CLAUDE_APPROVAL_KIND = "paid_service_purchase" as const;

function claudeApprovalsForProject(db: DatabaseSync, projectId: string) {
  return listApprovalsForProject(db, projectId).filter((a) => a.kind === CLAUDE_APPROVAL_KIND && a.taskId === null);
}

function hasApprovedClaudeUse(db: DatabaseSync, projectId: string): boolean {
  return claudeApprovalsForProject(db, projectId).some((a) => a.status === "APPROVED");
}

function hasPendingClaudeApproval(db: DatabaseSync, projectId: string): boolean {
  return claudeApprovalsForProject(db, projectId).some((a) => a.status === "PENDING");
}

function hasRejectedClaudeApproval(db: DatabaseSync, projectId: string): boolean {
  return claudeApprovalsForProject(db, projectId).some((a) => a.status === "REJECTED");
}

export interface PreparedClaudeCall {
  adapter: ClaudeAdapter;
  reservationId: string;
}
type ClaudeGateResult = ({ outcome: "proceed" } & PreparedClaudeCall) | { outcome: "blocked"; reason: string };

/**
 * A conservative *ceiling*, not the expected cost — reserves enough to
 * cover the worst case where every bounded in-process operational retry
 * (`MAX_OPERATIONAL_RETRIES`, see `runAdapterWithOperationalRetries`)
 * also incurs real, billable Claude usage. Most operational retries
 * (a network timeout, a connection error, a rate limit) never bill at
 * all — the request was never successfully processed — but a
 * syntactically-valid, schema-mismatched response *does* bill real
 * tokens and is still classified operational (retried in-process, not
 * as its own counted task attempt). Reserving for the true worst case
 * (Part 8's "estimate the MAXIMUM allowed/reserved cost") rather than a
 * single call's cost is what keeps this "one logical execution" from
 * ever being able to spend more than what was reserved for it.
 */
function conservativeReservationEstimateUsd(singleCallEstimateUsd: number): number {
  return singleCallEstimateUsd * (MAX_OPERATIONAL_RETRIES + 1);
}

/**
 * The controlled Claude LIVE pilot's paid-routing gate — reached only
 * when `ProviderRouter` has already decided this role/task should use
 * CLAUDE (evidence-driven: HYBRID + no qualified local model for this
 * capability, or CLAUDE_ONLY). Nothing here ever spends money itself;
 * it only decides whether a real Claude call is currently *permitted*,
 * checked in this exact order (see the module's design notes):
 *
 *  1. Owner approval (Part 9) — a one-time, project-scoped decision,
 *     reachable and testable via the real owner UI even with no
 *     credential configured at all.
 *  2. Credential/pricing configuration (Part 33) — a missing credential
 *     is a clean, honest blocked state, never a thrown exception deep
 *     inside task execution; `ClaudeAdapter` is never even constructed
 *     until this passes.
 *  3. Atomic LIVE budget reservation (Parts 7/8) — the existing,
 *     already-proven `authorizeBudget()`/reservation architecture,
 *     reused verbatim rather than rebuilt.
 *
 * Called *before* a real TaskAttempt is ever created for this
 * execution (see `executeTask`'s call site) — a "not yet actionable"
 * outcome here (no decision yet, no budget, no credential) must never
 * consume this task's real retry ceiling the way an actual failed
 * attempt would.
 */
function prepareClaudeCall(
  db: DatabaseSync,
  ctx: {
    project: ProjectRow;
    role: AgentRoleRow;
    task: TaskRow;
    context: import("../providers/types.ts").TaskContext;
    /** Test-injection point for the internally-constructed ClaudeAdapter's own HTTP client (separate from `options.provider`, which bypasses this entire gate) — same pattern as `options.ollamaFetchImpl` for LocalModelRouter's internally-constructed OllamaAdapter. Real (non-test) runner operation never sets this; still requires a real `ANTHROPIC_API_KEY`/pricing configuration to be set (`isClaudeConfigured()`), exactly like real operation. */
    clientOverride?: import("../providers/claude/claude-adapter.ts").ClaudeAdapterOptions["client"];
  },
): ClaudeGateResult {
  const { project, role, task, context } = ctx;

  if (hasRejectedClaudeApproval(db, project.id)) {
    return {
      outcome: "blocked",
      reason: "Paid AI (Claude) use was rejected by the project owner for this project — this role cannot proceed under the current AI policy.",
    };
  }

  if (!hasApprovedClaudeUse(db, project.id)) {
    if (!hasPendingClaudeApproval(db, project.id)) {
      // Deliberately reachable and fully populated with real, current
      // budget figures even with no ANTHROPIC_API_KEY configured at all
      // (Part 33) — this is a pure read (getBudgetSnapshot never writes
      // or reserves anything), so the owner UI can render "PAID AI
      // APPROVAL REQUIRED — Provider: Claude · Role: ... · Project LIVE
      // budget: $.../$... · Monthly LIVE budget: $.../$..." (Part 9)
      // before Claude is ever configured.
      const snapshot = getBudgetSnapshot(db);
      const projectCapText = project.monthlyBudgetCapUsd != null ? `$${project.monthlyBudgetCapUsd.toFixed(2)}` : "(no project cap set)";
      const approval = createApproval(db, {
        projectId: project.id,
        kind: CLAUDE_APPROVAL_KIND,
        requestedBy: "system",
        context: {
          provider: "claude",
          role: role.id,
          reason: `PAID AI APPROVAL REQUIRED — Provider: Claude · Role: ${role.name} · Reason: no qualified local model is available for this capability · Project LIVE budget: $0.00/${projectCapText} · Monthly LIVE budget: $${(snapshot.capUsd - snapshot.remainingUsd).toFixed(2)}/$${snapshot.capUsd.toFixed(2)} remaining $${snapshot.remainingUsd.toFixed(2)}.`,
        },
      });
      recordEvent(db, {
        projectId: project.id,
        type: "approval.required",
        payload: { approvalId: approval.id, kind: CLAUDE_APPROVAL_KIND, provider: "claude", roleId: role.id, taskId: task.id },
        actor: "system",
      });
    }
    return {
      outcome: "blocked",
      reason: "PAID AI APPROVAL REQUIRED — waiting for the project owner to approve Claude for this project before any paid call can proceed.",
    };
  }

  if (!isClaudeConfigured()) {
    return {
      outcome: "blocked",
      reason: "Claude is approved for this project, but no ANTHROPIC_API_KEY/pricing configuration is set on the server.",
    };
  }

  const adapter = new ClaudeAdapter(ctx.clientOverride ? { client: ctx.clientOverride } : undefined);
  const singleCallEstimate = adapter.estimateCost({
    role: role.id,
    instructions: `Perform your assigned "${role.name}" responsibilities for this task.`,
    task: context,
  });

  const authorization = authorizeLiveBudget(db, {
    projectId: project.id,
    taskId: task.id,
    provider: "claude",
    estimatedCostUsd: conservativeReservationEstimateUsd(singleCallEstimate.estimatedCostUsd),
  });

  if (authorization.status === "BLOCKED_PROJECT_CAP" || authorization.status === "BLOCKED_MONTHLY_CAP") {
    return { outcome: "blocked", reason: authorization.reason ?? "Budget cap reached." };
  }
  if (authorization.status === "APPROVAL_REQUIRED") {
    return { outcome: "blocked", reason: authorization.reason ?? "A pending owner approval is blocking this project." };
  }
  if (authorization.status === "TEMPORARILY_UNAVAILABLE") {
    return { outcome: "blocked", reason: authorization.reason ?? "The budget ledger is temporarily unavailable." };
  }

  // AUTHORIZED or WARNING — both permit the call. WARNING only means the
  // office's 80% owner-warning threshold (Part 7) has been crossed; it
  // is surfaced to the owner via the budget dashboard, not a reason to
  // refuse this call.
  return { outcome: "proceed", adapter, reservationId: authorization.reservationId! };
}

export async function executeTask(
  db: DatabaseSync,
  taskId: string,
  options: ExecuteTaskOptions = {},
): Promise<ExecuteTaskResult> {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`Task ${taskId} does not exist.`);

  // Guards against ever re-running a terminal/claimed task — the
  // concrete "no infinite loop" boundary for this phase: there is no
  // automatic retry anywhere in this file, only what the caller
  // explicitly asks for, and only while the task is actually eligible.
  if (task.status !== "PENDING") {
    return { outcome: "not-eligible", task, reason: `Task status is ${task.status}; only PENDING tasks can be executed.` };
  }

  const role = getAgentRole(db, task.roleId);
  if (!role) throw new Error(`Agent role "${task.roleId}" does not exist.`);

  const project = getProject(db, task.projectId);
  if (!project) throw new Error(`Project ${task.projectId} does not exist.`);

  const budgetDecision = authorizeBudget({ aiMode: project.aiMode });
  if (!budgetDecision.authorized) {
    recordEvent(db, {
      projectId: project.id,
      type: "task.budget_refused",
      payload: { taskId: task.id, reason: budgetDecision.reason },
      actor: "system",
    });
    return { outcome: "budget-refused", task, reason: budgetDecision.reason };
  }

  updateTaskStatus(db, task.id, "IN_PROGRESS");

  // Context is built against the *predicted* next attempt number — a
  // pure read (buildTaskContext never mutates anything), safe to compute
  // before the real TaskAttempt row exists. This lets the controlled
  // Claude LIVE pilot's routing/approval/budget gate below (which needs
  // an accurate prompt to estimate a real reservation ceiling from) run
  // *before* any attempt is created, exactly like the SIMULATED/LIVE
  // budgetDecision gate above never creates one either — a "not yet
  // actionable" outcome (no owner decision yet, no budget, no
  // credential) must never consume this task's real retry ceiling.
  const predictedAttemptNumber = task.attemptCount + 1;
  const context = await buildTaskContext(db, task, role, { scenario: options.scenario, attemptNumber: predictedAttemptNumber });

  let claudeCall: PreparedClaudeCall | null = null;
  if (!options.provider) {
    const providerDecision = routeProvider(db, { role: role.id, project });
    if (providerDecision.provider === "CLAUDE") {
      const gate = prepareClaudeCall(db, { project, role, task, context, clientOverride: options.claudeClientOverride });
      if (gate.outcome !== "proceed") {
        updateTaskStatus(db, task.id, "PENDING");
        recordEvent(db, {
          projectId: project.id,
          type: "task.claude_routing_blocked",
          payload: { taskId: task.id, roleId: role.id, capability: providerDecision.capability, reason: gate.reason },
          actor: "system",
        });
        return { outcome: "claude-blocked", task: getTask(db, task.id)!, reason: gate.reason };
      }
      claudeCall = { adapter: gate.adapter, reservationId: gate.reservationId };
    }
  }

  const attempt = createTaskAttempt(db, task.id);

  // Local multi-model routing: for a real Ollama project (and only when
  // the caller hasn't already injected a specific adapter, e.g. a test
  // double), LocalModelRouter — never this function directly, never a UI,
  // never the model itself — decides which installed model this
  // role/attempt uses. A detection failure or an owner-misconfigured
  // policy (SINGLE_MODEL/CUSTOM naming an uninstalled model) is a real,
  // honest failure of this attempt; it is never papered over with a
  // silent fallback to a different model, and never to Claude/LIVE.
  let adapter: AIProviderAdapter | null = null;
  let modelForRun: string | null = null;
  let modelSelectionFailureReason: string | null = null;
  if (options.provider) {
    adapter = options.provider;
    modelForRun = options.provider.model ?? null;
  } else if (claudeCall) {
    adapter = claudeCall.adapter;
    modelForRun = claudeCall.adapter.model;
  } else if (project.provider === "ollama") {
    try {
      const availableModels = options.availableModelsOverride ?? (await listInstalledOllamaModels());
      const selection = new LocalModelRouter(db).selectModel({
        role: role.id,
        project: { id: project.id },
        attemptNumber: attempt.attemptNumber,
        failureContext: buildModelFailureContext(db, task, attempt.attemptNumber),
        availableModels,
      });
      adapter = new OllamaAdapter({ model: selection.model, fetchImpl: options.ollamaFetchImpl });
      modelForRun = selection.model;
    } catch (error) {
      modelSelectionFailureReason = error instanceof Error ? error.message : `Could not select a local model: ${String(error)}`;
    }
  } else {
    adapter = new SimulatedAdapter();
  }

  let agentRun = createAgentRunForAttempt(db, {
    taskAttemptId: attempt.id,
    roleId: role.id,
    provider: adapter?.name ?? project.provider,
    model: modelForRun,
  });
  agentRun = updateAgentRunStatus(db, agentRun.id, "RUNNING");

  // Every provider-independent gate below (Part 16) must treat a real
  // Claude call exactly like a real Ollama call — neither gets a weaker
  // path just because of which real provider produced the output.
  // `project.provider === "ollama"` alone (the pre-existing condition)
  // stays exactly as it was — tests routinely inject a `SimulatedAdapter`
  // test double for a specific attempt on an otherwise-real Ollama
  // project purely for determinism, and that convention must keep
  // meaning "this project is real" the same way it always has. `claudeCall`
  // additionally covers a HYBRID project's per-role Claude routing, which
  // the project's own base `provider` column can never reflect (a HYBRID
  // project's base provider is typically "simulated"; only specific
  // roles route to Claude).
  const usedRealProvider = project.provider === "ollama" || claudeCall !== null;

  const releaseReadiness =
    !modelSelectionFailureReason && role.id === "release-agent" ? checkReleaseReadiness(db, project.id) : { ready: true as const };
  const planConsistency =
    !modelSelectionFailureReason && releaseReadiness.ready && isDevelopmentRole(role) && usedRealProvider
      ? await checkPlanConsistencyBeforeDevelopment(context.authoritativeUserRequest, context.relevantArtifacts, options.intentCheckFetch)
      : { consistent: true as const };

  let result: import("../providers/types.ts").AgentTaskResult;
  if (modelSelectionFailureReason) {
    // Never even reaches the adapter — there's no adapter to reach: model
    // selection itself is what failed. Flows through the exact same
    // failure/retry/escalation path as any other real failure.
    result = {
      status: "FAILED",
      output: {
        summary: "",
        artifacts: [],
        decisions: [],
        testResults: [],
        events: [],
        fileOperations: [],
        recommendedNextActions: [],
        failure: { reason: modelSelectionFailureReason },
      },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      raw: { modelSelectionBlocked: true },
    };
  } else if (!releaseReadiness.ready) {
    // Never even calls the adapter — a project whose real deliverable
    // isn't verified yet must not be allowed to "succeed" its way to a
    // release summary regardless of what the adapter might say.
    result = {
      status: "FAILED",
      output: {
        summary: "",
        artifacts: [],
        decisions: [],
        testResults: [],
        events: [],
        fileOperations: [],
        recommendedNextActions: [],
        failure: { reason: releaseReadiness.reason },
      },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      raw: { releaseGateBlocked: true },
    };
  } else if (!planConsistency.consistent) {
    // The plan this developer would build from doesn't actually serve
    // the user's request — never let the developer proceed on it. The
    // real source of the problem (the planning artifact) gets reopened
    // as a side effect; this task's own attempt fails normally and
    // retries once the plan has been redone, via the existing
    // dependency-eligibility mechanics (no new retry system).
    reopenPlanningTasksForRework(db, project.id, planConsistency.reason);
    result = {
      status: "FAILED",
      output: {
        summary: "",
        artifacts: [],
        decisions: [],
        testResults: [],
        events: [],
        fileOperations: [],
        recommendedNextActions: [],
        failure: { reason: `Intent-consistency check failed before development: ${planConsistency.reason}` },
      },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      raw: { intentConsistencyBlocked: true },
    };
  } else {
    // Every provider-side failure — a timeout, a thrown exception, a
    // rejected promise, a malformed adapter — is a normal, expected
    // failure, never a reason to let an exception escape executeTask().
    // All three collapse to the same synthesized FAILED result so they
    // flow through the exact same retry/escalation path as a
    // fixture-driven failure, with no separate "timeout" or "adapter
    // threw" code path to keep in sync. This is the boundary that
    // matters: nothing past this point in executeTask() may throw for a
    // provider-caused reason — only a genuine internal/persistence error
    // (below) may still propagate, and the Runner treats that
    // differently (see runner.ts's crash-recovery note).
    //
    // Bounded in-process retries absorb a purely operational hiccup
    // (timeout, malformed JSON, connection error) before it ever
    // consumes one of this task's real, counted attempts — see
    // `runAdapterWithOperationalRetries`'s docblock.
    result = await runAdapterWithOperationalRetries(
      // Non-null: reachable only when modelSelectionFailureReason is
      // null, which is only ever set once `adapter` has been assigned.
      adapter!,
      // Deliberately role-generic, not task.title — task.title is a
      // display/tracking label built by concatenating the project's own
      // title (e.g. "Implement backend — Ollama Hello World Build"),
      // and echoing it here as "instructions" led a real model to treat
      // the project title as part of the spec (see
      // TaskContext.authoritativeUserRequest's docblock for the full
      // incident writeup). The actual work to do lives in
      // context.authoritativeUserRequest plus the role's own scoped
      // artifacts, both already part of `context`.
      { role: role.id, task: context, instructions: `Perform your assigned "${role.name}" responsibilities for this task.` },
      options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
    );
  }

  if (claudeCall) {
    // The ONLY place a Claude ai_usage row is ever inserted — via the
    // real reservation created before this call in `prepareClaudeCall`.
    // `recordAiUsage()` (the generic per-run path every other provider
    // uses, below) is deliberately skipped here: calling both would
    // double-count the same run's cost, once through reconciliation and
    // once through the generic insert. A call that never actually
    // reached the API (a pure network/timeout failure — zero real
    // tokens) releases the held reservation instead of "reconciling"
    // it with a cost that was never really incurred.
    const incurredRealUsage = result.usage.inputTokens > 0 || result.usage.outputTokens > 0;
    if (incurredRealUsage) {
      reconcileReservationWithUsage(db, {
        reservationId: claudeCall.reservationId,
        agentRunId: agentRun.id,
        actualCostUsd: result.usage.costUsd,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    } else {
      releaseReservation(db, claudeCall.reservationId);
    }
  } else {
    recordAiUsage(db, {
      agentRunId: agentRun.id,
      projectId: project.id,
      provider: adapter?.name ?? project.provider,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.usage.costUsd,
    });
  }

  // Intent-consistency gate, checkpoint 3 of 3: on a corrective attempt
  // (attemptNumber > 1) for a development role, a *proposed* write can
  // still drift the product's identity while claiming to fix an
  // unrelated bug — a real acceptance run showed exactly this (a real
  // "Hello World" page's second retry attempt rewrote it into an
  // unrelated "System Health Check" page while trying to fix a broken
  // button). Checked *before* any write is applied, against the same
  // real, current files the corrective-attempt prompt itself showed the
  // model (context.remediationContext.currentFiles) — so a drifted
  // proposal never overwrites working content. Tolerant of "unavailable"
  // like checkpoint 1 (a pre-write safety net, not the final claim of
  // correctness — real QA, checkpoint 2, remains the authoritative
  // gate); only a real "inconsistent" verdict rejects.
  const retryDrift =
    result.status === "SUCCEEDED" && isDevelopmentRole(role) && usedRealProvider && (attempt.attemptNumber ?? 1) > 1
      ? await checkRetryDriftBeforeMaterialization(
          context.authoritativeUserRequest,
          context.remediationContext?.currentFiles ?? [],
          result.output.fileOperations,
          options.intentCheckFetch,
        )
      : { consistent: true as const };

  if (!retryDrift.consistent) {
    result = {
      status: "FAILED",
      output: {
        summary: "",
        artifacts: [],
        decisions: [],
        testResults: [],
        events: [],
        fileOperations: [],
        recommendedNextActions: [],
        failure: { reason: `Corrective attempt rejected before applying — it would have changed the product's identity: ${retryDrift.reason}` },
      },
      usage: result.usage,
      raw: { retryDriftBlocked: true },
    };
  }

  // A reported success that also requested real file changes gets those
  // applied *before* finishSuccess ever commits anything. An invalid
  // batch (bad path, oversized write, etc.) is treated exactly like any
  // other provider-side failure — never a partial workspace write, never
  // an exception escaping this function, just a normal FAILED result
  // routed through the same retry/escalation path finishFailure already
  // handles for every other kind of failure.
  if (result.status === "SUCCEEDED" && result.output.fileOperations.length > 0) {
    try {
      await applyFileOperations(db, {
        projectId: project.id,
        taskId: task.id,
        roleId: role.id,
        operations: result.output.fileOperations,
      });
      // Real files just changed — any prior "VERIFIED" claim about this
      // project's deliverable is now stale until QA re-verifies it for
      // real (mirrors the same "a code change invalidates a prior
      // review" reasoning finishFailure's stale-downstream-review
      // handling already applies at the task level).
      setDeliveryState(db, project.id, "BUILDING");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result = {
        status: "FAILED",
        output: {
          summary: "",
          artifacts: [],
          decisions: [],
          testResults: [],
          events: [],
          fileOperations: [],
          recommendedNextActions: [],
          failure: { reason: `File operation rejected: ${reason}` },
        },
        usage: result.usage,
        raw: { fileOperationRejected: true },
      };
    }
  }

  // Development deliverable contract, part 2 (local multi-model routing
  // follow-up) — text describing code is not equivalent to creating
  // code. A real acceptance run showed gemma4 return SUCCEEDED with a
  // fully correct Hello World page's HTML/CSS/JS content, but placed
  // entirely inside a `code` artifact rather than `fileOperations`, so
  // nothing was ever materialized to disk. Converted to a normal
  // SEMANTIC failure (never "Operational:") so it flows through the
  // *existing* failure/retry/remediation/model-escalation/attempt-
  // ceiling pipeline untouched — no new retry engine, no new gate type.
  // Workspace state (not attempt number alone) decides tolerance: a
  // corrective attempt against a workspace that already has real files
  // may legitimately require no further change (e.g. QA's reported bug
  // was actually elsewhere) — a task with no real file yet has nothing
  // that could possibly already satisfy it, so zero fileOperations there
  // is never legitimate.
  if (result.status === "SUCCEEDED" && usedRealProvider && isImplementationIntentTask(role, task) && result.output.fileOperations.length === 0) {
    const existingFiles = await listFiles(project.id);
    if (existingFiles.length === 0) {
      result = {
        status: "FAILED",
        output: {
          ...result.output,
          failure: {
            reason:
              "Development task returned implementation content but did not provide any file operations, so no real deliverable was created or changed.",
          },
        },
        usage: result.usage,
        raw: { zeroFileOperationsBlocked: true },
      };
    }
  }

  // Development deliverable contract, part 3 (deliverable integrity
  // gate follow-up) — even when fileOperations ARE present, the result
  // can still be broken in a mechanically-detectable way: a real
  // acceptance run showed frontend-developer write an `index.html` that
  // referenced `script.js`/`style.css`, neither of which was ever
  // actually created. The task still completed because fileOperations
  // was non-empty; only real (slow) Playwright QA eventually caught the
  // broken button. `validateWorkspaceIntegrity` is a deterministic,
  // non-AI check against the real materialized workspace — never a
  // network request, never a path outside workspace-service.ts's own
  // safe boundary — that catches this class of defect immediately,
  // before QA ever needs to run. Converted to the same kind of normal
  // SEMANTIC failure as the zero-fileOperations gate above, flowing
  // through the identical existing failure/retry/remediation/model-
  // escalation/attempt-ceiling pipeline.
  if (result.status === "SUCCEEDED" && usedRealProvider && isImplementationIntentTask(role, task)) {
    const integrity = await validateWorkspaceIntegrity(project.id);
    if (integrity.status === "FAIL") {
      result = {
        status: "FAILED",
        output: {
          ...result.output,
          failure: { reason: describeIntegrityFailure(integrity) },
        },
        usage: result.usage,
        raw: { workspaceIntegrityFailed: true, missingReferences: integrity.missingReferences },
      };
    }
  }

  // Real, provider-independent QA (Phase 8 Part H): once a project has an
  // actual generated deliverable, "QA passed" must mean a real headless
  // browser actually loaded it and exercised it — never just that a
  // fixture or a model *said* "PASS". This replaces the adapter's own
  // testResults/status for this one task; every other role's output is
  // untouched. Projects with no workspace (legacy/pure-text) are
  // completely unaffected — the adapter's fixture testResults still
  // stand as before.
  if (role.id === "qa-agent" && workspaceExists(project.id)) {
    const verification = await runQABrowserVerification(project.id);
    let finalStatus = verification.status;
    let finalSummary = verification.summary;

    // Intent-consistency gate, checkpoint 2 of 3 — the FINAL gate before
    // a deliverable is ever called VERIFIED, so unlike checkpoints 1 and
    // 3 this one does NOT tolerate "unavailable." A structurally-passing
    // page (real heading/description/button, real interactivity, no
    // console errors) can still be the wrong product — e.g. a real
    // working page about something other than what was asked for — but
    // if the check itself can't produce a real verdict (Ollama down,
    // malformed response), silently defaulting to "must be fine" would
    // let a real outage rubber-stamp an unverified deliverable as
    // VERIFIED. Real providers only, same reasoning as checkpoint 1.
    let deliverableCheckUnavailable = false;
    if (verification.status === "PASS" && usedRealProvider) {
      const builtDescription = [verification.details.headingText, verification.details.bodyTextAfter]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join("\n");
      const deliverableCheck = await checkIntentConsistency({
        authoritativeUserRequest: context.authoritativeUserRequest,
        candidate: builtDescription,
        checkpointLabel: "built deliverable",
        fetchImpl: options.intentCheckFetch,
      });
      if (deliverableCheck.outcome === "inconsistent") {
        finalStatus = "FAIL";
        finalSummary = `The page loaded and worked, but does not match the requested product: ${deliverableCheck.reason}`;
      } else if (deliverableCheck.outcome === "unavailable") {
        deliverableCheckUnavailable = true;
        finalStatus = "FAIL";
        // "Operational:" prefix — isOperationalFailureReason() classifies
        // this as infrastructure, not a real QA/deliverable rejection, so
        // it never reopens the developer and never consumes real retry
        // budget the way an actual mismatch would.
        finalSummary = `Operational: deliverable-consistency verification could not run (${deliverableCheck.reason}) — not marking this deliverable VERIFIED.`;
      }
    }

    const testResult: import("../providers/types.ts").TestResultPayload = {
      kind: "test-result",
      status: finalStatus,
      summary: finalSummary,
      details: verification.details,
      durationMs: verification.durationMs,
      targetUrl: verification.targetUrl,
    };
    result = {
      status: finalStatus === "PASS" ? "SUCCEEDED" : "FAILED",
      output: {
        ...result.output,
        summary: finalSummary,
        testResults: [testResult],
        failure: finalStatus === "FAIL" ? { reason: finalSummary } : undefined,
      },
      usage: result.usage,
      raw: { realQaVerification: true },
    };
    // "VERIFYING" (not "FAILED") when the deliverable-check itself
    // couldn't run — the build isn't known to be broken, verification is
    // just incomplete; a future QA rerun (bounded by the normal retry
    // ceiling) will try again for a real verdict.
    setDeliveryState(db, project.id, finalStatus === "PASS" ? "VERIFIED" : deliverableCheckUnavailable ? "VERIFYING" : "FAILED");
  }

  if (result.status === "SUCCEEDED") {
    return finishSuccess(db, { project, role, task, attempt, agentRun, output: result.output });
  }
  return finishFailure(db, { project, role, task, attempt, agentRun, output: result.output });
}

function finishSuccess(
  db: DatabaseSync,
  ctx: {
    project: ProjectRow;
    role: AgentRoleRow;
    task: TaskRow;
    attempt: TaskAttemptRow;
    agentRun: AgentRunRow;
    output: import("../providers/types.ts").StructuredAgentOutput;
  },
): ExecuteTaskResult {
  const { project, role, task, attempt, agentRun, output } = ctx;

  // Everything below is one terminal transition — the artifacts/
  // decisions/test-results/events this run produced, together with the
  // attempt/run/task status all moving to their success state, and the
  // project-status/memory bookkeeping that depends on that final state.
  // Wrapped in a transaction so a crash partway through can never leave
  // a torn state (e.g. an artifact written but the task still
  // IN_PROGRESS, which the crash-recovery sweep would then re-execute —
  // producing a *duplicate* artifact for the same attempt). If this
  // throws, nothing here is persisted; the task is recovered by the
  // Runner's crash-recovery sweep exactly as if the process had died
  // before the adapter call ever returned.
  db.exec("BEGIN");
  let updatedTask: TaskRow;
  let finishedRun: AgentRunRow;
  try {
    for (const artifact of output.artifacts) {
      createArtifact(db, {
        projectId: project.id,
        taskId: task.id,
        type: artifact.artifactType as never,
        content: artifact.content,
        version: artifact.version,
      });
    }
    for (const decision of output.decisions) {
      recordDecision(db, {
        projectId: project.id,
        type: decision.type,
        summary: decision.summary,
        rationale: decision.rationale,
        madeBy: role.id,
      });
    }
    for (const testResult of output.testResults) {
      recordTestResult(db, {
        projectId: project.id,
        taskId: task.id,
        status: testResult.status,
        summary: testResult.summary,
        details: testResult.details,
        durationMs: testResult.durationMs,
        targetUrl: testResult.targetUrl,
      });
    }
    for (const event of output.events) {
      recordEvent(db, { projectId: project.id, type: event.type, payload: event.payload, actor: role.id });
    }
    recordEvent(db, {
      projectId: project.id,
      type: "agent_run.succeeded",
      payload: { taskId: task.id, roleId: role.id, attemptNumber: attempt.attemptNumber, summary: output.summary },
      actor: role.id,
    });

    updateTaskAttemptStatus(db, attempt.id, "SUCCEEDED");
    finishedRun = updateAgentRunStatus(db, agentRun.id, "SUCCEEDED", Date.now());
    updatedTask = updateTaskStatus(db, task.id, "DONE");

    // A success closes out whatever earlier failure(s) sent this task
    // back for a retry — e.g. the developer task's unresolved failure
    // from a prior QA rejection is resolved once the fix succeeds.
    for (const failure of listUnresolvedFailures(db, project.id)) {
      if (failure.taskId === task.id) resolveFailure(db, failure.id);
    }

    // Advance project status first so the memory summary reflects the
    // final state of this run (e.g. READY_FOR_REVIEW), not the
    // momentarily-stale status from before this task's completion.
    advanceProjectStatus(db, project.id);
    refreshProjectMemory(db, project.id);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    outcome: "succeeded",
    task: updatedTask,
    taskAttempt: { ...attempt, status: "SUCCEEDED" },
    agentRun: finishedRun,
  };
}

function finishFailure(
  db: DatabaseSync,
  ctx: {
    project: ProjectRow;
    role: AgentRoleRow;
    task: TaskRow;
    attempt: TaskAttemptRow;
    agentRun: AgentRunRow;
    output: import("../providers/types.ts").StructuredAgentOutput;
  },
): ExecuteTaskResult {
  const { project, role, task, attempt, agentRun, output } = ctx;
  const failureReason = output.failure?.reason ?? "Unspecified failure.";

  // Same atomicity reasoning as finishSuccess — one terminal transition,
  // one transaction. Retry-vs-escalate, remediation-target reopening,
  // and stale-downstream-review invalidation are all part of *this*
  // task's failure outcome and must land together or not at all.
  db.exec("BEGIN");
  let outcome: ExecuteTaskOutcome;
  let updatedTask: TaskRow;
  let finishedRun: AgentRunRow;
  try {
    // A review-type role (QA, Security, Code Review) can still produce a
    // test result even while "failing" its own task — QA's failure
    // fixture is exactly this: the run succeeded at testing, the tests
    // it ran did not pass. Persisted regardless of outcome so the
    // evidence exists.
    for (const testResult of output.testResults) {
      recordTestResult(db, {
        projectId: project.id,
        taskId: task.id,
        status: testResult.status,
        summary: testResult.summary,
        details: testResult.details,
        durationMs: testResult.durationMs,
        targetUrl: testResult.targetUrl,
      });
    }

    updateTaskAttemptStatus(db, attempt.id, "FAILED");

    // Remediation targets: for a review role (QA, Security, Code Review
    // — derived semantically from allowedInputs/allowedOutputs, see
    // remediation.ts, not a hardcoded role-id list or graph position),
    // walk the dependency ancestry back to the development task(s) that
    // actually need a code change — however many review hops away that
    // is, not just the direct dependency. Every other role retries
    // itself.
    //
    // An *operational* failure (isOperationalFailureReason) never
    // triggers this walk-back, regardless of role — an infrastructure
    // hiccup during, say, qa-agent's own deliverable-consistency check
    // is not the developer's fault, and blaming/reopening the developer
    // for it would be exactly the kind of misdirected remediation this
    // mechanism exists to prevent for real failures. An operational
    // failure always just retries its own task.
    const isOperational = isOperationalFailureReason(failureReason);
    const isReview = !isOperational && isReviewRole(role);
    const remediationTargets = isReview ? findRemediationTargets(db, task.id) : [task];

    for (const target of remediationTargets) {
      recordFailure(db, { projectId: project.id, taskId: target.id, agentRunId: agentRun.id, reason: failureReason });
    }
    recordEvent(db, {
      projectId: project.id,
      type: "agent_run.failed",
      payload: {
        taskId: task.id,
        roleId: role.id,
        attemptNumber: attempt.attemptNumber,
        reason: failureReason,
        remediationTargetTaskIds: remediationTargets.map((t) => t.id),
      },
      actor: role.id,
    });

    // Per docs/ai-office/04-agent-architecture.md §3's lifecycle
    // diagram: "FAILED --> QUEUED: retries remain (attempt++ ≤
    // maxRetries)" / "FAILED --> ESCALATED: retries exhausted".
    // attempt.attemptNumber is already the post-increment count for
    // this attempt.
    const ceilingExceeded = attempt.attemptNumber > role.maxRetries;

    if (!ceilingExceeded) {
      finishedRun = updateAgentRunStatus(db, agentRun.id, "FAILED", Date.now());
      updatedTask = updateTaskStatus(db, task.id, "PENDING");
      for (const target of remediationTargets) {
        if (target.id !== task.id) updateTaskStatus(db, target.id, "PENDING");
      }

      // Any already-DONE review task that transitively depends on a
      // reopened development task is now stale — the code it validated
      // is changing again — and must rerun too. Covers both a review
      // step strictly between the development task and the one that
      // just failed (QA, when Security fails) and an already-passed
      // sibling branch validating the same code (Security, when Code
      // Review fails after Security already passed).
      if (isReview) {
        const staleReviews = findStaleDownstreamReviews(
          db,
          project.id,
          remediationTargets.map((t) => t.id),
        ).filter((t) => t.id !== task.id);
        for (const stale of staleReviews) {
          updateTaskStatus(db, stale.id, "PENDING");
          recordEvent(db, {
            projectId: project.id,
            type: "task.invalidated_by_upstream_change",
            payload: { taskId: stale.id, causedByTaskId: task.id, causedByRoleId: role.id },
            actor: "system",
          });
        }
      }

      refreshProjectMemory(db, project.id);
      outcome = "retried";
    } else {
      finishedRun = updateAgentRunStatus(db, agentRun.id, "ESCALATED", Date.now());
      updatedTask = updateTaskStatus(db, task.id, "BLOCKED");
      updateProjectStatus(db, project.id, "BLOCKED");
      recordEvent(db, {
        projectId: project.id,
        type: "task.escalated",
        payload: { taskId: task.id, roleId: role.id, escalatesTo: role.escalatesTo, attemptCount: attempt.attemptNumber },
        actor: role.id,
      });
      refreshProjectMemory(db, project.id);
      outcome = "escalated";
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    outcome,
    task: updatedTask,
    taskAttempt: { ...attempt, status: "FAILED" },
    agentRun: finishedRun,
    reason: failureReason,
  };
}

/**
 * Deterministic bookkeeping, not Orchestrator intelligence: derives
 * project.status purely from already-persisted task/test-result state
 * against the five fixed quality gates in
 * docs/ai-office/05-orchestration-workflow.md §5. Never decides *what*
 * tasks exist or *which* roles are needed — that remains Phase 5's job.
 */
function advanceProjectStatus(db: DatabaseSync, projectId: string): void {
  const project = getProject(db, projectId);
  if (!project) return;
  if (["READY_FOR_REVIEW", "APPROVED", "BLOCKED", "FAILED", "ARCHIVED", "PAUSED"].includes(project.status)) return;

  const tasks = listTasksForProject(db, projectId);
  if (tasks.length === 0) return;

  const allDone = tasks.every((t) => t.status === "DONE");
  if (!allDone) {
    if (project.status === "DRAFT" || project.status === "PLANNING") {
      updateProjectStatus(db, projectId, "IN_PROGRESS");
    }
    return;
  }

  // Joined against tasks and scoped to task.status = 'DONE' deliberately
  // — a test_results row from a QA attempt that has since been
  // invalidated (Phase 4's remediation fix, docs/ai-office/11-implementation-phases.md's
  // Phase 4 status note) still exists in history, but its owning task is
  // back to PENDING, not DONE, at that point. Since `allDone` above
  // already requires literally every task in the plan to be DONE, this
  // join is redundant *given that check already passed* — kept anyway
  // as defense-in-depth so this query alone, read in isolation, can
  // never be satisfied by stale pre-remediation evidence.
  const latestTest = db
    .prepare(
      `SELECT tr.status FROM test_results tr
       JOIN tasks t ON t.id = tr.taskId
       WHERE tr.projectId = ? AND t.status = 'DONE'
       ORDER BY tr.createdAt DESC LIMIT 1`,
    )
    .get(projectId) as unknown as { status: string } | undefined;
  const qaPassed = latestTest?.status === "PASS";

  if (qaPassed) {
    updateProjectStatus(db, projectId, "READY_FOR_REVIEW");
  }
}
