import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getOfficeStatus, type OfficeState } from "../domain/office.ts";
import { listProjects, getProjectIdea, type ProjectRow, type ProjectStatus, type AiMode, type ProjectProvider } from "../domain/projects.ts";
import { listTasksForProject, listTaskAttempts, getAgentRun, getTask } from "../domain/tasks.ts";
import { getAgentRole } from "../domain/agent-roles.ts";
import { listTestResultsForTask } from "../domain/project-outputs.ts";
import { listUnresolvedFailures, listPendingApprovalsForProject, type ApprovalKind } from "../domain/project-outputs.ts";
import { listPendingApprovals } from "../domain/project-outputs.ts";
import { listRecentEvents, type MessageEventRow } from "../domain/events.ts";
import { sumSimulatedCostForProject, sumLiveCostForProject } from "../domain/budget.ts";
import { getBudgetSnapshot, type BudgetSnapshot } from "../budget/budget-service.ts";
import { getWorkspace, listWorkspaceFileRecords, getMostRecentRunnerHeartbeat, type DeliveryState } from "../domain/workspace.ts";
import { getHonestStatusLabel, isUnverifiedCompletionClaim, isStalledWithNoDeliverable, STALLED_NO_DELIVERABLE_LABEL } from "./delivery-status.ts";
import { findLatestEscalationForApproval } from "../domain/escalations.ts";

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
  /** Status READY_FOR_REVIEW but no real deliverable has been verified yet — surfaced separately so it's never silently folded into `readyForReviewProjects`'s count. */
  readyForReviewUnverifiedProjects: number;
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

/**
 * Phase 8 Part L applies to this overview card too — "Ready for Review"
 * must count projects that are genuinely ready, not merely every project
 * whose `status` happens to be READY_FOR_REVIEW (which today includes
 * simulated-text-only workflows with no real deliverable). A project
 * counts here only if it has no workspace at all (a legacy/pure-text
 * project, for which the status itself is honest) OR its workspace's
 * deliverable is VERIFIED.
 */
