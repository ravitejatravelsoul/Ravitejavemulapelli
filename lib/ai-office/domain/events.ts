import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * messages_events (high-volume activity feed) + audit_log (curated
 * security/budget-relevant actions) — kept as two tables/repositories
 * per docs/ai-office/06-data-model.md §4. `payload`/`context` are
 * arbitrary JSON — callers must never put a secret (session secret, API
 * key, password hash) in either; see
 * docs/ai-office/08-security-plan.md §8, enforced here only by
 * convention/review, not a runtime scanner.
 */

export interface MessageEventRow {
  id: string;
  projectId: string | null;
  type: string;
  payload: string; // JSON
  actor: string;
  occurredAt: number;
  createdAt: number;
}

export interface AuditLogRow {
  id: string;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  occurredAt: number;
  createdAt: number;
}

export function recordEvent(
  db: DatabaseSync,
  input: { projectId: string | null; type: string; payload: Record<string, unknown>; actor: string },
): MessageEventRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages_events (id, projectId, type, payload, actor, occurredAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.type, JSON.stringify(input.payload), input.actor, now, now);
  return db.prepare("SELECT * FROM messages_events WHERE id = ?").get(id) as unknown as MessageEventRow;
}

export function listEventsForProject(db: DatabaseSync, projectId: string): MessageEventRow[] {
  return db
    .prepare("SELECT * FROM messages_events WHERE projectId = ? ORDER BY occurredAt DESC")
    .all(projectId) as unknown as MessageEventRow[];
}

export function recordAuditEntry(
  db: DatabaseSync,
  input: { actor: string; action: string; targetType?: string; targetId?: string },
): AuditLogRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO audit_log (id, actor, action, targetType, targetId, occurredAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.actor, input.action, input.targetType ?? null, input.targetId ?? null, now, now);
  return db.prepare("SELECT * FROM audit_log WHERE id = ?").get(id) as unknown as AuditLogRow;
}

export function listAuditEntries(db: DatabaseSync): AuditLogRow[] {
  return db.prepare("SELECT * FROM audit_log ORDER BY occurredAt DESC").all() as unknown as AuditLogRow[];
}
