import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { listAgentRoles, getAgentRole, type AgentRoleRow } from "../domain/agent-roles.ts";
import { isReviewRole, isDevelopmentRole } from "../agents/remediation.ts";
import { isOperationalFailureReason } from "../agents/failure-classification.ts";
import { listProjects, getProject, type ProjectRow, type ProjectStatus } from "../domain/projects.ts";
import { listTaskDependencies, listTasksForProject, listTaskAttempts, getAgentRun, type TaskRow, type AgentRunRow } from "../domain/tasks.ts";
import {
  listArtifactsForProject,
  listTestResultsForTask,
  listFailuresForTask,
  listApprovalsForProject,
  listDecisionsForProject,
  type ArtifactRow,
  type TestResultRow,
} from "../domain/project-outputs.ts";
import { listEventsForProject } from "../domain/events.ts";
import { describeEvent, categorizeEventType, type ActivityEntry } from "./dashboard-data.ts";
import { listWorkspaceFileRecords, getWorkspace, type WorkspaceFileRow } from "../domain/workspace.ts";
import { getHonestStatusLabel, isUnverifiedCompletionClaim, isStalledWithNoDeliverable, STALLED_NO_DELIVERABLE_LABEL } from "./delivery-status.ts";

/**
 * Read-only "office floor" projection — turns real, already-persisted
 * project/task/agent-run state into one visual status per one of the 11
 * catalog roles, for the animated office UI. No schema changes, no new
 * writes, no randomness: every status here is a deterministic function of
 * data that already exists for an entirely different reason (the ordinary
 * dashboard/project-detail views). If nothing is happening, every agent is
 * IDLE — there is no code path that invents activity.
 */

export type { OfficeAgentVisualStatus } from "./office-visual-state.ts";
import { mapAgentVisualState, isActiveVisualState, type OfficeAgentVisualStatus } from "./office-visual-state.ts";

export interface OfficeAgentView {
  roleId: string;
  roleName: string;
  status: OfficeAgentVisualStatus;
  currentTaskTitle: string | null;
  lastCompletedTaskTitle: string | null;
  attemptCount: number;
  /** Actual persisted run provider; null until assigned. Never inferred from project policy. */
  provider: string | null;
  model?: string | null;
  taskId?: string | null;
  maxAttempts?: number;
  completedAt?: number | null;
}

export interface OfficeFloorProjectOption {
  id: string;
  title: string;
  status: ProjectStatus;
}

export interface OfficeFloorView {
  interaction?: import("./office-transitions.ts").OfficeInteractionView;
  selectedProject: {
    id: string;
    title: string;
    status: ProjectStatus;
    /** The honest label to display instead of `status` — identical to it unless the project claims completion without a verified real deliverable, or is stalled (every task DONE, no real deliverable, nothing left to run). */
    displayStatusLabel: string;
    isUnverifiedCompletion: boolean;
    isStalledWithNoDeliverable: boolean;
    progress: { completed: number; total: number };
    provider: string;
    /** The project's paid-AI policy — LOCAL_ONLY/HYBRID/CLAUDE_ONLY (token economics phase) — shown alongside `provider` in the operational bar so "Provider Policy" is never confused with the per-role provider actually used. */
    aiPolicyMode: import("../domain/projects.ts").AiPolicyMode;
  } | null;
  projects: OfficeFloorProjectOption[];
  agents: OfficeAgentView[];
  /** How many of the 11 catalog roles are currently doing real work on the selected project — Active worker states only; excludes the command desk and WAITING/IDLE. 0 with no project selected. */
  activeAgentCount: number;
}

/** The provider label for a project's own (not-yet-run) work — the project's configured `provider` column ("simulated" | "ollama"), or "live" for a (currently unreachable) LIVE-mode project. */
function projectProviderLabel(project: ProjectRow): string {
  return project.routingMode === "FREE_MULTI_MODEL" ? "Free multi-model" : project.aiMode === "LIVE" ? "live" : project.provider;
}

function idleAgent(role: AgentRoleRow): OfficeAgentView {
  return { roleId: role.id, roleName: role.name, status: "IDLE", currentTaskTitle: null, lastCompletedTaskTitle: null, attemptCount: 0, provider: null };
}

function getLatestAgentRunForTask(db: DatabaseSync, taskId: string): AgentRunRow | null {
  const attempts = listTaskAttempts(db, taskId);
  const latest = attempts[attempts.length - 1];
  if (!latest?.agentRunId) return null;
  return getAgentRun(db, latest.agentRunId) ?? null;
}

