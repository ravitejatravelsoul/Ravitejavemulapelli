import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getProject, getProjectIdea, type ProjectRow } from "../domain/projects.ts";
import { listTasksForProject, listTaskDependencies, listTaskAttempts, getAgentRun, getTaskAttempt, getTask, type TaskRow } from "../domain/tasks.ts";
import { getAgentRole } from "../domain/agent-roles.ts";
import {
  listArtifactsForProject,
  listDecisionsForProject,
  listUnresolvedFailures,
  listFailuresForTask,
  listTestResultsForTask,
  listApprovalsForProject,
  type ArtifactRow,
  type ProjectDecisionRow,
  type FailureRow,
  type ApprovalRow,
  type TestResultRow,
} from "../domain/project-outputs.ts";
import { listEventsForProject } from "../domain/events.ts";
import { getProjectMemory } from "../domain/project-memory.ts";
import { sumSimulatedCostForProject, sumLiveCostForProject, listAiUsageForProject } from "../domain/budget.ts";
import { getBudgetSnapshot } from "../budget/budget-service.ts";
import { isClaudeConfigured } from "../providers/claude/claude-adapter.ts";
import { describeEvent, type ActivityEntry } from "./dashboard-data.ts";
import { getWorkspace, listWorkspaceFileRecords, type DeliveryState, type WorkspaceFileRow } from "../domain/workspace.ts";
import { getHonestStatusLabel, isUnverifiedCompletionClaim, isStalledWithNoDeliverable, STALLED_NO_DELIVERABLE_LABEL } from "./delivery-status.ts";

/** Read-only aggregation for `/office/projects/[projectId]` — one project, examined deeply. */

export interface TaskAttemptView {
  attemptNumber: number;
  status: string;
  agentRun: { status: string; provider: string; model: string | null; startedAt: number; finishedAt: number | null } | null;
}

/** One row per role that has run at least once — the most recent attempt's real provider/model (Part 18: "Frontend Developer / CLAUDE / configured model"). Roles that haven't run yet are simply absent, not shown as a fabricated "LOCAL" guess. */
export interface RoleProviderView {
  roleId: string;
  roleName: string;
  provider: string;
  model: string | null;
}

/** Controlled Claude LIVE pilot — the numbers Part 18's owner UI must show, computed here (not in a client component) so a real API key is never required to render this page. */
export interface ProjectBudgetView {
  projectLiveCapUsd: number | null;
  projectLiveSpendUsd: number;
  officeMonthlyCapUsd: number;
  officeMonthlySpendUsd: number;
  officeMonthlyRemainingUsd: number;
  claudeConfigured: boolean;
}

export interface TaskDetailView {
  id: string;
  title: string;
  roleId: string;
  roleName: string;
  status: TaskRow["status"];
  attemptCount: number;
  dependsOnTaskIds: string[];
  attempts: TaskAttemptView[];
  testResults: TestResultRow[];
}

export interface ArtifactPreview {
  id: string;
  taskId: string | null;
  type: string;
  version: number;
  preview: string;
  createdAt: number;
}

export interface WorkspaceView {
  hasWorkspace: boolean;
  deliveryState: DeliveryState | null;
  files: WorkspaceFileRow[];
  /** True only when a real deliverable exists and passed verification — the one condition under which the owner-facing preview route/iframe should be offered. */
  canPreview: boolean;
}

export interface ProjectDetail {
  project: ProjectRow;
  ideaText: string;
  tasks: TaskDetailView[];
  progress: { completed: number; total: number };
  failures: FailureRow[];
  decisions: ProjectDecisionRow[];
  artifacts: ArtifactPreview[];
  approvals: ApprovalRow[];
  activity: ActivityEntry[];
  memorySummary: string | null;
  knownIssues: string[];
  simulatedCostUsd: number;
  liveCostUsd: number;
  workspace: WorkspaceView;
  displayStatusLabel: string;
  isUnverifiedCompletion: boolean;
  isStalledWithNoDeliverable: boolean;
  roleProviders: RoleProviderView[];
  budget: ProjectBudgetView;
  claudeCosts: ClaudeCostSummary;
  pipeline: PipelineStageView[];
  collaboration: CollaborationEntry[];
}

