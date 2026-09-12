import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getOfficeStatus, type OfficeState } from "../domain/office.ts";
import { listProjects, getProjectIdea, type ProjectRow, type ProjectStatus, type AiMode, type ProjectProvider } from "../domain/projects.ts";
import { listTasksForProject } from "../domain/tasks.ts";
import { listUnresolvedFailures, listPendingApprovalsForProject, type ApprovalKind } from "../domain/project-outputs.ts";
import { listPendingApprovals } from "../domain/project-outputs.ts";
import { listRecentEvents, type MessageEventRow } from "../domain/events.ts";
import { sumSimulatedCostForProject, sumLiveCostForProject } from "../domain/budget.ts";
import { getBudgetSnapshot, type BudgetSnapshot } from "../budget/budget-service.ts";

/**
 * Read-only aggregation for the private dashboard
 * (`app/office/(protected)/page.tsx`) — every function here only reads;
 * nothing is mutated. Kept separate from the domain repositories (which
 * stay single-table) since these queries genuinely need to join/combine
 * several tables into view-shaped data a page can render directly.
 */

export interface OfficeOverview {
  officeState: OfficeState;
  activeProjects: number;
  pausedProjects: number;
  blockedProjects: number;
  readyForReviewProjects: number;
  pendingApprovals: number;
  tasksCompleted: number;
  tasksRunning: number;
  tasksBlocked: number;
  simulatedRuns: number;
  currentMonthLiveCostUsd: number;
}

function countProjectsByStatus(db: DatabaseSync, status: ProjectStatus): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status = ?").get(status) as { count: number };
  return row.count;
}

function countTasksByStatus(db: DatabaseSync, status: string): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = ?").get(status) as { count: number };
  return row.count;
}

export function getOfficeOverview(db: DatabaseSync): OfficeOverview {
  const office = getOfficeStatus(db);
  const budget = getBudgetSnapshot(db);

  return {
    officeState: office?.state ?? "CLOSED",
    activeProjects: countProjectsByStatus(db, "IN_PROGRESS"),
    pausedProjects: countProjectsByStatus(db, "PAUSED"),
    blockedProjects: countProjectsByStatus(db, "BLOCKED"),
    readyForReviewProjects: countProjectsByStatus(db, "READY_FOR_REVIEW"),
    pendingApprovals: listPendingApprovals(db).length,
    tasksCompleted: countTasksByStatus(db, "DONE"),
    tasksRunning: countTasksByStatus(db, "IN_PROGRESS"),
    tasksBlocked: countTasksByStatus(db, "BLOCKED"),
    simulatedRuns: budget.simulatedRuns,
    currentMonthLiveCostUsd: budget.liveSpendUsd,
  };
}

export interface ProjectSummary {
  id: string;
  title: string;
  ideaSummary: string;
  status: ProjectStatus;
  aiMode: AiMode;
  provider: ProjectProvider;
  totalTasks: number;
  completedTasks: number;
  currentTaskTitle: string | null;
  currentTaskRoleId: string | null;
  latestAgentRoleId: string | null;
  unresolvedFailures: number;
  pendingApprovals: number;
  simulatedCostUsd: number;
  liveCostUsd: number;
  canPause: boolean;
  canResume: boolean;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function getProjectSummaries(db: DatabaseSync): ProjectSummary[] {
  return listProjects(db).map((project) => summarizeProject(db, project));
}

function summarizeProject(db: DatabaseSync, project: ProjectRow): ProjectSummary {
  const idea = getProjectIdea(db, project.id);
  const tasks = listTasksForProject(db, project.id);
  const completedTasks = tasks.filter((task) => task.status === "DONE").length;
  // The oldest non-DONE task is the most useful "what's next" signal —
  // it's either actively running or the next thing eligible to run.
  const currentTask = tasks.find((task) => task.status !== "DONE") ?? null;
  const latestAttemptedTask = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

  return {
    id: project.id,
    title: project.title,
    ideaSummary: idea ? truncate(idea.rawText, 140) : "",
    status: project.status,
    aiMode: project.aiMode,
    provider: project.provider,
    totalTasks: tasks.length,
    completedTasks,
    currentTaskTitle: currentTask?.title ?? null,
    currentTaskRoleId: currentTask?.roleId ?? null,
    latestAgentRoleId: latestAttemptedTask?.roleId ?? null,
    unresolvedFailures: listUnresolvedFailures(db, project.id).length,
    pendingApprovals: listPendingApprovalsForProject(db, project.id).length,
    simulatedCostUsd: sumSimulatedCostForProject(db, project.id),
    liveCostUsd: sumLiveCostForProject(db, project.id), // must stay $0 through Phase 6 — no live provider exists yet
    canPause: project.status === "IN_PROGRESS",
    canResume: project.status === "PAUSED",
  };
}

// ---- activity feed ---------------------------------------------------

export interface ActivityEntry {
  id: string;
  occurredAt: number;
  projectId: string | null;
  message: string;
}

const EVENT_DESCRIPTIONS: Record<string, (payload: Record<string, unknown>) => string> = {
  "project.planned": (p) => `Project planned — ${(p.taskCount as number) ?? "?"} tasks across ${((p.roles as string[]) ?? []).length} roles.`,
  "task.claimed": () => "A task was claimed by the runner.",
  "task.executed": (p) => `A task finished executing — outcome: ${String(p.outcome ?? "unknown")}.`,
  "task.recovered_after_crash": () => "An interrupted task was recovered after a crash and returned to the queue.",
  "task.escalated": () => "A task exceeded its retry limit and was escalated — project blocked pending review.",
  "task.invalidated_by_upstream_change": () => "A completed review was invalidated because the code it reviewed changed again.",
  "task.budget_refused": (p) => `A task was refused by the budget gate — ${String(p.reason ?? "budget not authorized")}.`,
  "agent_run.succeeded": (p) => `${String(p.roleId ?? "An agent")} completed its task successfully.`,
  "agent_run.failed": (p) => `${String(p.roleId ?? "An agent")} reported a failure — ${String(p.reason ?? "no reason given")}.`,
  "approval.required": (p) => `Owner approval requested (${String(p.kind ?? p.matchedSignal ?? "review needed")}).`,
  "approval.approved": (p) => `Approval decision: approved (${String(p.kind ?? "")}).`,
  "approval.rejected": (p) => `Approval decision: rejected (${String(p.kind ?? "")}).`,
  "project.live_mode_refused": () => "A LIVE-mode task was refused — no live provider exists yet.",
  "office.opened": () => "The Office was opened.",
  "office.closed": (p) => (p.reason ? `The Office was closed — ${String(p.reason)}.` : "The Office was closed."),
  "project.paused": () => "The project was paused.",
  "project.resumed": () => "The project was resumed.",
  "budget.cap_changed": (p) => `Monthly AI budget cap changed from $${p.oldCapUsd ?? "?"} to $${p.newCapUsd ?? "?"}.`,
};

/** Turns a raw event row into a human-readable sentence — never raw JSON. Unknown event types fall back to a readable version of the type string, so a future event type never renders as literally nothing. */
export function describeEvent(event: MessageEventRow): string {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(event.payload) as Record<string, unknown>;
  } catch {
    // malformed payload — fall through to the type-name fallback below
  }
  const describe = EVENT_DESCRIPTIONS[event.type];
  if (describe) return describe(payload);
  return event.type.replace(/[._]/g, " ");
}