function pickDefaultProject(projects: ProjectRow[]): ProjectRow | null {
  if (projects.length === 0) return null;
  const inProgress = projects.filter((p) => p.status === "IN_PROGRESS").sort((a, b) => b.updatedAt - a.updatedAt);
  if (inProgress.length > 0) return inProgress[0];
  return [...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

function buildAgentView(
  db: DatabaseSync, role: AgentRoleRow, project: ProjectRow, task: TaskRow | undefined,
  ctx: { now: number; tasks: TaskRow[]; pendingApprovalCount: number },
): OfficeAgentView {
  const run = task ? getLatestAgentRunForTask(db, task.id) : null;
  const dependenciesSatisfied = !!task && listTaskDependencies(db, task.id).every(edge =>
    ctx.tasks.some(t => t.id === edge.dependsOnTaskId && t.status === "DONE"));
  const status = mapAgentVisualState({ roleId: role.id, projectStatus: project.status, task,
    dependenciesSatisfied, pendingApproval: ctx.pendingApprovalCount > 0 && (role.id === "orchestrator" || task?.status === "PENDING" || task?.status === "ASSIGNED"),
    runningTaskCount: ctx.tasks.filter(t => t.status === "IN_PROGRESS" && (!t.leaseExpiresAt || t.leaseExpiresAt > ctx.now)).length,
    blockedTaskCount: ctx.tasks.filter(t => t.status === "BLOCKED").length, now: ctx.now });
  // No project-provider fallback. A route is unknown until a real run records it.
  // Pending retry rows retain old run history, but never advertise it as the next model.
  const currentRun = task && !["PENDING", "ASSIGNED"].includes(task.status) ? run : null;
  return { roleId: role.id, roleName: role.name, status,
    taskId: task?.id ?? null,
    currentTaskTitle: role.id === "orchestrator"
      ? status === "WAITING" ? "Waiting for owner approval" : status === "WORKING" ? "Coordinating active tasks" : status === "THINKING" ? "Planning the project" : status === "BLOCKED" ? "Review blocked work" : null
      : task && task.status !== "DONE" ? task.title : null,
    lastCompletedTaskTitle: task?.status === "DONE" ? task.title : null,
    attemptCount: task?.attemptCount ?? 0, maxAttempts: role.maxRetries + (task?.retryBaselineAttemptCount ?? 0),
    completedAt: task?.status === "DONE" ? task.updatedAt : null,
    provider: currentRun?.provider ?? null, model: currentRun?.model ?? null };
}

/**
 * `selectedProjectId` lets the UI switch which project's state the floor
 * visualizes; omitted (or not found) falls back to the most recently
 * updated IN_PROGRESS project, else the most recently updated project of
 * any status, else no project at all (a brand-new office).
 */
export function getOfficeFloorView(db: DatabaseSync, selectedProjectId?: string, now: number = Date.now()): OfficeFloorView {
  const roles = listAgentRoles(db);
  const allProjects = listProjects(db);
  const projects = allProjects.map((p) => ({ id: p.id, title: p.title, status: p.status }));

  const project = (selectedProjectId ? getProject(db, selectedProjectId) : undefined) ?? pickDefaultProject(allProjects);

  if (!project) {
    return { selectedProject: null, projects, agents: roles.map(idleAgent), activeAgentCount: 0 };
  }

  const tasks = listTasksForProject(db, project.id);
  // Prefer current work when a role has multiple historical tasks.
  const rank: Record<string, number> = { IN_PROGRESS: 0, IN_REVIEW: 1, BLOCKED: 2, FAILED: 3, ASSIGNED: 4, PENDING: 5, DONE: 6 };
  const taskByRoleId = new Map<string, TaskRow>();
  for (const task of [...tasks].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))) {
    if (!taskByRoleId.has(task.roleId)) taskByRoleId.set(task.roleId, task);
  }
  const pendingApprovalCount = listApprovalsForProject(db, project.id).filter(a => a.status === "PENDING").length;

  const agents = roles.map((role) => buildAgentView(db, role, project, taskByRoleId.get(role.id), { tasks, pendingApprovalCount, now }));
  const completed = tasks.filter((t) => t.status === "DONE").length;

  const workspaceRow = getWorkspace(db, project.id);
  const hasWorkspace = workspaceRow !== undefined;
  const deliveryState = workspaceRow?.deliveryState ?? null;
  const stalled = isStalledWithNoDeliverable({
    status: project.status,
    allTasksDone: tasks.length > 0 && completed === tasks.length,
    hasWorkspace,
    deliveryState,
  });

  return {
    selectedProject: {
      id: project.id,
      title: project.title,
      status: project.status,
      displayStatusLabel: stalled ? STALLED_NO_DELIVERABLE_LABEL : getHonestStatusLabel(project.status, hasWorkspace, deliveryState),
      isUnverifiedCompletion: isUnverifiedCompletionClaim(project.status, hasWorkspace, deliveryState),
      isStalledWithNoDeliverable: stalled,
      progress: { completed, total: tasks.length },
      provider: projectProviderLabel(project),
      aiPolicyMode: project.aiPolicyMode,
    },
    projects,
    agents,
    activeAgentCount: agents.filter((a) => a.roleId !== "orchestrator" && isActiveVisualState(a.status)).length,
  };
}