/** Token economics phase, Part 10 — one row per real Claude call, joined from `ai_usage` (never guessed) through `agent_runs -> task_attempts -> tasks -> agent_roles`, most recent first. Context-selection detail (files/estimate) comes from the matching `claude.context_prepared` telemetry event for the same task, when one exists — best-effort, never blocking the row if it doesn't (an older row from before this phase, for instance). */
export interface ClaudeCallView {
  agentRunId: string;
  taskId: string | null;
  taskTitle: string | null;
  roleId: string | null;
  roleName: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number;
  contextEstimatedInputTokens: number | null;
  contextFilesSelected: number | null;
  contextFilesExcluded: number | null;
  /** Token-gate hardening — true when this call proceeded above its capability's target only because it fell within the explicit burst allowance (never above burst — that BLOCKS outright, so no row here is ever a call that exceeded burst). */
  contextBurstWarning: boolean;
  contextTargetEstimatedInputTokens: number | null;
  contextBurstEstimatedInputTokens: number | null;
  createdAt: number;
}

export interface ClaudeCostSummary {
  calls: ClaudeCallView[];
  totalCostUsd: number;
  totalCalls: number;
  /** Calls beyond the first real Claude call recorded for a given task — a real paid retry, not the task's original attempt. */
  paidRetries: number;
  largestPromptTokens: number;
  largestOutputTokens: number;
  averageCallCostUsd: number;
  /** Total Claude cost divided by the number of DISTINCT tasks (among those with at least one Claude call) that ultimately reached DONE — 0 if none have. */
  costPerCompletedPaidTask: number;
  /** How many calls needed their capability's burst allowance — a real, owner-visible signal that context is running hotter than the normal target, even though none of them were blocked. */
  callsUsingBurstAllowance: number;
}

function buildClaudeCostSummary(db: DatabaseSync, projectId: string): ClaudeCostSummary {
  const usageRows = listAiUsageForProject(db, projectId).filter((u) => u.provider === "claude");
  const contextEvents = listEventsForProject(db, projectId)
    .filter((e) => e.type === "claude.context_prepared")
    .map((e) => {
      try {
        return JSON.parse(e.payload) as {
          taskId?: string;
          estimatedInputTokens?: number;
          filesSelected?: string[];
          filesExcluded?: string[];
          burstWarning?: boolean;
          targetEstimatedInputTokens?: number;
          burstEstimatedInputTokens?: number;
        };
      } catch {
        return {};
      }
    });

  const seenTaskIds = new Set<string>();
  const calls: ClaudeCallView[] = usageRows.map((usage) => {
    const agentRun = getAgentRun(db, usage.agentRunId);
    const attempt = agentRun ? getTaskAttempt(db, agentRun.taskAttemptId) : undefined;
    const task = attempt ? getTask(db, attempt.taskId) : undefined;
    const role = task ? getAgentRole(db, task.roleId) : undefined;
    // Best-effort match: the most recent context-prepared telemetry for
    // this same task — approximate, but the two are always recorded
    // within the same `executeTask` call, so in practice there is
    // exactly one candidate per real attempt.
    const contextEvent = task ? contextEvents.find((e) => e.taskId === task.id) : undefined;

    return {
      agentRunId: usage.agentRunId,
      taskId: task?.id ?? null,
      taskTitle: task?.title ?? null,
      roleId: task?.roleId ?? null,
      roleName: role?.name ?? null,
      model: agentRun?.model ?? null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      costUsd: usage.costUsd,
      contextEstimatedInputTokens: contextEvent?.estimatedInputTokens ?? null,
      contextFilesSelected: contextEvent?.filesSelected?.length ?? null,
      contextFilesExcluded: contextEvent?.filesExcluded?.length ?? null,
      contextBurstWarning: contextEvent?.burstWarning ?? false,
      contextTargetEstimatedInputTokens: contextEvent?.targetEstimatedInputTokens ?? null,
      contextBurstEstimatedInputTokens: contextEvent?.burstEstimatedInputTokens ?? null,
      createdAt: usage.createdAt,
    };
  });

  let paidRetries = 0;
  for (const call of calls) {
    if (!call.taskId) continue;
    if (seenTaskIds.has(call.taskId)) paidRetries += 1;
    else seenTaskIds.add(call.taskId);
  }

  const completedTaskIds = new Set([...seenTaskIds].filter((id) => getTask(db, id)?.status === "DONE"));
  const totalCostUsd = calls.reduce((sum, c) => sum + c.costUsd, 0);

  return {
    calls: calls.sort((a, b) => b.createdAt - a.createdAt),
    totalCostUsd,
    totalCalls: calls.length,
    paidRetries,
    largestPromptTokens: calls.reduce((max, c) => Math.max(max, c.contextEstimatedInputTokens ?? c.inputTokens), 0),
    largestOutputTokens: calls.reduce((max, c) => Math.max(max, c.outputTokens), 0),
    averageCallCostUsd: calls.length > 0 ? totalCostUsd / calls.length : 0,
    costPerCompletedPaidTask: completedTaskIds.size > 0 ? totalCostUsd / completedTaskIds.size : 0,
    callsUsingBurstAllowance: calls.filter((c) => c.contextBurstWarning).length,
  };
}

