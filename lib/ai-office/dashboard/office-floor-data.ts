import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { listAgentRoles, getAgentRole, type AgentRoleRow } from "../domain/agent-roles.ts";
import { isReviewRole } from "../agents/remediation.ts";
import { listProjects, getProject, type ProjectRow, type ProjectStatus } from "../domain/projects.ts";
import { listTasksForProject, listTaskAttempts, getAgentRun, type TaskRow, type AgentRunRow } from "../domain/tasks.ts";
import { listArtifactsForProject, listTestResultsForTask, type ArtifactRow, type TestResultRow } from "../domain/project-outputs.ts";
import { listEventsForProject } from "../domain/events.ts";
import { describeEvent, type ActivityEntry } from "./dashboard-data.ts";
import { listWorkspaceFileRecords, type WorkspaceFileRow } from "../domain/workspace.ts";

/**
 * Read-only "office floor" projection — turns real, already-persisted
 * project/task/agent-run state into one visual status per one of the 11
 * catalog roles, for the animated office UI. No schema changes, no new
 * writes, no randomness: every status here is a deterministic function of
 * data that already exists for an entirely different reason (the ordinary
 * dashboard/project-detail views). If nothing is happening, every agent is
 * IDLE — there is no code path that invents activity.
 */

export type OfficeAgentVisualStatus = "IDLE" | "WORKING" | "THINKING" | "REVIEWING" | "WAITING" | "BLOCKED" | "DONE" | "PAUSED";

export interface OfficeAgentView {
  roleId: string;
  roleName: string;
  status: OfficeAgentVisualStatus;
  currentTaskTitle: string | null;
  lastCompletedTaskTitle: string | null;
  attemptCount: number;
  /** The provider that produced (or will produce) this role's work in the selected project — "simulated" | "ollama" | null when nothing has run yet and nothing is scheduled. */
  provider: string | null;
}

export interface OfficeFloorProjectOption {
  id: string;
  title: string;
  status: ProjectStatus;
}

export interface OfficeFloorView {
  selectedProject: {
    id: string;
    title: string;
    status: ProjectStatus;
    progress: { completed: number; total: number };
    provider: string;
  } | null;
  projects: OfficeFloorProjectOption[];
  agents: OfficeAgentView[];
}

/** A DONE task still reads as a brief "DONE" pulse for this long after completing (this is a page-render snapshot, refreshed by the existing 5s AutoRefresh poll — not a live timer). After that it settles to IDLE with lastCompletedTaskTitle set. */
const RECENT_DONE_WINDOW_MS = 15_000;

/** Roles whose output is analysis/design rather than typing-code or reviewing — a real, catalog-derived (not hardcoded-id) split so IN_PROGRESS work reads as "thinking" vs "working" vs "reviewing" without inventing any new state. */
const THINKING_OUTPUTS = ["requirements", "research-notes", "architecture", "ux-spec"];

function isThinkingRole(role: AgentRoleRow): boolean {
  const outputs = JSON.parse(role.allowedOutputs) as string[];
  return outputs.some((o) => THINKING_OUTPUTS.includes(o));
}