// ---- agent detail panel -------------------------------------------------

export type AgentTaskStepState = "COMPLETE" | "ACTIVE" | "PENDING";

export interface AgentTaskLifecycleStep {
  label: string;
  state: AgentTaskStepState;
}

export interface AgentFailureHistoryEntry {
  reason: string;
  resolved: boolean;
  /** From the same classifier `agent-runner.ts` uses to decide retry-budget consumption — an infrastructure hiccup (timeout, malformed JSON) vs. a real semantic problem with the work itself. */
  operational: boolean;
  occurredAt: number;
}

/** The Orchestrator never gets a task row of its own — its real, observable state is project-wide: which roles it selected, where the pipeline currently stands, what's blocked, and what's awaiting the owner. Section 38's "distinct central role," not a generic worker card. */
export interface OrchestratorProjectView {
  selectedRoleIds: string[];
  blockedTaskTitles: string[];
  pendingApprovalCount: number;
  nextAction: string;
}

export interface AgentDetailView {
  roleId: string;
  roleName: string;
  status: OfficeAgentVisualStatus;
  projectId: string | null;
  projectTitle: string | null;
  currentTaskTitle: string | null;
  taskStatus: string | null;
  attemptCount: number;
  maxRetries: number;
  provider: string | null;
  /** The exact model this role's most recent real run used (e.g. "claude-sonnet-5", "gemma4:latest") — `null` for a SimulatedAdapter run or before any run has happened. */
  model: string | null;
  lastCompletedTaskTitle: string | null;
  latestArtifactPreview: string | null;
  recentActivity: ActivityEntry[];
  /** Real workspace files this role's current task last touched (Phase 8 Part O) — never fabricated, derived from `workspace_files.lastModifiedByTaskId`. Empty for a role/task that never wrote a real file. */
  filesChanged: WorkspaceFileRow[];
  /** The current task's most recent real test result, if any — e.g. qa-agent's real Playwright verification (durationMs/targetUrl populated only for a real check, never a fixture). */
  latestTestResult: TestResultRow | null;
  /** A coarse, honest execution lifecycle — only as fine-grained as real, already-persisted signals actually support (task status, real materialized files, a real test result). Never fabricated sub-steps the backend doesn't expose. */
  currentTaskSteps: AgentTaskLifecycleStep[];
  /** Full retry/failure history for this role's current (or most recent) task — resolved and unresolved, oldest first. */
  failureHistory: AgentFailureHistoryEntry[];
  /** Decisions/assumptions this role itself recorded (`madeBy === roleId`) — real notes, never a fabricated journal. */
  decisions: Array<{ type: string; summary: string; rationale: string | null; createdAt: number }>;
  orchestrator: OrchestratorProjectView | null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Honest, coarse lifecycle steps for one task — every step is a direct read of already-persisted state, never an invented fine-grained progress log. */
function buildCurrentTaskSteps(
  role: AgentRoleRow,
  task: TaskRow | undefined,
  filesChanged: WorkspaceFileRow[],
  latestTestResult: TestResultRow | null,
): AgentTaskLifecycleStep[] {
  if (!task) return [];

  const started = task.status !== "PENDING";
  const inProgress = task.status === "IN_PROGRESS";
  const done = task.status === "DONE";
  const steps: AgentTaskLifecycleStep[] = [
    { label: "Assigned", state: "COMPLETE" },
    { label: "Executing", state: done || (started && !inProgress) ? "COMPLETE" : inProgress ? "ACTIVE" : "PENDING" },
  ];

  if (isDevelopmentRole(role)) {
    steps.push({ label: "Files materialized", state: filesChanged.length > 0 ? "COMPLETE" : done ? "COMPLETE" : "PENDING" });
  } else if (isReviewRole(role)) {
    steps.push({
      label: "Verification recorded",
      state: latestTestResult ? "COMPLETE" : done ? "COMPLETE" : "PENDING",
    });
  }

  steps.push({ label: "Completed", state: done ? "COMPLETE" : "PENDING" });
  return steps;
}

/** Powers the click-an-agent drawer — same underlying data as the office floor, plus a short recent-activity slice and a truncated preview of the role's most recent artifact. Never returns raw prompts/internal reasoning — only already-public artifact content and event descriptions the rest of the UI already shows. */
export function getAgentDetail(db: DatabaseSync, roleId: string, selectedProjectId?: string): AgentDetailView | undefined {
  const role = getAgentRole(db, roleId);
  if (!role) return undefined;

  const floor = getOfficeFloorView(db, selectedProjectId);
  const agent = floor.agents.find((a) => a.roleId === roleId);
  if (!agent) return undefined;

  const project = floor.selectedProject;
  let latestArtifactPreview: string | null = null;
  let recentActivity: ActivityEntry[] = [];
  let taskStatus: string | null = null;
  let filesChanged: WorkspaceFileRow[] = [];
  let latestTestResult: TestResultRow | null = null;
  let model: string | null = null;
  let currentTaskSteps: AgentTaskLifecycleStep[] = [];
  let failureHistory: AgentFailureHistoryEntry[] = [];
  let decisions: AgentDetailView["decisions"] = [];
  let orchestrator: OrchestratorProjectView | null = null;
  const maxRetries = role.maxRetries;

  if (project) {
    const tasks = listTasksForProject(db, project.id);
    const task = tasks.find((t) => t.id === agent.taskId);
    taskStatus = task?.status ?? null;

    const artifacts = listArtifactsForProject(db, project.id).filter((a: ArtifactRow) => a.taskId === task?.id);
    const latest = [...artifacts].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest) latestArtifactPreview = truncate(latest.content, 320);

    if (task) {
      // Rebuilt as plain object literals — `node:sqlite`'s `.get()`/`.all()`
      // rows are null-prototype objects, which React refuses to serialize
      // across the Server->Client Component boundary ("Only plain
      // objects... can be passed to Client Components"). Every other
      // field on this view is already built this way; these two were the
      // one place a raw DB row leaked straight through.
      filesChanged = listWorkspaceFileRecords(db, project.id)
        .filter((f) => f.lastModifiedByTaskId === task.id)
        .map((f) => ({ ...f }));
      const testResults = listTestResultsForTask(db, task.id);
      const latest = testResults[testResults.length - 1];
      latestTestResult = latest ? { ...latest } : null;

      model = agent.model ?? null;
      currentTaskSteps = buildCurrentTaskSteps(role, task, filesChanged, latestTestResult);
      failureHistory = listFailuresForTask(db, task.id).map((f) => ({
        reason: f.reason,
        resolved: f.resolved === 1,
        operational: isOperationalFailureReason(f.reason),
        occurredAt: f.createdAt,
      }));
    }

    recentActivity = listEventsForProject(db, project.id)
      .filter((event) => {
        try {
          const payload = JSON.parse(event.payload) as { roleId?: string };
          return payload.roleId === roleId;
        } catch {
          return false;
        }
      })
      .slice(0, 8)
      .map((event) => ({
        id: event.id,
        occurredAt: event.occurredAt,
        projectId: event.projectId,
        message: describeEvent(db, event),
        category: categorizeEventType(event.type),
      }));

    decisions = listDecisionsForProject(db, project.id)
      .filter((d) => d.madeBy === roleId)
      .map((d) => ({ type: d.type, summary: d.summary, rationale: d.rationale, createdAt: d.createdAt }));

    if (roleId === "orchestrator") {
      const selectedRoleIds = tasks.map((t) => t.roleId);
      const blockedTaskTitles = tasks.filter((t) => t.status === "BLOCKED").map((t) => t.title);
      const pendingApprovalCount = listApprovalsForProject(db, project.id).filter((a) => a.status === "PENDING").length;
      const inProgress = tasks.find((t) => t.status === "IN_PROGRESS");
      const nextAction =
        pendingApprovalCount > 0
          ? "Waiting on owner approval before continuing."
          : blockedTaskTitles.length > 0
            ? "Blocked — awaiting owner review."
            : inProgress
              ? `Waiting on ${getAgentRole(db, inProgress.roleId)?.name ?? inProgress.roleId} to finish "${inProgress.title}."`
              : tasks.length > 0 && tasks.every((t) => t.status === "DONE")
                ? "All planned work is complete."
                : "Waiting on the runner to pick up the next eligible task.";
      orchestrator = { selectedRoleIds, blockedTaskTitles, pendingApprovalCount, nextAction };
    }
  }

  return {
    roleId: role.id,
    roleName: role.name,
    status: agent.status,
    projectId: project?.id ?? null,
    projectTitle: project?.title ?? null,
    currentTaskTitle: agent.currentTaskTitle,
    taskStatus,
    attemptCount: agent.attemptCount,
    maxRetries,
    provider: agent.provider,
    model,
    lastCompletedTaskTitle: agent.lastCompletedTaskTitle,
    latestArtifactPreview,
    recentActivity,
    filesChanged,
    latestTestResult,
    currentTaskSteps,
    failureHistory,
    decisions,
    orchestrator,
  };
}