// ---- project pipeline (Section 13) -------------------------------------

export type PipelineStageState = "COMPLETE" | "ACTIVE" | "BLOCKED" | "PENDING" | "SKIPPED";

export interface PipelineStageView {
  key: string;
  label: string;
  state: PipelineStageState;
}

/** Which catalog role(s) correspond to each pipeline stage — a stage with none of its roles selected for this project (Orchestrator legitimately didn't pick them) is SKIPPED, never shown as incomplete. */
const PIPELINE_STAGE_ROLES: Array<{ key: string; label: string; roleIds: string[] }> = [
  { key: "requirements", label: "Requirements", roleIds: ["product-owner"] },
  { key: "architecture", label: "Architecture", roleIds: ["solution-architect"] },
  { key: "design", label: "Design", roleIds: ["ui-ux-agent"] },
  { key: "build", label: "Build", roleIds: ["frontend-developer", "backend-developer"] },
  { key: "qa", label: "QA", roleIds: ["qa-agent"] },
  { key: "review", label: "Review", roleIds: ["security-reviewer", "code-reviewer"] },
  { key: "release", label: "Release", roleIds: ["release-agent"] },
];

function stageStateFor(tasks: TaskRow[], roleIds: string[]): PipelineStageState {
  const stageTasks = tasks.filter((t) => roleIds.includes(t.roleId));
  if (stageTasks.length === 0) return "SKIPPED";
  if (stageTasks.some((t) => t.status === "BLOCKED")) return "BLOCKED";
  if (stageTasks.some((t) => t.status === "IN_PROGRESS")) return "ACTIVE";
  if (stageTasks.every((t) => t.status === "DONE")) return "COMPLETE";
  return "PENDING";
}

/** IDEA is always complete by the time a project exists; every later stage is derived purely from the real tasks the Orchestrator actually planned — a stage the Orchestrator legitimately didn't select (e.g. Design for a project with no UI/UX task) reads SKIPPED, never as an incomplete step blocking the pipeline (Section 13's explicit "simple projects should not appear incomplete"). */
export function getProjectPipeline(db: DatabaseSync, projectId: string): PipelineStageView[] {
  const tasks = listTasksForProject(db, projectId);
  return [
    { key: "idea", label: "Idea", state: "COMPLETE" as const },
    ...PIPELINE_STAGE_ROLES.map((stage) => ({ key: stage.key, label: stage.label, state: stageStateFor(tasks, stage.roleIds) })),
  ];
}

// ---- agent collaboration (Section 14) ----------------------------------

export interface CollaborationEntry {
  id: string;
  occurredAt: number;
  fromRoleName: string;
  message: string;
}