/** The provider label for a project's own (not-yet-run) work — the project's configured `provider` column ("simulated" | "ollama"), or "live" for a (currently unreachable) LIVE-mode project. */
function projectProviderLabel(project: ProjectRow): string {
  return project.aiMode === "LIVE" ? "live" : project.provider;
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
  db: DatabaseSync,
  role: AgentRoleRow,
  project: ProjectRow,
  task: TaskRow | undefined,
  ctx: { mostRecentDoneAt: number; now: number },
): OfficeAgentView {
  // The Orchestrator never gets a task row of its own (it plans the graph,
  // it doesn't execute a step in it) — its only observable real state is
  // "the project is currently in the synchronous planning phase."
  if (role.id === "orchestrator") {
    const planning = project.status === "PLANNING";
    return {
      roleId: role.id,
      roleName: role.name,
      status: planning ? "WORKING" : "IDLE",
      currentTaskTitle: null,
      lastCompletedTaskTitle: null,
      attemptCount: 0,
      provider: planning ? projectProviderLabel(project) : null,
    };
  }

  if (!task) return idleAgent(role);

  const latestRun = getLatestAgentRunForTask(db, task.id);
  const provider = latestRun?.provider ?? (task.status === "PENDING" ? null : projectProviderLabel(project));

  if (project.status === "PAUSED" && task.status !== "DONE") {
    return {
      roleId: role.id,
      roleName: role.name,
      status: "PAUSED",
      currentTaskTitle: task.title,
      lastCompletedTaskTitle: null,
      attemptCount: task.attemptCount,
      provider,
    };
  }

  if (task.status === "BLOCKED") {
    return { roleId: role.id, roleName: role.name, status: "BLOCKED", currentTaskTitle: task.title, lastCompletedTaskTitle: null, attemptCount: task.attemptCount, provider };
  }

  if (task.status === "DONE") {
    const isRecent = task.updatedAt === ctx.mostRecentDoneAt && ctx.now - task.updatedAt <= RECENT_DONE_WINDOW_MS;
    return {
      roleId: role.id,
      roleName: role.name,
      status: isRecent ? "DONE" : "IDLE",
      currentTaskTitle: null,
      lastCompletedTaskTitle: task.title,
      attemptCount: task.attemptCount,
      provider,
    };
  }

  if (task.status === "IN_PROGRESS") {
    const status: OfficeAgentVisualStatus = isReviewRole(role) ? "REVIEWING" : isThinkingRole(role) ? "THINKING" : "WORKING";
    return { roleId: role.id, roleName: role.name, status, currentTaskTitle: task.title, lastCompletedTaskTitle: null, attemptCount: task.attemptCount, provider };
  }

  // PENDING (and the currently-unused ASSIGNED/IN_REVIEW/FAILED values) —
  // whether or not its dependencies are satisfied, this reads the same:
  // the role hasn't started yet.
  return { roleId: role.id, roleName: role.name, status: "WAITING", currentTaskTitle: task.title, lastCompletedTaskTitle: null, attemptCount: task.attemptCount, provider };
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
    return { selectedProject: null, projects, agents: roles.map(idleAgent) };
  }

  const tasks = listTasksForProject(db, project.id);
  const taskByRoleId = new Map(tasks.map((t) => [t.roleId, t]));
  const doneAtValues = tasks.filter((t) => t.status === "DONE").map((t) => t.updatedAt);
  const mostRecentDoneAt = doneAtValues.length > 0 ? Math.max(...doneAtValues) : 0;

  const agents = roles.map((role) => buildAgentView(db, role, project, taskByRoleId.get(role.id), { mostRecentDoneAt, now }));
  const completed = tasks.filter((t) => t.status === "DONE").length;

  return {
    selectedProject: { id: project.id, title: project.title, status: project.status, progress: { completed, total: tasks.length }, provider: projectProviderLabel(project) },
    projects,
    agents,
  };
}

// ---- agent detail panel -------------------------------------------------

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
  lastCompletedTaskTitle: string | null;
  latestArtifactPreview: string | null;
  recentActivity: ActivityEntry[];
  /** Real workspace files this role's current task last touched (Phase 8 Part O) — never fabricated, derived from `workspace_files.lastModifiedByTaskId`. Empty for a role/task that never wrote a real file. */
  filesChanged: WorkspaceFileRow[];
  /** The current task's most recent real test result, if any — e.g. qa-agent's real Playwright verification (durationMs/targetUrl populated only for a real check, never a fixture). */
  latestTestResult: TestResultRow | null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
  const maxRetries = role.maxRetries;

  if (project) {
    const tasks = listTasksForProject(db, project.id);
    const task = tasks.find((t) => t.roleId === roleId);
    taskStatus = task?.status ?? null;

    const artifacts = listArtifactsForProject(db, project.id).filter((a: ArtifactRow) => a.taskId === task?.id);
    const latest = [...artifacts].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest) latestArtifactPreview = truncate(latest.content, 320);

    if (task) {
      filesChanged = listWorkspaceFileRecords(db, project.id).filter((f) => f.lastModifiedByTaskId === task.id);
      const testResults = listTestResultsForTask(db, task.id);
      latestTestResult = testResults[testResults.length - 1] ?? null;
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
      .map((event) => ({ id: event.id, occurredAt: event.occurredAt, projectId: event.projectId, message: describeEvent(event) }));
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
    lastCompletedTaskTitle: agent.lastCompletedTaskTitle,
    latestArtifactPreview,
    recentActivity,
    filesChanged,
    latestTestResult,
  };
}
