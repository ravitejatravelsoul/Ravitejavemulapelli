import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID, randomInt } from "node:crypto";
import type { EscalationUrgency } from "./notification-policy.ts";

export type EscalationStatus =
  | "PENDING"
  | "CALLING"
  | "SMS_SENT"
  | "WAITING_FOR_RESPONSE"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "FAILED"
  | "CANCELLED";

export interface EscalationRow {
  id: string;
  projectId: string | null;
  approvalId: string | null;
  agentRole: string | null;
  type: string;
  urgency: EscalationUrgency;
  reason: string;
  estimatedCostUsd: number | null;
  status: EscalationStatus;
  channelAttempted: string | null;
  responseCode: string | null;
  responseCodeUsed: 0 | 1;
  expiresAt: number;
  resolvedAt: number | null;
  resolution: string | null;
  ownerResponse: string | null;
  providerMessageId: string | null;
  providerCallId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A 4-digit, human-speakable/typeable one-time code — not a security secret on its own (Section E), just enough to tie a reply to the exact escalation it answers rather than trusting free text alone. */
function generateResponseCode(): string {
  return String(randomInt(1000, 10000));
}

export function createEscalation(
  db: DatabaseSync,
  input: {
    projectId?: string | null;
    approvalId?: string | null;
    agentRole?: string | null;
    type: string;
    urgency: EscalationUrgency;
    reason: string;
    estimatedCostUsd?: number | null;
    expiresInMs: number;
  },
): EscalationRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO escalations
       (id, projectId, approvalId, agentRole, type, urgency, reason, estimatedCostUsd, status, channelAttempted, responseCode, responseCodeUsed, expiresAt, resolvedAt, resolution, ownerResponse, providerMessageId, providerCallId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(
    id,
    input.projectId ?? null,
    input.approvalId ?? null,
    input.agentRole ?? null,
    input.type,
    input.urgency,
    input.reason,
    input.estimatedCostUsd ?? null,
    generateResponseCode(),
    now + input.expiresInMs,
    now,
    now,
  );
  return getEscalation(db, id) as EscalationRow;
}

export function getEscalation(db: DatabaseSync, id: string): EscalationRow | undefined {
  return db.prepare("SELECT * FROM escalations WHERE id = ?").get(id) as EscalationRow | undefined;
}

/** The one still-open escalation for this exact approval, if any — the dedupe check that keeps one repeated failure from triggering ten phone calls (Section L). */
export function findOpenEscalationForApproval(db: DatabaseSync, approvalId: string): EscalationRow | undefined {
  return db
    .prepare(
      `SELECT * FROM escalations WHERE approvalId = ? AND status IN ('PENDING','CALLING','SMS_SENT','WAITING_FOR_RESPONSE') ORDER BY createdAt DESC LIMIT 1`,
    )
    .get(approvalId) as EscalationRow | undefined;
}

/** The most recent escalation for this approval regardless of status — powers the Approval card's "External escalation: ..." line (Section O), which should also show a resolved-by-SMS state, not just an open one. */
export function findLatestEscalationForApproval(db: DatabaseSync, approvalId: string): EscalationRow | undefined {
  return db.prepare(`SELECT * FROM escalations WHERE approvalId = ? ORDER BY createdAt DESC LIMIT 1`).get(approvalId) as EscalationRow | undefined;
}

/** A real, valid, not-yet-used response code for a still-open escalation — the exact lookup an inbound SMS reply resolves through. Expiry/used-state are still re-checked by the caller so this can't silently accept a stale match. */
export function findOpenEscalationByResponseCode(db: DatabaseSync, code: string): EscalationRow | undefined {
  return db
    .prepare(
      `SELECT * FROM escalations WHERE responseCode = ? AND responseCodeUsed = 0 AND status IN ('PENDING','CALLING','SMS_SENT','WAITING_FOR_RESPONSE') ORDER BY createdAt DESC LIMIT 1`,
    )
    .get(code) as EscalationRow | undefined;
}

export function countRecentExternalEscalations(db: DatabaseSync, sinceMs: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM escalations WHERE createdAt >= ? AND channelAttempted IS NOT NULL`)
    .get(Date.now() - sinceMs) as { c: number };
  return row.c;
}

export function updateEscalationStatus(
  db: DatabaseSync,
  id: string,
  status: EscalationStatus,
  fields: Partial<{
    channelAttempted: string[];
    providerMessageId: string;
    providerCallId: string;
    resolution: string;
    ownerResponse: string;
    resolved: boolean;
    markResponseCodeUsed: boolean;
  }> = {},
): EscalationRow {
  const now = Date.now();
  const current = getEscalation(db, id);
  if (!current) throw new Error(`updateEscalationStatus: no escalation with id ${id}`);

  const channelAttempted = fields.channelAttempted ? JSON.stringify(fields.channelAttempted) : current.channelAttempted;

  db.prepare(
    `UPDATE escalations SET
       status = ?,
       channelAttempted = ?,
       providerMessageId = COALESCE(?, providerMessageId),
       providerCallId = COALESCE(?, providerCallId),
       resolution = COALESCE(?, resolution),
       ownerResponse = COALESCE(?, ownerResponse),
       responseCodeUsed = ?,
       resolvedAt = ?,
       updatedAt = ?
     WHERE id = ?`,
  ).run(
    status,
    channelAttempted,
    fields.providerMessageId ?? null,
    fields.providerCallId ?? null,
    fields.resolution ?? null,
    fields.ownerResponse ?? null,
    fields.markResponseCodeUsed ? 1 : current.responseCodeUsed,
    fields.resolved ? now : current.resolvedAt,
    now,
    id,
  );
  return getEscalation(db, id) as EscalationRow;
}

/** Office-wide history, newest first — the owner-only Escalation History view (Section N). */
export function listRecentEscalations(db: DatabaseSync, limit = 50): EscalationRow[] {
  return db.prepare("SELECT * FROM escalations ORDER BY createdAt DESC LIMIT ?").all(limit) as unknown as EscalationRow[];
}

export function listOpenEscalations(db: DatabaseSync): EscalationRow[] {
  return db
    .prepare(`SELECT * FROM escalations WHERE status IN ('PENDING','CALLING','SMS_SENT','WAITING_FOR_RESPONSE') ORDER BY createdAt DESC`)
    .all() as unknown as EscalationRow[];
}

/** Expires every open escalation whose deadline has passed — called defensively on read paths rather than needing a background scheduler (this office already has no cron; see the runner's own poll-based design). */
export function expireOverdueEscalations(db: DatabaseSync, now: number = Date.now()): number {
  const result = db
    .prepare(
      `UPDATE escalations SET status = 'EXPIRED', resolvedAt = ?, resolution = 'No owner response before expiry.', updatedAt = ?
       WHERE status IN ('PENDING','CALLING','SMS_SENT','WAITING_FOR_RESPONSE') AND expiresAt < ?`,
    )
    .run(now, now, now);
  return Number(result.changes);
}
