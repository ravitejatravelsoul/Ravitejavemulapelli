import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { listProjects, type ProjectStatus } from "../domain/projects.ts";
import { listTasksForProject, getAgentRun, getTaskAttempt } from "../domain/tasks.ts";
import { listAiUsageForProject, countLocalRunsForOffice, countSimulatedRunsForOffice } from "../domain/budget.ts";

/**
 * Office-wide analytics (Section 28) — every figure here is a real
 * aggregation over already-persisted rows across every project; nothing
 * is a historical metric this codebase doesn't actually track (no
 * "before this phase" backfilled numbers). A metric this office has no
 * data for yet (e.g. Claude spend with no Claude call ever made) reports
 * an honest 0, not an omitted or guessed figure.
 */

export interface OfficeAnalytics {
  projectsByStatus: Partial<Record<ProjectStatus, number>>;
  totalProjects: number;
  totalTasks: number;
  totalTasksCompleted: number;
  totalTasksBlocked: number;
  /** Sum of every task's `attemptCount - 1` (0 for a task that succeeded on its first try) — a real, if approximate, retry count; never distinguishes operational vs. semantic at the office-wide level (that detail lives on the per-agent Progress tab). */
  totalRetries: number;
  localRuns: number;
  simulatedRuns: number;
  claudeCalls: number;
  claudeCostUsd: number;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeCacheReadTokens: number;
  claudeCacheWriteTokens: number;
  /** Total Claude cost divided by the number of DISTINCT projects that have made at least one Claude call — 0 if none have. */
  averagePaidCostPerProject: number;
  /** Total Claude cost divided by the number of DISTINCT tasks (across all projects) that both used Claude and reached DONE — 0 if none have. */
  costPerCompletedPaidTask: number;
}

export function getOfficeAnalytics(db: DatabaseSync): OfficeAnalytics {
  const projects = listProjects(db);
  const projectsByStatus: Partial<Record<ProjectStatus, number>> = {};
  for (const project of projects) {
    projectsByStatus[project.status] = (projectsByStatus[project.status] ?? 0) + 1;
  }

  let totalTasks = 0;
  let totalTasksCompleted = 0;
  let totalTasksBlocked = 0;
  let totalRetries = 0;
  let claudeCalls = 0;
  let claudeCostUsd = 0;
  let claudeInputTokens = 0;
  let claudeOutputTokens = 0;
  let claudeCacheReadTokens = 0;
  let claudeCacheWriteTokens = 0;
  const projectsWithClaudeSpend = new Set<string>();
  const completedPaidTaskIds = new Set<string>();

  for (const project of projects) {
    const tasks = listTasksForProject(db, project.id);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    totalTasks += tasks.length;
    totalTasksCompleted += tasks.filter((t) => t.status === "DONE").length;
    totalTasksBlocked += tasks.filter((t) => t.status === "BLOCKED").length;
    totalRetries += tasks.reduce((sum, t) => sum + Math.max(0, t.attemptCount - 1), 0);

    const claudeUsageRows = listAiUsageForProject(db, project.id).filter((u) => u.provider === "claude");
    if (claudeUsageRows.length > 0) {
      projectsWithClaudeSpend.add(project.id);
      claudeCalls += claudeUsageRows.length;
      for (const usage of claudeUsageRows) {
        claudeCostUsd += usage.costUsd;
        claudeInputTokens += usage.inputTokens;
        claudeOutputTokens += usage.outputTokens;
        claudeCacheReadTokens += usage.cacheReadInputTokens ?? 0;
        claudeCacheWriteTokens += usage.cacheCreationInputTokens ?? 0;

        // Resolve exactly which task this real Claude call belongs to
        // (agentRunId -> task_attempts -> tasks) — the same chain
        // `project-detail-data.ts`'s Claude Cost & Context table already
        // uses — so "completed paid task" means a specific task Claude
        // actually worked on and which reached DONE, never a loose
        // per-project approximation.
        const run = getAgentRun(db, usage.agentRunId);
        const attempt = run ? getTaskAttempt(db, run.taskAttemptId) : undefined;
        const task = attempt ? taskById.get(attempt.taskId) : undefined;
        if (task?.status === "DONE") completedPaidTaskIds.add(task.id);
      }
    }
  }

  return {
    projectsByStatus,
    totalProjects: projects.length,
    totalTasks,
    totalTasksCompleted,
    totalTasksBlocked,
    totalRetries,
    localRuns: countLocalRunsForOffice(db),
    simulatedRuns: countSimulatedRunsForOffice(db),
    claudeCalls,
    claudeCostUsd,
    claudeInputTokens,
    claudeOutputTokens,
    claudeCacheReadTokens,
    claudeCacheWriteTokens,
    averagePaidCostPerProject: projectsWithClaudeSpend.size > 0 ? claudeCostUsd / projectsWithClaudeSpend.size : 0,
    costPerCompletedPaidTask: completedPaidTaskIds.size > 0 ? claudeCostUsd / completedPaidTaskIds.size : 0,
  };
}
