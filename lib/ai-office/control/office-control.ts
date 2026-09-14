import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getOfficeStatus, setOfficeStatus, type OfficeStatusRow } from "../domain/office.ts";
import { recordEvent } from "../domain/events.ts";
import { recordAuditEntry } from "../domain/events.ts";

/**
 * The owner-facing Office Open/Close controls — thin, but deliberately
 * not "just call `setOfficeStatus`": every real open/close action also
 * needs an audit entry (docs/ai-office/11-implementation-phases.md's
 * Phase 6 status note, "Audit Log") and a dashboard-facing activity
 * event, and must be a no-op (not an error, not a duplicate event) if
 * the office is already in the requested state — a Server Action can be
 * invoked twice (double-click, retry) and must not spam the activity
 * feed with two "Office opened" entries for one real action.
 *
 * Never touches projects/tasks/leases/budget — closing the Office is
 * purely a state flag the Runner reads before claiming new work
 * (`lib/ai-office/runner/runner.ts`'s `runOneCycle`); everything else is
 * left exactly as it was, per the Phase 6 brief's explicit "closing must
 * not delete/reset/destroy anything."
 */

export interface OfficeControlResult {
  status: OfficeStatusRow;
  changed: boolean;
}

export function openOffice(db: DatabaseSync, actorUserId: string): OfficeControlResult {
  const current = getOfficeStatus(db);
  if (current?.state === "OPEN") {
    return { status: current, changed: false };
  }

  const status = setOfficeStatus(db, { state: "OPEN", changedBy: actorUserId, reason: null });
  recordEvent(db, { projectId: null, type: "office.opened", payload: {}, actor: actorUserId });
  recordAuditEntry(db, { actor: actorUserId, action: "office.opened", targetType: "office_status", targetId: "singleton" });
  return { status, changed: true };
}

export function closeOffice(db: DatabaseSync, actorUserId: string, reason?: string): OfficeControlResult {
  const current = getOfficeStatus(db);
  if (current?.state === "CLOSED") {
    return { status: current, changed: false };
  }

  const status = setOfficeStatus(db, { state: "CLOSED", changedBy: actorUserId, reason: reason ?? null });
  recordEvent(db, { projectId: null, type: "office.closed", payload: reason ? { reason } : {}, actor: actorUserId });
  recordAuditEntry(db, { actor: actorUserId, action: "office.closed", targetType: "office_status", targetId: "singleton" });
  return { status, changed: true };
}