export function getRecentActivity(db: DatabaseSync, limit = 30): ActivityEntry[] {
  return listRecentEvents(db, limit).map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    projectId: event.projectId,
    message: describeEvent(event),
  }));
}

// ---- approvals ---------------------------------------------------------

export interface PendingApprovalView {
  id: string;
  kind: ApprovalKind;
  projectId: string | null;
  projectTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  requestedBy: string;
  createdAt: number;
  scopeLabel: string;
  reason: string | null;
}

export function getPendingApprovalsView(db: DatabaseSync): PendingApprovalView[] {
  const pending = listPendingApprovals(db);
  return pending.map((approval) => {
    const project = approval.projectId ? listProjects(db).find((p) => p.id === approval.projectId) : undefined;
    const task = approval.taskId
      ? (db.prepare("SELECT title FROM tasks WHERE id = ?").get(approval.taskId) as { title: string } | undefined)
      : undefined;
    let reason: string | null = null;
    try {
      const context = JSON.parse(approval.context) as { reason?: string };
      reason = context.reason ?? null;
    } catch {
      reason = null;
    }

    return {
      id: approval.id,
      kind: approval.kind,
      projectId: approval.projectId,
      projectTitle: project?.title ?? null,
      taskId: approval.taskId,
      taskTitle: task?.title ?? null,
      requestedBy: approval.requestedBy,
      createdAt: approval.createdAt,
      scopeLabel: approval.taskId ? "This task only" : approval.projectId ? "Entire project" : "Office-wide",
      reason,
    };
  });
}

// ---- runner visibility ---------------------------------------------------

export interface RunnerActivityView {
  officeState: OfficeState;
  lastActivityAt: number | null;
  hasRecentActivity: boolean;
  message: string;
}

const RUNNER_EVENT_TYPES = ["task.executed", "task.recovered_after_crash", "task.claimed", "project.live_mode_refused"];
/** A heuristic freshness window, not a real heartbeat — see the module docblock. */
const RECENT_ACTIVITY_WINDOW_MS = 2 * 60 * 1000;

function formatRelativeTime(fromMs: number, nowMs: number): string {
  const diffSeconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (diffSeconds < 60) return "just now";
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Honest, persisted-state-only runner visibility — never claims "Runner
 * Online" (that would require a real heartbeat this system doesn't
 * have). Only ever describes what's actually knowable: when the Runner
 * last did something, derived from its own activity events.
 */
export function getRunnerActivityView(db: DatabaseSync, now = Date.now()): RunnerActivityView {
  const office = getOfficeStatus(db);
  const placeholders = RUNNER_EVENT_TYPES.map(() => "?").join(",");
  const row = db
    .prepare(`SELECT MAX(occurredAt) as lastActivityAt FROM messages_events WHERE type IN (${placeholders})`)
    .get(...RUNNER_EVENT_TYPES) as { lastActivityAt: number | null };

  const lastActivityAt = row.lastActivityAt;
  const hasRecentActivity = lastActivityAt !== null && now - lastActivityAt < RECENT_ACTIVITY_WINDOW_MS;

  let message: string;
  if (office?.state !== "OPEN") {
    message = "Office is closed — the runner will not claim new work until it's reopened.";
  } else if (lastActivityAt === null) {
    message = "Office is open, but no runner activity has ever been recorded. Start the local runner with `npm run ai-office:runner`.";
  } else if (hasRecentActivity) {
    message = `Last runner activity: ${formatRelativeTime(lastActivityAt, now)}.`;
  } else {
    message = `Office is open, but no recent runner activity was detected (last seen ${formatRelativeTime(lastActivityAt, now)}). Start the local runner to process work.`;
  }

  return { officeState: office?.state ?? "CLOSED", lastActivityAt, hasRecentActivity, message };
}

export interface BudgetView extends BudgetSnapshot {
  monthLabel: string;
}

export function getBudgetView(db: DatabaseSync): BudgetView {
  const snapshot = getBudgetSnapshot(db);
  const monthLabel = new Date(snapshot.periodStart).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { ...snapshot, monthLabel };
}