function countHonestlyReadyForReviewProjects(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM projects p
       WHERE p.status = 'READY_FOR_REVIEW'
         AND NOT EXISTS (
           SELECT 1 FROM workspaces w WHERE w.projectId = p.id AND w.deliveryState != 'VERIFIED'
         )`,
    )
    .get() as { count: number };
  return row.count;
}

function countTasksByStatus(db: DatabaseSync, status: string): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = ?").get(status) as { count: number };
  return row.count;
}

export function getOfficeOverview(db: DatabaseSync): OfficeOverview {
  const office = getOfficeStatus(db);
  const budget = getBudgetSnapshot(db);
  const honestlyReady = countHonestlyReadyForReviewProjects(db);
  const rawReady = countProjectsByStatus(db, "READY_FOR_REVIEW");

  return {
    officeState: office?.state ?? "CLOSED",
    activeProjects: countProjectsByStatus(db, "IN_PROGRESS"),
    pausedProjects: countProjectsByStatus(db, "PAUSED"),
    blockedProjects: countProjectsByStatus(db, "BLOCKED"),
    readyForReviewProjects: honestlyReady,
    readyForReviewUnverifiedProjects: rawReady - honestlyReady,
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
  /** The role's display name for `currentTaskRoleId` — e.g. "Frontend Developer" — so the Projects board can show which agent is actively working/waiting without the card needing its own DB access (Part 2 of the platform-hardening phase). */
  currentTaskRoleName: string | null;
  latestAgentRoleId: string | null;
  unresolvedFailures: number;
  pendingApprovals: number;
  simulatedCostUsd: number;
  liveCostUsd: number;
  canPause: boolean;
  canResume: boolean;
  /** Phase 8 Part L — the honest completion label to display instead of `status` (identical to `status` unless the project claims completion without a verified real deliverable). */
  displayStatusLabel: string;
  isUnverifiedCompletion: boolean;
  isStalledWithNoDeliverable: boolean;
  updatedAt: number;
  aiPolicyMode: import("../domain/projects.ts").AiPolicyMode;
  deliveryState: DeliveryState | null;
  canPreview: boolean;
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
  const workspace = getWorkspace(db, project.id);
  const deliveryState: DeliveryState | null = workspace?.deliveryState ?? null;
  const stalled = isStalledWithNoDeliverable({
    status: project.status,
    allTasksDone: tasks.length > 0 && completedTasks === tasks.length,
    hasWorkspace: workspace !== undefined,
    deliveryState,
  });

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
    currentTaskRoleName: currentTask ? (getAgentRole(db, currentTask.roleId)?.name ?? currentTask.roleId) : null,
    latestAgentRoleId: latestAttemptedTask?.roleId ?? null,
    unresolvedFailures: listUnresolvedFailures(db, project.id).length,
    pendingApprovals: listPendingApprovalsForProject(db, project.id).length,
    simulatedCostUsd: sumSimulatedCostForProject(db, project.id),
    liveCostUsd: sumLiveCostForProject(db, project.id), // must stay $0 through Phase 6 — no live provider exists yet
    canPause: project.status === "IN_PROGRESS",
    canResume: project.status === "PAUSED",
    displayStatusLabel: stalled ? STALLED_NO_DELIVERABLE_LABEL : getHonestStatusLabel(project.status, workspace !== undefined, deliveryState),
    isUnverifiedCompletion: isUnverifiedCompletionClaim(project.status, workspace !== undefined, deliveryState),
    isStalledWithNoDeliverable: stalled,
    updatedAt: project.updatedAt,
    aiPolicyMode: project.aiPolicyMode,
    deliveryState,
    canPreview: deliveryState === "VERIFIED" && listWorkspaceFileRecords(db, project.id).some((f) => f.path === "index.html"),
  };
}

// ---- activity feed ---------------------------------------------------

/**
 * Platform-hardening phase, Part 4 — an owner reported the Activity
 * experience read as generic "agent collaboration" rather than a useful
 * execution timeline. `category` lets the UI offer real filtering
 * (All/Work/Failures/Recovery/Approvals/Cost) driven by the event's own
 * real type, never a fabricated grouping.
 */
export type ActivityCategory = "WORK" | "FAILURE" | "RECOVERY" | "APPROVAL" | "COST";

export interface ActivityEntry {
  id: string;
  occurredAt: number;
  projectId: string | null;
  message: string;
  category: ActivityCategory;
}

const EVENT_CATEGORY: Record<string, ActivityCategory> = {
  "agent_run.failed": "FAILURE",
  "task.escalated": "FAILURE",
  "task.budget_refused": "FAILURE",
  "project.live_mode_refused": "FAILURE",
  "task.claude_routing_blocked": "FAILURE",
  "budget.overage_detected": "FAILURE",
  "task.recovered_after_crash": "RECOVERY",
  "task.invalidated_by_upstream_change": "RECOVERY",
  "office_engineer.repairing": "RECOVERY",
  "office_engineer.escalated": "RECOVERY",
  "approval.required": "APPROVAL",
  "approval.approved": "APPROVAL",
  "approval.rejected": "APPROVAL",
  "approval.revoked": "APPROVAL",
  "budget.cap_changed": "COST",
  "claude.context_budget_warning": "COST",
};

export function categorizeEventType(type: string): ActivityCategory {
  return EVENT_CATEGORY[type] ?? "WORK";
}

const EVENT_DESCRIPTIONS: Record<string, (payload: Record<string, unknown>) => string> = {
  "project.planned": (p) => `Product Owner planned the project — ${(p.taskCount as number) ?? "?"} tasks across ${((p.roles as string[]) ?? []).length} roles.`,
  "task.claimed": (p) => `${roleLabel(p)} started work${p.taskTitle ? ` on "${String(p.taskTitle)}"` : ""}.`,
  "task.executed": (p) => `${roleLabel(p)}'s attempt finished — outcome: ${String(p.outcome ?? "unknown")}.`,
  "task.recovered_after_crash": () => "Office Engineer detected a stalled task (an interrupted attempt with an expired lease) and returned it to the queue.",
  "task.escalated": (p) => `${roleLabel(p)} exceeded its retry limit and was escalated — project blocked pending review.`,
  "task.invalidated_by_upstream_change": () => "A completed review was invalidated because the code it reviewed changed again.",
  "task.budget_refused": (p) => `A task was refused by the budget gate — ${String(p.reason ?? "budget not authorized")}.`,
  "agent_run.succeeded": (p) => `${roleLabel(p)} completed "${String(p.taskTitle ?? "its task")}" successfully.${p.detail ? ` ${String(p.detail)}` : ""}`,
  "agent_run.failed": (p) => `${roleLabel(p)}'s attempt on "${String(p.taskTitle ?? "its task")}" failed — ${String(p.reason ?? "no reason given")}`,
  "approval.required": (p) => `Owner approval requested (${String(p.kind ?? p.matchedSignal ?? "review needed")}).`,
  "approval.approved": (p) => `Approval decision: approved (${String(p.kind ?? "")}).`,
  "approval.rejected": (p) => `Approval decision: rejected (${String(p.kind ?? "")}).`,
  "approval.revoked": (p) => `Approval decision: revoked (${String(p.kind ?? "")}) — the paid action is blocked again until a new approval.`,
  "project.live_mode_refused": () => "A LIVE-mode task was refused — no live provider exists yet.",
  "office.opened": () => "The Office was opened.",
  "office.closed": (p) => (p.reason ? `The Office was closed — ${String(p.reason)}.` : "The Office was closed."),
  "project.paused": () => "The project was paused.",
  "project.resumed": () => "The project was resumed.",
  "budget.cap_changed": (p) => `Monthly AI budget cap changed from $${p.oldCapUsd ?? "?"} to $${p.newCapUsd ?? "?"}.`,
  "budget.overage_detected": () => "A completed paid AI call's actual cost pushed the monthly budget over its cap — new paid calls are refused until the owner raises it.",
  "task.claude_routing_blocked": (p) =>
    `Paid AI (Claude) routing for ${String(p.roleId ?? "a role")} is blocked — ${String(p.reason ?? "not yet actionable")}.`,
  "claude.context_budget_warning": (p) =>
    `CONTEXT BUDGET WARNING — ${String(p.roleId ?? "a role")}'s call used ${String(p.estimatedInputTokens ?? "?")} tokens, above its ${String(p.targetEstimatedInputTokens ?? "?")}-token target but within its ${String(p.burstEstimatedInputTokens ?? "?")}-token burst allowance.`,
  "office_engineer.repairing": (p) => `Office Engineer diagnosed a stuck task as a transient/operational failure and is auto-retrying it — ${String(p.incidentId ?? "")}`.trim(),
  "office_engineer.escalated": () => "Office Engineer found a task blocked by a real content/logic problem — escalated for owner attention, never auto-retried.",
};

