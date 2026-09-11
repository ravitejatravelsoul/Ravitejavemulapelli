import "server-only";
import type { DatabaseSync } from "node:sqlite";
import {
  getApproval,
  decideApproval,
  createApproval,
  listPendingApprovalsForProject,
  type ApprovalRow,
  type ApprovalKind,
} from "../domain/project-outputs.ts";
import { getProject, updateProjectStatus } from "../domain/projects.ts";
import { updateTaskStatus } from "../domain/tasks.ts";
import { recordEvent, recordAuditEntry } from "../domain/events.ts";
import { updateOfficeBudgetCap, startOfCurrentMonthUtc } from "../domain/budget.ts";

/**
 * The real owner approval workflow — Phase 5 only created the PENDING
 * approval row + a project-wide block; this module is what "the owner
 * decides" actually does. Two operations, `approveApproval`/
 * `rejectApproval`, both funneled through the same
 * `decideApproval()` idempotency guard
 * (`lib/ai-office/domain/project-outputs.ts` — a `WHERE status =
 * 'PENDING'` UPDATE that silently no-ops a duplicate decision rather
 * than double-applying side effects).
 *
 * **Exact-scope enforcement, restated concretely**: approving or
 * rejecting an approval only ever touches *this* approval's own scope
 * (`taskId`, or the whole project if `taskId` is NULL) — never "does
 * this project have any approved approval," which would let one
 * approval silently authorize an unrelated later action. See
 * `lib/ai-office/runner/eligibility.ts` for the matching read-side
 * enforcement.
 */

export type ApprovalDecisionResult = { ok: true; approval: ApprovalRow } | { ok: false; reason: string };

function guardPending(approval: ApprovalRow | undefined): { ok: true } | { ok: false; reason: string } {
  if (!approval) return { ok: false, reason: "Approval not found." };
  if (approval.status !== "PENDING") return { ok: false, reason: "This approval has already been decided." };
  return { ok: true };
}

export function approveApproval(
  db: DatabaseSync,
  input: { approvalId: string; decidedByUserId: string; note?: string },
): ApprovalDecisionResult {
  const approval = getApproval(db, input.approvalId);
  const guard = guardPending(approval);
  if (!guard.ok) return guard;

  const decided = decideApproval(db, input.approvalId, "APPROVED", { decidedBy: input.decidedByUserId, note: input.note });
  if (decided.status !== "APPROVED") {
    // Lost a decision race against another call — the row is already
    // terminal, just not the way this call intended.
    return { ok: false, reason: "This approval has already been decided." };
  }

  // A budget-increase approval's whole point is that the persisted cap
  // only changes *after* this decision — never before, never
  // automatically. Applied here, inside the same decision that approved
  // it, so "approved" and "cap changed" can never disagree.
  if (decided.kind === "budget_increase") {
    applyApprovedBudgetIncrease(db, decided, input.decidedByUserId);
  }

  // Project-wide (taskId NULL) approvals BLOCK the whole project at
  // creation time (see orchestrator.ts / requestBudgetIncreaseApproval
  // below) — once no other PENDING approval remains for the project,
  // it's safe to let it resume. A task-scoped approval never blocked
  // the project itself (only that one task stayed ineligible via
  // eligibility.ts's join), so there's nothing to unblock here besides
  // the approval row itself clearing.
  if (decided.taskId === null && decided.projectId) {
    const project = getProject(db, decided.projectId);
    const stillBlocked = listPendingApprovalsForProject(db, decided.projectId).length > 0;
    if (project?.status === "BLOCKED" && !stillBlocked) {
      updateProjectStatus(db, decided.projectId, "IN_PROGRESS");
    }
  }

  recordEvent(db, {
    projectId: decided.projectId,
    type: "approval.approved",
    payload: { approvalId: decided.id, kind: decided.kind, taskId: decided.taskId },
    actor: input.decidedByUserId,
  });
  recordAuditEntry(db, { actor: input.decidedByUserId, action: "approval.approved", targetType: "approval", targetId: decided.id });

  return { ok: true, approval: decided };
}

