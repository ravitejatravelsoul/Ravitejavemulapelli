import "server-only";
import type { DatabaseSync } from "node:sqlite";

/**
 * office_status repository — persistence only. No workflow behavior
 * (Office Close stopping the Durable Runner's dispatch loop, etc.) is
 * implemented here; that's Phase 5/6. This phase only needs the
 * singleton to exist, be readable, and be updatable without ever
 * duplicating. See docs/ai-office/06-data-model.md §2.
 */

export type OfficeState = "OPEN" | "CLOSED";

export interface OfficeStatusRow {
  id: "singleton";
  state: OfficeState;
  changedAt: number;
  changedBy: string | null;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

export function getOfficeStatus(db: DatabaseSync): OfficeStatusRow | undefined {
  return db.prepare("SELECT * FROM office_status WHERE id = 'singleton'").get() as OfficeStatusRow | undefined;
}

/** Upserts the singleton row — safe even if seedOfficeStatus hasn't run yet, and never creates a second row (fixed 'singleton' id + ON CONFLICT). */
export function setOfficeStatus(
  db: DatabaseSync,
  input: { state: OfficeState; changedBy: string | null; reason: string | null },
): OfficeStatusRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO office_status (id, state, changedAt, changedBy, reason, createdAt, updatedAt)
     VALUES ('singleton', ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       state = excluded.state,
       changedAt = excluded.changedAt,
       changedBy = excluded.changedBy,
       reason = excluded.reason,
       updatedAt = excluded.updatedAt`,
  ).run(input.state, now, input.changedBy, input.reason, now, now);

  return getOfficeStatus(db) as OfficeStatusRow;
}