function roleLabel(p: Record<string, unknown>): string {
  const name = p.roleName;
  if (typeof name === "string" && name.length > 0) return name;
  const id = p.roleId;
  return typeof id === "string" && id.length > 0 ? id.replace(/-/g, " ") : "An agent";
}

/**
 * Turns a raw event row into a human-readable sentence — never raw
 * JSON. Unknown event types fall back to a readable version of the type
 * string, so a future event type never renders as literally nothing.
 * `db` is used to resolve real role names and task titles (never
 * fabricated — absent from the payload means the raw id is shown
 * as-is) so the sentence reads like "Frontend Developer" and a real
 * task title, not a raw `roleId`/`taskId`.
 */
export function describeEvent(db: DatabaseSync, event: MessageEventRow): string {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(event.payload) as Record<string, unknown>;
  } catch {
    // malformed payload — fall through to the type-name fallback below
  }

  const relatedTask = typeof payload.taskId === "string" ? getTask(db, payload.taskId) : undefined;
  if (typeof payload.roleId !== "string" && relatedTask) payload.roleId = relatedTask.roleId;
  if (typeof payload.roleId === "string") {
    payload.roleName = getAgentRole(db, payload.roleId)?.name ?? payload.roleId;
  }
  if (relatedTask && !payload.taskTitle) {
    payload.taskTitle = relatedTask.title;
  }
  if ((event.type === "agent_run.succeeded" || event.type === "agent_run.failed") && typeof payload.taskId === "string" && typeof payload.attemptNumber === "number") {
    payload.detail = describeAgentRunDetail(db, payload.taskId, payload.attemptNumber, payload.roleId as string | undefined);
  }

  const describe = EVENT_DESCRIPTIONS[event.type];
  if (describe) return describe(payload);
  return event.type.replace(/[._]/g, " ");
}