/**
 * Derives concise, human-readable "who told whom what" entries purely
 * from already-persisted structured data (task completions and real
 * failure/remediation records) — never a fabricated chat transcript. A
 * failure row's `taskId` is the task that must redo the work (the
 * hand-off target); the reviewer who actually detected it is resolved
 * through `agentRunId -> task_attempts -> tasks`, the same real chain
 * `office-floor-data.ts` already uses for per-role activity.
 */
export function getCollaborationFeed(db: DatabaseSync, projectId: string): CollaborationEntry[] {
  const tasks = listTasksForProject(db, projectId);
  const roleNameById = new Map(tasks.map((t) => [t.roleId, getAgentRole(db, t.roleId)?.name ?? t.roleId]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const entries: CollaborationEntry[] = [];

  for (const task of tasks) {
    if (task.status !== "DONE") continue;
    const roleName = roleNameById.get(task.roleId) ?? task.roleId;
    entries.push({ id: `done-${task.id}`, occurredAt: task.updatedAt, fromRoleName: roleName, message: `${roleName}: Completed "${task.title}."` });
  }

  for (const task of tasks) {
    for (const failure of listFailuresForTask(db, task.id)) {
      const targetRoleName = roleNameById.get(task.roleId) ?? task.roleId;
      let detectingRoleName = "A reviewer";
      if (failure.agentRunId) {
        const run = getAgentRun(db, failure.agentRunId);
        const attempt = run ? getTaskAttempt(db, run.taskAttemptId) : undefined;
        const detectingTask = attempt ? taskById.get(attempt.taskId) : undefined;
        if (detectingTask) detectingRoleName = roleNameById.get(detectingTask.roleId) ?? detectingTask.roleId;
      }
      entries.push({
        id: `failure-${failure.id}`,
        occurredAt: failure.createdAt,
        fromRoleName: detectingRoleName,
        message: `${detectingRoleName}: ${failure.reason} Returning to ${targetRoleName}.`,
      });
    }
  }

  return entries.sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 30);
}

/**
 * The most recent real failure hand-off ("X: reason. Returning to Y.")
 * still within its recency window, resolved to role ids — used to draw a
 * brief connector on the office image (Section 9 of the visual-integration
 * phase). Never a permanent or fabricated connection; `null` the moment
 * nothing real has happened recently.
 */
export function getRecentHandoff(
  agents: { roleId: string; roleName: string }[],
  collaboration: CollaborationEntry[],
  windowMs = 5 * 60 * 1000,
): { from: string; to: string } | null {
  const nameToRoleId = new Map(agents.map((a) => [a.roleName, a.roleId]));
  const now = Date.now();
  for (const entry of collaboration) {
    if (now - entry.occurredAt > windowMs) continue;
    const match = entry.message.match(/Returning to (.+)\.$/);
    if (!match) continue;
    const fromId = nameToRoleId.get(entry.fromRoleName);
    const toId = nameToRoleId.get(match[1]);
    if (fromId && toId) return { from: fromId, to: toId };
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildTaskDetail(db: DatabaseSync, task: TaskRow): TaskDetailView {
  const role = getAgentRole(db, task.roleId);
  const deps = listTaskDependencies(db, task.id).map((d) => d.dependsOnTaskId);
  const attempts = listTaskAttempts(db, task.id).map((attempt) => {
    const agentRun = attempt.agentRunId ? getAgentRun(db, attempt.agentRunId) : undefined;
    return {
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      agentRun: agentRun
        ? { status: agentRun.status, provider: agentRun.provider, model: agentRun.model, startedAt: agentRun.startedAt, finishedAt: agentRun.finishedAt }
        : null,
    };
  });

  return {
    id: task.id,
    title: task.title,
    roleId: task.roleId,
    roleName: role?.name ?? task.roleId,
    status: task.status,
    attemptCount: task.attemptCount,
    dependsOnTaskIds: deps,
    attempts,
    testResults: listTestResultsForTask(db, task.id),
  };
}

export function getProjectDetail(db: DatabaseSync, projectId: string): ProjectDetail | undefined {
  const project = getProject(db, projectId);
  if (!project) return undefined;

  const idea = getProjectIdea(db, projectId);
  const rawTasks = listTasksForProject(db, projectId);
  const tasks = rawTasks.map((task) => buildTaskDetail(db, task));
  const memory = getProjectMemory(db, projectId);
  const artifacts = listArtifactsForProject(db, projectId).map((artifact) => summarizeArtifact(artifact));
  const events = listEventsForProject(db, projectId).map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    projectId: event.projectId,
    message: describeEvent(event),
  }));

  const workspaceRow = getWorkspace(db, projectId);
  const files = workspaceRow ? listWorkspaceFileRecords(db, projectId) : [];
  const deliveryState = workspaceRow?.deliveryState ?? null;
  const workspace: WorkspaceView = {
    hasWorkspace: workspaceRow !== undefined,
    deliveryState,
    files,
    canPreview: deliveryState === "VERIFIED" && files.some((f) => f.path === "index.html"),
  };

  // Most recent real attempt per role — a role can legitimately switch
  // providers across attempts under HYBRID (e.g. an earlier attempt
  // blocked on approval, a later one ran for real once approved), so
  // this deliberately reflects only the latest, not "the" provider for
  // the role's whole history.
  const roleProviders: RoleProviderView[] = [];
  for (const t of tasks) {
    const latestAttempt = [...t.attempts].reverse().find((a) => a.agentRun);
    if (!latestAttempt?.agentRun) continue;
    roleProviders.push({ roleId: t.roleId, roleName: t.roleName, provider: latestAttempt.agentRun.provider, model: latestAttempt.agentRun.model });
  }

  const officeSnapshot = getBudgetSnapshot(db);
  const budget: ProjectBudgetView = {
    projectLiveCapUsd: project.monthlyBudgetCapUsd,
    projectLiveSpendUsd: sumLiveCostForProject(db, projectId),
    officeMonthlyCapUsd: officeSnapshot.capUsd,
    officeMonthlySpendUsd: officeSnapshot.capUsd - officeSnapshot.remainingUsd,
    officeMonthlyRemainingUsd: officeSnapshot.remainingUsd,
    claudeConfigured: isClaudeConfigured(),
  };

  const progress = { completed: rawTasks.filter((t) => t.status === "DONE").length, total: rawTasks.length };
  const stalled = isStalledWithNoDeliverable({
    status: project.status,
    allTasksDone: progress.total > 0 && progress.completed === progress.total,
    hasWorkspace: workspace.hasWorkspace,
    deliveryState,
  });

  return {
    project,
    ideaText: idea?.rawText ?? "",
    tasks,
    progress,
    failures: listUnresolvedFailures(db, projectId),
    decisions: listDecisionsForProject(db, projectId),
    artifacts,
    approvals: listApprovalsForProject(db, projectId),
    activity: events,
    memorySummary: memory?.summary ?? null,
    knownIssues: memory ? (JSON.parse(memory.knownIssues) as string[]) : [],
    simulatedCostUsd: sumSimulatedCostForProject(db, projectId),
    liveCostUsd: sumLiveCostForProject(db, projectId),
    workspace,
    displayStatusLabel: stalled ? STALLED_NO_DELIVERABLE_LABEL : getHonestStatusLabel(project.status, workspace.hasWorkspace, deliveryState),
    isUnverifiedCompletion: isUnverifiedCompletionClaim(project.status, workspace.hasWorkspace, deliveryState),
    isStalledWithNoDeliverable: stalled,
    roleProviders,
    budget,
    claudeCosts: buildClaudeCostSummary(db, projectId),
    pipeline: getProjectPipeline(db, projectId),
    collaboration: getCollaborationFeed(db, projectId),
  };
}

function summarizeArtifact(artifact: ArtifactRow): ArtifactPreview {
  return {
    id: artifact.id,
    taskId: artifact.taskId,
    type: artifact.type,
    version: artifact.version,
    preview: truncate(artifact.content, 320),
    createdAt: artifact.createdAt,
  };
}
