import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID, randomInt, randomBytes } from "node:crypto";
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
  callToken: string | null;
  callTokenUsed: 0 | 1;
  responseAttempts: number;
  expiresAt: number;
  resolvedAt: number | null;
  resolution: string | null;
  ownerResponse: string | null;
  providerMessageId: string | null;
  providerCallId: string | null;
  createdAt: number;
  updatedAt: number;
}

// Excludes visually-ambiguous characters (0/O, 1/I/L) — a 32-symbol
// alphabet at 8 characters gives 32^8 (~1.1 trillion) possibilities,
// versus the original 4-digit code's 10,000 — chosen after an external
// security review flagged the original code as brute-forceable.
const RESPONSE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A short, texted, human-typeable one-time code tying an SMS reply to the exact escalation it answers (Section E) — strengthened from digits-only to a longer alphanumeric alphabet; still not a secret on its own, since brute-forcing is stopped by throttling (`escalation_response_attempts`), not by the code's length alone. */
function generateResponseCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += RESPONSE_CODE_ALPHABET[randomInt(0, RESPONSE_CODE_ALPHABET.length)];
  return code;
}

/** A long, opaque, URL-embedded one-time token for the phone-call DTMF callback (Defect 1) — never typed by a human, so it can carry far more entropy than the SMS code, and travels only inside a signed-and-verified Twilio callback URL, never rendered in any UI or log. */
export function generateCallToken(): string {
  return randomBytes(18).toString("base64url");
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
       (id, projectId, approvalId, agentRole, type, urgency, reason, estimatedCostUsd, status, channelAttempted, responseCode, responseCodeUsed, callToken, callTokenUsed, responseAttempts, expiresAt, resolvedAt, resolution, ownerResponse, providerMessageId, providerCallId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, 0, NULL, 0, 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
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

/** Attaches the opaque call-response token generated right before placing a real call — kept separate from `createEscalation` since the token is only ever needed on the CALL path, never for IN_APP/SMS-only escalations. */
export function setCallToken(db: DatabaseSync, id: string, callToken: string): EscalationRow {
  db.prepare("UPDATE escalations SET callToken = ?, updatedAt = ? WHERE id = ?").run(callToken, Date.now(), id);
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

/** A real, valid, not-yet-used call-response token for a still-open escalation — the exact lookup a Twilio DTMF callback resolves through (Defect 1). Expiry/used-state are still re-checked by the caller. */
export function findOpenEscalationByCallToken(db: DatabaseSync, token: string): EscalationRow | undefined {
  return db
    .prepare(
      `SELECT * FROM escalations WHERE callToken = ? AND callTokenUsed = 0 AND status IN ('PENDING','CALLING','SMS_SENT','WAITING_FOR_RESPONSE') ORDER BY createdAt DESC LIMIT 1`,
    )
    .get(token) as EscalationRow | undefined;
}

/**
 * Bumps this escalation's own invalid-attempt counter and, once it
 * crosses the caller-supplied ceiling, locks the escalation (CANCELLED)
 * so it stops accepting any further response — the per-escalation half
 * of Section L's anti-brute-force requirement (the per-sender half lives
 * in `recordResponseAttempt`/`countRecentFailedAttempts` below).
 */
export function incrementResponseAttempts(db: DatabaseSync, id: string, maxAttempts: number): EscalationRow {
  const now = Date.now();
  db.prepare("UPDATE escalations SET responseAttempts = responseAttempts + 1, updatedAt = ? WHERE id = ?").run(now, id);
  const current = getEscalation(db, id) as EscalationRow;
  if (current.responseAttempts >= maxAttempts && current.status !== "CANCELLED") {
    return updateEscalationStatus(db, id, "CANCELLED", { resolution: "Locked after too many invalid response attempts." });
  }
  return current;
}

/** Records one inbound response attempt (valid or not) for per-sender throttling — independent of whether it matched any real escalation, since most brute-force guesses match none at all. */
export function recordResponseAttempt(db: DatabaseSync, input: { channel: "SMS" | "CALL"; fromNumber: string; success: boolean }): void {
  db.prepare("INSERT INTO escalation_response_attempts (id, channel, fromNumber, success, createdAt) VALUES (?, ?, ?, ?, ?)").run(
    randomUUID(),
    input.channel,
    input.fromNumber,
    input.success ? 1 : 0,
    Date.now(),
  );
}

/** How many failed attempts this exact sender has made recently, across any escalation — the actual brute-force stopper, since guessing a code has no dependency on any specific escalation existing. */
export function countRecentFailedAttempts(db: DatabaseSync, fromNumber: string, sinceMs: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM escalation_response_attempts WHERE fromNumber = ? AND success = 0 AND createdAt >= ?`)
    .get(fromNumber, Date.now() - sinceMs) as { c: number };
  return row.c;
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
    markCallTokenUsed: boolean;
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
       callTokenUsed = ?,
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
    fields.markCallTokenUsed ? 1 : current.callTokenUsed,
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