export function rejectApproval(
  db: DatabaseSync,
  input: { approvalId: string; decidedByUserId: string; note?: string },
): ApprovalDecisionResult {
  const approval = getApproval(db, input.approvalId);
  const guard = guardPending(approval);
  if (!guard.ok) return guard;

  const decided = decideApproval(db, input.approvalId, "REJECTED", { decidedBy: input.decidedByUserId, note: input.note });
  if (decided.status !== "REJECTED") {
    return { ok: false, reason: "This approval has already been decided." };
  }

  // A rejection must actively stick — the action stays blocked, not
  // just "unapproved." `decideApproval`'s row alone doesn't stop
  // anything (eligibility only ever checks for a PENDING row), so the
  // scoped task/project is moved to BLOCKED explicitly here, the same
  // terminal state an exhausted retry ceiling already produces.
  if (decided.taskId) {
    updateTaskStatus(db, decided.taskId, "BLOCKED");
  } else if (decided.projectId) {
    updateProjectStatus(db, decided.projectId, "BLOCKED");
  }

  recordEvent(db, {
    projectId: decided.projectId,
    type: "approval.rejected",
    payload: { approvalId: decided.id, kind: decided.kind, taskId: decided.taskId },
    actor: input.decidedByUserId,
  });
  recordAuditEntry(db, { actor: input.decidedByUserId, action: "approval.rejected", targetType: "approval", targetId: decided.id });

  return { ok: true, approval: decided };
}

function applyApprovedBudgetIncrease(db: DatabaseSync, approval: ApprovalRow, decidedByUserId: string): void {
  const context = JSON.parse(approval.context) as { scope?: "office" | "project"; oldCapUsd?: number; newCapUsd?: number };
  if (context.scope !== "office" || typeof context.newCapUsd !== "number") return; // malformed/unexpected context — nothing safe to apply

  const periodStart = startOfCurrentMonthUtc();
  updateOfficeBudgetCap(db, periodStart, { capUsd: context.newCapUsd });

  recordEvent(db, {
    projectId: null,
    type: "budget.cap_changed",
    payload: { oldCapUsd: context.oldCapUsd, newCapUsd: context.newCapUsd, approvalId: approval.id },
    actor: decidedByUserId,
  });
  recordAuditEntry(db, { actor: decidedByUserId, action: "budget.cap_changed", targetType: "budget_records", targetId: "office" });
}

/**
 * Creates the auditable request for an office monthly-cap increase —
 * called when `BudgetService.authorize()` blocks a request that exceeds
 * the cap and an owner override is wanted (never automatically; see
 * `lib/ai-office/budget/budget-service.ts`). The persisted cap does not
 * change until this approval is later approved
 * (`applyApprovedBudgetIncrease` above) — never on creation.
 */
export function requestBudgetIncreaseApproval(
  db: DatabaseSync,
  input: { currentCapUsd: number; requestedCapUsd: number; reason: string; requestedBy: string },
): ApprovalRow {
  if (!(input.requestedCapUsd > input.currentCapUsd)) {
    throw new Error("requestBudgetIncreaseApproval: requestedCapUsd must be greater than the current cap.");
  }

  const kind: ApprovalKind = "budget_increase";
  const approval = createApproval(db, {
    kind,
    requestedBy: input.requestedBy,
    context: {
      scope: "office",
      oldCapUsd: input.currentCapUsd,
      newCapUsd: input.requestedCapUsd,
      reason: input.reason,
    },
  });

  recordEvent(db, {
    projectId: null,
    type: "approval.required",
    payload: { approvalId: approval.id, kind, oldCapUsd: input.currentCapUsd, newCapUsd: input.requestedCapUsd },
    actor: input.requestedBy,
  });
  recordAuditEntry(db, { actor: input.requestedBy, action: "budget.increase_requested", targetType: "approval", targetId: approval.id });

  return approval;
}