/** Real, non-fabricated detail for a completed attempt — provider/model actually used, and (for a QA role) the real browser-verification test result. `undefined` (never guessed) whenever the underlying attempt/agent-run/test-result rows can't be found. */
function describeAgentRunDetail(db: DatabaseSync, taskId: string, attemptNumber: number, roleId: string | undefined): string | undefined {
  const attempt = listTaskAttempts(db, taskId).find((a) => a.attemptNumber === attemptNumber);
  const agentRun = attempt?.agentRunId ? getAgentRun(db, attempt.agentRunId) : undefined;
  const parts: string[] = [];
  if (agentRun) parts.push(`(${agentRun.provider}${agentRun.model ? ` · ${agentRun.model}` : ""})`);
  if (roleId === "qa-agent") {
    const latestTest = listTestResultsForTask(db, taskId).at(-1);
    if (latestTest) parts.push(`Browser verification: ${latestTest.status}${latestTest.summary ? ` — ${latestTest.summary}` : ""}.`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function getRecentActivity(db: DatabaseSync, limit = 30): ActivityEntry[] {
  return listRecentEvents(db, limit).map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    projectId: event.projectId,
    message: describeEvent(db, event),
    category: categorizeEventType(event.type),
  }));
}

// ---- approvals ---------------------------------------------------------

export interface PendingApprovalView {
  estimatedCostUsd?: number;
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
  /** The provider this approval is for (e.g. "claude"), parsed from the approval's own `context` — `null` for approval kinds that never set one (e.g. `destructive_db_action`). */
  provider: string | null;
  /** The agent role id this approval is for (e.g. "frontend-developer"), parsed the same way as `provider`. */
  roleId: string | null;
  /** A human-readable line describing the real external-escalation state for this approval, if any has ever been raised — Section O's "External escalation: SMS sent / waiting for response" convergence. */
  escalationStatus: string | null;
}

function describeEscalationStatus(escalation: { status: string; channelAttempted: string | null }): string | null {
  const channels = escalation.channelAttempted ? (JSON.parse(escalation.channelAttempted) as string[]) : [];
  const channelLabel = channels.length > 0 ? channels.join(" → ") : "in-app";
  switch (escalation.status) {
    case "CALLING":
      return "External escalation: calling…";
    case "SMS_SENT":
      return "External escalation: SMS sent, waiting for response";
    case "WAITING_FOR_RESPONSE":
      return `External escalation: waiting for response (${channelLabel})`;
    case "APPROVED":
      return `Owner approved by ${channelLabel}`;
    case "REJECTED":
      return `Owner rejected by ${channelLabel}`;
    case "FAILED":
      return "External escalation failed to send";
    case "EXPIRED":
      return "External escalation expired";
    default:
      return null;
  }
}

export function getPendingApprovalsView(db: DatabaseSync): PendingApprovalView[] {
  const pending = listPendingApprovals(db);
  return pending.map((approval) => {
    const escalation = findLatestEscalationForApproval(db, approval.id);
    const escalationStatus = escalation ? describeEscalationStatus(escalation) : null;
    const project = approval.projectId ? listProjects(db).find((p) => p.id === approval.projectId) : undefined;
    const task = approval.taskId
      ? (db.prepare("SELECT title FROM tasks WHERE id = ?").get(approval.taskId) as { title: string } | undefined)
      : undefined;
    let reason: string | null = null;
    let estimatedCostUsd: number | undefined;
    let provider: string | null = null;
    let roleId: string | null = null;
    try {
      const context = JSON.parse(approval.context) as { reason?: string; provider?: string; role?: string; estimatedCostUsd?: unknown };
      if(typeof context.estimatedCostUsd === "number" && Number.isFinite(context.estimatedCostUsd) && context.estimatedCostUsd >= 0)estimatedCostUsd=context.estimatedCostUsd;
      reason = context.reason ?? null;
      provider = context.provider ?? null;
      roleId = context.role ?? null;
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
      ...(estimatedCostUsd === undefined ? {} : {estimatedCostUsd}),
      scopeLabel: approval.taskId ? "This task only" : approval.projectId ? "Entire project" : "Office-wide",
      reason,
      provider,
      roleId,
      escalationStatus,
    };
  });
}

