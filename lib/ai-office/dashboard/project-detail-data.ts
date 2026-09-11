import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getProject, getProjectIdea, type ProjectRow } from "../domain/projects.ts";
import { listTasksForProject, listTaskDependencies, listTaskAttempts, getAgentRun, type TaskRow } from "../domain/tasks.ts";
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
import { sumSimulatedCostForProject, sumLiveCostForProject } from "../domain/budget.ts";
import { describeEvent, type ActivityEntry } from "./dashboard-data.ts";

/** Read-only aggregation for `/office/projects/[projectId]` — one project, examined deeply. */

export interface TaskAttemptView {
  attemptNumber: number;
  status: string;
  agentRun: { status: string; provider: string; startedAt: number; finishedAt: number | null } | null;
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
        ? { status: agentRun.status, provider: agentRun.provider, startedAt: agentRun.startedAt, finishedAt: agentRun.finishedAt }
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

  return {
    project,
    ideaText: idea?.rawText ?? "",
    tasks,
    progress: { completed: rawTasks.filter((t) => t.status === "DONE").length, total: rawTasks.length },
    failures: listUnresolvedFailures(db, projectId),
    decisions: listDecisionsForProject(db, projectId),
    artifacts,
    approvals: listApprovalsForProject(db, projectId),
    activity: events,
    memorySummary: memory?.summary ?? null,
    knownIssues: memory ? (JSON.parse(memory.knownIssues) as string[]) : [],
    simulatedCostUsd: sumSimulatedCostForProject(db, projectId),
    liveCostUsd: sumLiveCostForProject(db, projectId),
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
