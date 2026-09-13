import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getTask, listTasksForProject, type TaskRow } from "../domain/tasks.ts";
import { getProject, updateProjectStatus } from "../domain/projects.ts";
import { listPendingApprovalsForProject } from "../domain/project-outputs.ts";
import { recordEvent, recordAuditEntry } from "../domain/events.ts";

/**
 * Real, generic platform capability found missing during the first full
 * autonomous Pomodoro pilot: a task that exceeds its role's `maxRetries`
 * escalates to `BLOCKED` (agent-runner.ts) with no way to ever retry it
 * again — `project-transitions.ts`'s `resumeProject` deliberately refuses
 * to touch a `BLOCKED` project for exactly this reason ("a blocked
 * project's block... has its own resolution path (retry, owner approval
 * decision)"), but that "retry" path never actually existed anywhere in
 * the codebase. Once the real root cause of a repeated failure is fixed
 * (a platform defect, a stale upstream artifact, transient provider
 * flakiness), the owner needs a real way to say "try this again" —
 * without which ANY project that ever exhausts a retry ceiling is
 * permanently stuck, regardless of whether the underlying cause was
 * fixed.
 *
 * Deliberately NOT a silent revert to PENDING with the old attempt
 * count intact — that would just re-escalate on the very next attempt,
 * since the ceiling check is `attempt.attemptNumber > role.maxRetries`
 * against the task's own persisted `attemptCount`.
 *
 * Real defect found and fixed during the first genuine Claude LIVE
 * pilot: an earlier version of this function reset `attemptCount` itself
 * to 0 to grant a fresh window. That's wrong — `task_attempts
 * .attemptNumber` is derived from `attemptCount + 1` and is UNIQUE per
 * (taskId, attemptNumber), and prior attempts are never deleted (full
 * history preserved, by design). Resetting attemptCount to 0 guaranteed
 * the very next `createTaskAttempt` call would collide with the
 * already-existing attempt 1 row — an immediate `UNIQUE constraint
 * failed` on every reclaim, forever, disguised as a 5-minute "Claude is
 * slow" hang because each crash silently orphaned the task in
 * IN_PROGRESS until the next crash-recovery sweep retried the exact same
 * broken reclaim.
 *
 * Fixed by never touching `attemptCount` (it keeps incrementing forever,
 * exactly like a normal retry) and instead recording
 * `retryBaselineAttemptCount = attemptCount` at the moment of retry —
 * agent-runner.ts's ceiling check then compares an attempt's number
 * against this baseline rather than 0, granting a genuinely fresh
 * window while attemptNumber allocation never collides with history.
 * Never touches `task_attempts`/`failures`/`messages_events` — every
 * prior attempt's real history stays exactly as it was, the same "never
 * delete or overwrite history" principle already used for approval
 * revocation.
 */

export interface TaskRetryResult {
  ok: true;
  task: TaskRow;
}
export interface TaskRetryFailure {
  ok: false;
  reason: string;
}

export function checkTaskRetryEligibility(db: DatabaseSync, task: TaskRow): { eligible: boolean; reason?: string } {
  if (task.status !== "BLOCKED") {
    return { eligible: false, reason: "Only a blocked (escalated) task can be retried." };
  }
  return { eligible: true };
}

export function retryEscalatedTask(
  db: DatabaseSync,
  taskId: string,
  actorUserId: string,
  note?: string,
): TaskRetryResult | TaskRetryFailure {
  const task = getTask(db, taskId);
  if (!task) return { ok: false, reason: "Task not found." };

  const eligibility = checkTaskRetryEligibility(db, task);
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason! };

  const project = getProject(db, task.projectId);
  if (!project) return { ok: false, reason: "Project not found." };

  const now = Date.now();
  const result = db
    .prepare(
      `UPDATE tasks SET status = 'PENDING', retryBaselineAttemptCount = attemptCount, leaseOwnerId = NULL, leaseExpiresAt = NULL, updatedAt = ?
       WHERE id = ? AND status = 'BLOCKED'`,
    )
    .run(now, taskId);
  if (Number(result.changes) === 0) {
    return { ok: false, reason: "This task is no longer blocked — it may already have been retried." };
  }

  // Only unblock the project if this was the reason it was blocked — a
  // different still-open block (another escalated task, a pending
  // approval) must keep the project BLOCKED, exactly like
  // approveApproval's own equivalent check.
  if (project.status === "BLOCKED") {
    const otherBlockedTasks = listTasksForProject(db, project.id).some((t) => t.id !== taskId && t.status === "BLOCKED");
    const stillHasPendingApproval = listPendingApprovalsForProject(db, project.id).length > 0;
    if (!otherBlockedTasks && !stillHasPendingApproval) {
      updateProjectStatus(db, project.id, "IN_PROGRESS");
    }
  }

  recordEvent(db, {
    projectId: task.projectId,
    type: "task.retried",
    payload: { taskId, roleId: task.roleId, previousAttemptCount: task.attemptCount, reason: note?.trim() || null },
    actor: actorUserId,
  });
  recordAuditEntry(db, { actor: actorUserId, action: "task.retried", targetType: "task", targetId: taskId });

  return { ok: true, task: getTask(db, taskId)! };
}
