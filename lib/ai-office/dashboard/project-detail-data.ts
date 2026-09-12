import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getProject, getProjectIdea, type ProjectRow } from "../domain/projects.ts";
import { listTasksForProject, listTaskDependencies, listTaskAttempts, getAgentRun, getTaskAttempt, getTask, type TaskRow } from "../domain/tasks.ts";
import { getAgentRole } from "../domain/agent-roles.ts";
import {
  listArtifactsForProject,
  listDecisionsForProject,
  listUnresolvedFailures,
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
  };
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