// ---- runner visibility ---------------------------------------------------

export type RunnerLivenessStatus = "ONLINE_IDLE" | "ONLINE_WORKING" | "OFFLINE";

export interface RunnerActivityView {
  officeState: OfficeState;
  lastActivityAt: number | null;
  hasRecentActivity: boolean;
  message: string;
  /** Phase 8 Part P — a real liveness signal from `runner_heartbeats`, not the old activity-event heuristic. `OFFLINE` whenever no runner has reported in within `HEARTBEAT_STALE_MS`, regardless of office state — an offline worker is never called "idle." */
  runnerStatus: RunnerLivenessStatus;
}

const RUNNER_EVENT_TYPES = ["task.executed", "task.recovered_after_crash", "task.claimed", "project.live_mode_refused"];
/** A heuristic freshness window for the legacy activity-event fields, kept only for backward compatibility — `runnerStatus` above is the real signal now. */
const RECENT_ACTIVITY_WINDOW_MS = 2 * 60 * 1000;
/** Several multiples of the runner's default 5s poll interval — generous enough to absorb a slow cycle without flapping to OFFLINE, tight enough that a genuinely dead process is caught within seconds, not minutes. */
const HEARTBEAT_STALE_MS = 20 * 1000;

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
 * Real runner liveness from `runner_heartbeats` (upserted every poll
 * tick by the standalone runner process, lib/ai-office/runner/start.ts)
 * — a project can be IN_PROGRESS while the runner process isn't
 * actually running, which used to make the UI look merely "idle." This
 * distinguishes that case (OFFLINE) from a runner that's alive but has
 * no eligible work right now (ONLINE_IDLE).
 */
export function getRunnerActivityView(db: DatabaseSync, now = Date.now()): RunnerActivityView {
  const office = getOfficeStatus(db);
  const placeholders = RUNNER_EVENT_TYPES.map(() => "?").join(",");
  const row = db
    .prepare(`SELECT MAX(occurredAt) as lastActivityAt FROM messages_events WHERE type IN (${placeholders})`)
    .get(...RUNNER_EVENT_TYPES) as { lastActivityAt: number | null };

  const lastActivityAt = row.lastActivityAt;
  const hasRecentActivity = lastActivityAt !== null && now - lastActivityAt < RECENT_ACTIVITY_WINDOW_MS;

  const heartbeat = getMostRecentRunnerHeartbeat(db);
  const heartbeatFresh = heartbeat !== undefined && now - heartbeat.lastSeenAt < HEARTBEAT_STALE_MS;
  const runnerStatus: RunnerLivenessStatus = !heartbeatFresh ? "OFFLINE" : heartbeat!.status === "WORKING" ? "ONLINE_WORKING" : "ONLINE_IDLE";

  let message: string;
  if (runnerStatus === "OFFLINE") {
    message =
      heartbeat === undefined
        ? "No runner process has ever reported in. Start the local runner with `npm run ai-office:runner`."
        : `Runner process is offline (last seen ${formatRelativeTime(heartbeat.lastSeenAt, now)}). Restart it with \`npm run ai-office:runner\`.`;
  } else if (office?.state !== "OPEN") {
    message = "Runner process is online, but Office is closed — it will not claim new work until reopened.";
  } else if (runnerStatus === "ONLINE_WORKING") {
    message = "Runner is online and currently executing a task.";
  } else {
    message = "Runner is online and idle — waiting for eligible work.";
  }

  return { officeState: office?.state ?? "CLOSED", lastActivityAt, hasRecentActivity, message, runnerStatus };
}

export interface BudgetView extends BudgetSnapshot {
  monthLabel: string;
}

export function getBudgetView(db: DatabaseSync): BudgetView {
  const snapshot = getBudgetSnapshot(db);
  const monthLabel = new Date(snapshot.periodStart).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { ...snapshot, monthLabel };
}
