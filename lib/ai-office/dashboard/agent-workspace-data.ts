import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { listProjects } from "../domain/projects.ts";
import { listTasksForProject, listTaskAttempts, getAgentRun } from "../domain/tasks.ts";
import { listFailuresForTask, listTestResultsForTask } from "../domain/project-outputs.ts";
import { listAiUsageForProject } from "../domain/budget.ts";
import { listWorkspaceFileRecords } from "../domain/workspace.ts";
import { isOperationalFailureReason } from "../agents/failure-classification.ts";
import type { AgentDetailView } from "./office-floor-data.ts";

/**
 * Office-wide, real performance rollup for one role — every figure is an
 * aggregation over already-persisted rows across every project this role
 * has ever touched, the same "real aggregation, honest zero" discipline
 * `analytics-data.ts` uses office-wide. A single project's one task
 * (see orchestrator.ts's task DAG — one task per role per project) has too
 * little texture on its own for "performance," so this rolls up across
 * every project the role has ever been assigned to.
 */
export interface RolePerformanceSummary {
  tasksCompleted: number;
  tasksActive: number;
  tasksBlockedOrFailed: number;
  totalAttempts: number;
  operationalRetries: number;
  semanticRetries: number;
  /** null when there is no completed-or-failed task yet to compute a rate from. */
  successRate: number | null;
  /** Sum of real agent_run startedAt/finishedAt spans, in ms — null when no run has ever finished. */
  totalActiveExecutionMs: number | null;
  filesTouched: number;
  testsPassed: number;
  testsFailed: number;
  claudeCostUsd: number;
  claudeInputTokens: number;
  claudeOutputTokens: number;
}

export function getRolePerformance(db: DatabaseSync, roleId: string): RolePerformanceSummary {
  let tasksCompleted = 0;
  let tasksActive = 0;
  let tasksBlockedOrFailed = 0;
  let totalAttempts = 0;
  let operationalRetries = 0;
  let semanticRetries = 0;
  let totalActiveExecutionMs = 0;
  let hasFinishedRun = false;
  let filesTouched = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  let claudeCostUsd = 0;
  let claudeInputTokens = 0;
  let claudeOutputTokens = 0;

  for (const project of listProjects(db)) {
    const roleTasks = listTasksForProject(db, project.id).filter((t) => t.roleId === roleId);
    if (roleTasks.length === 0) continue;

    for (const task of roleTasks) {
      if (task.status === "DONE") tasksCompleted++;
      else if (task.status === "IN_PROGRESS" || task.status === "ASSIGNED" || task.status === "IN_REVIEW") tasksActive++;
      else if (task.status === "BLOCKED" || task.status === "FAILED") tasksBlockedOrFailed++;

      const attempts = listTaskAttempts(db, task.id);
      totalAttempts += attempts.length;
      for (const attempt of attempts) {
        if (!attempt.agentRunId) continue;
        const run = getAgentRun(db, attempt.agentRunId);
        if (run?.finishedAt) {
          totalActiveExecutionMs += run.finishedAt - run.startedAt;
          hasFinishedRun = true;
        }
      }

      for (const failure of listFailuresForTask(db, task.id)) {
        if (isOperationalFailureReason(failure.reason)) operationalRetries++;
        else semanticRetries++;
      }

      for (const result of listTestResultsForTask(db, task.id)) {
        if (result.status === "PASS") testsPassed++;
        else testsFailed++;
      }
    }

    filesTouched += listWorkspaceFileRecords(db, project.id).filter((f) => f.lastModifiedByRoleId === roleId).length;

    for (const usage of listAiUsageForProject(db, project.id)) {
      const run = getAgentRun(db, usage.agentRunId);
      if (run?.roleId !== roleId) continue;
      claudeCostUsd += usage.costUsd;
      claudeInputTokens += usage.inputTokens;
      claudeOutputTokens += usage.outputTokens;
    }
  }

  const resolvedTotal = tasksCompleted + tasksBlockedOrFailed;

  return {
    tasksCompleted,
    tasksActive,
    tasksBlockedOrFailed,
    totalAttempts,
    operationalRetries,
    semanticRetries,
    successRate: resolvedTotal > 0 ? tasksCompleted / resolvedTotal : null,
    totalActiveExecutionMs: hasFinishedRun ? totalActiveExecutionMs : null,
    filesTouched,
    testsPassed,
    testsFailed,
    claudeCostUsd,
    claudeInputTokens,
    claudeOutputTokens,
  };
}

/**
 * The agent's real, honest "what happens next" — derived purely from
 * already-computed `AgentDetailView` fields, never a fabricated roadmap.
 * The Orchestrator already has its own `nextAction` field; this covers
 * every other role.
 */
export function deriveNextSteps(detail: AgentDetailView): string[] {
  if (detail.orchestrator) return [detail.orchestrator.nextAction];

  const unresolvedFailure = [...detail.failureHistory].reverse().find((f) => !f.resolved);
  if (unresolvedFailure) {
    return [unresolvedFailure.operational ? "Retry after the infrastructure issue clears." : `Address: ${unresolvedFailure.reason}`];
  }

  if (detail.taskStatus === "BLOCKED") return ["Blocked — awaiting owner review."];
  if (detail.taskStatus === "IN_PROGRESS") {
    const nextStep = detail.currentTaskSteps.find((s) => s.state === "PENDING");
    return [nextStep ? `Continue toward: ${nextStep.label}.` : "Continue the current task."];
  }
  if (detail.taskStatus === "PENDING") return ["Waiting for its turn in the task order."];
  if (detail.taskStatus === "DONE") return ["No further action — this role's task is complete."];
  return ["Not currently assigned to a task in this project."];
}
