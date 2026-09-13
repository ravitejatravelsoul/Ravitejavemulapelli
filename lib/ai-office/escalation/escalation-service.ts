import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { decideApproval, getApproval } from "../domain/project-outputs.ts";
import { getAgentRole } from "../domain/agent-roles.ts";
import { getOwner } from "../domain/users.ts";
import {
  createEscalation,
  getEscalation,
  setCallToken,
  generateCallToken,
  findOpenEscalationForApproval,
  findOpenEscalationByResponseCode,
  findOpenEscalationByCallToken,
  incrementResponseAttempts,
  recordResponseAttempt,
  countRecentFailedAttempts,
  updateEscalationStatus,
  countRecentExternalEscalations,
  expireOverdueEscalations,
  type EscalationRow,
} from "../domain/escalations.ts";
import { getEffectiveNotificationPolicy, resolveChannelForUrgency, isWithinQuietHours, isWithinCallWindow, type EscalationUrgency } from "../domain/notification-policy.ts";
import { normalizePhoneNumber, phoneNumbersMatch } from "./phone.ts";
import { getCommunicationProvider } from "./provider-factory.ts";
import type { CommunicationProvider } from "./communication-provider.ts";

const ESCALATION_TTL_MS = 30 * 60 * 1000; // 30 minutes to respond.
const MAX_EXTERNAL_ESCALATIONS_PER_HOUR = 6; // Section L anti-spam ceiling.

// Anti-brute-force (external security review, Defect "strengthen SMS
// response tokens"): a sender is locked out of further attempts once
// they've racked up this many failures in the trailing window, and any
// single escalation locks itself the same way regardless of who's
// attempting it. Neither ceiling is configurable — these are safety
// rails, not a tunable owner preference.
const MAX_FAILED_ATTEMPTS_PER_SENDER = 5;
const FAILED_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_RESPONSE_ATTEMPTS_PER_ESCALATION = 5;

const GENERIC_UNRECOGNIZED_MESSAGE = "Sorry, I didn't understand that reply.";
const GENERIC_CALL_REJECTION = "This request is no longer valid.";

export interface EscalationRequestInput {
  projectId?: string | null;
  approvalId?: string | null;
  agentRole?: string | null;
  type: string;
  urgency: EscalationUrgency;
  reason: string;
  estimatedCostUsd?: number | null;
  ownerPhoneNumber?: string | null;
}

export type EscalationOutcome =
  | { kind: "SKIPPED_POLICY_OFF" }
  | { kind: "SKIPPED_QUIET_HOURS" }
  | { kind: "SKIPPED_RATE_LIMITED" }
  | { kind: "SKIPPED_DUPLICATE"; existing: EscalationRow }
  | { kind: "SKIPPED_NO_PHONE" }
  | { kind: "SENT"; escalation: EscalationRow };

function isTerminalStatus(status: EscalationRow["status"]): boolean {
  return status === "APPROVED" || status === "REJECTED" || status === "EXPIRED" || status === "FAILED" || status === "CANCELLED";
}

function parseChannelAttempted(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The one place anything in the AI Office is allowed to reach the owner
 * outside the app (Section A — "Agents must NOT call or text Teja
 * directly"). Every caller goes through `requestEscalation`; nothing
 * else in this codebase imports a `CommunicationProvider` directly.
 */
export class HumanEscalationService {
  private readonly provider: CommunicationProvider;

  constructor(provider: CommunicationProvider = getCommunicationProvider()) {
    this.provider = provider;
  }

  async requestEscalation(db: DatabaseSync, input: EscalationRequestInput): Promise<EscalationOutcome> {
    const policy = getEffectiveNotificationPolicy(db);
    if (policy.mode === "OFF") return { kind: "SKIPPED_POLICY_OFF" };

    // Dedupe — one open escalation per approval, never a repeat call/SMS
    // for the same still-unresolved request.
    if (input.approvalId) {
      const existing = findOpenEscalationForApproval(db, input.approvalId);
      if (existing) return { kind: "SKIPPED_DUPLICATE", existing };
    }

    const channel = resolveChannelForUrgency(policy, input.urgency);

    // IN_APP resolution still creates a real, auditable escalation row
    // (so the History view and Teja Assistant have something real to
    // show) — it just never calls the communication provider.
    if (channel === "IN_APP") {
      const escalation = createEscalation(db, { ...input, expiresInMs: ESCALATION_TTL_MS });
      const updated = updateEscalationStatus(db, escalation.id, "WAITING_FOR_RESPONSE", { channelAttempted: ["IN_APP"] });
      return { kind: "SENT", escalation: updated };
    }

    if (isWithinQuietHours(policy) && input.urgency !== "URGENT") {
      // Non-urgent work waits for the owner to open the app rather than
      // waking them up — recorded as an in-app-only escalation so it's
      // not silently lost.
      const escalation = createEscalation(db, { ...input, expiresInMs: ESCALATION_TTL_MS });
      updateEscalationStatus(db, escalation.id, "WAITING_FOR_RESPONSE", { channelAttempted: ["IN_APP"] });
      return { kind: "SKIPPED_QUIET_HOURS" };
    }

    if (countRecentExternalEscalations(db, 60 * 60 * 1000) >= MAX_EXTERNAL_ESCALATIONS_PER_HOUR) {
      return { kind: "SKIPPED_RATE_LIMITED" };
    }

    const ownerPhone = input.ownerPhoneNumber ?? process.env.OWNER_PHONE_NUMBER;
    if (!ownerPhone) return { kind: "SKIPPED_NO_PHONE" };

    const escalation = createEscalation(db, { ...input, expiresInMs: ESCALATION_TTL_MS });

    if (channel === "SMS" || (channel === "CALL" && !isWithinCallWindow(policy))) {
      return { kind: "SENT", escalation: await this.sendSmsForEscalation(db, escalation, ownerPhone) };
    }

    // channel === "CALL", within the call window.
    return { kind: "SENT", escalation: await this.placeCallForEscalation(db, escalation, ownerPhone) };
  }

  private smsBody(escalation: EscalationRow): string {
    const lines = [
      `Teja's AI Office needs your decision.`,
      escalation.projectId ? `Project: ${escalation.reason}` : escalation.reason,
      `Reply:`,
      `APPROVE ${escalation.responseCode}`,
      `REJECT ${escalation.responseCode}`,
      `DETAILS ${escalation.responseCode}`,
    ];
    return lines.join("\n");
  }

  private detailsSmsBody(escalation: EscalationRow): string {
    return `${escalation.reason}${escalation.estimatedCostUsd != null ? ` Est. cost: $${escalation.estimatedCostUsd.toFixed(2)}.` : ""}`;
  }

  private voiceMessage(escalation: EscalationRow, roleName: string | null): string {
    const cost = escalation.estimatedCostUsd != null ? ` Estimated maximum cost is ${Math.round(escalation.estimatedCostUsd * 100)} cents.` : "";
    return `Hi. Your AI Office needs approval. ${roleName ?? "An agent"} requests: ${escalation.reason}.${cost} Press 1 to approve, 2 to reject, or 3 to receive details by text.`;
  }

  private async sendSmsForEscalation(db: DatabaseSync, escalation: EscalationRow, to: string): Promise<EscalationRow> {
    updateEscalationStatus(db, escalation.id, "SMS_SENT", { channelAttempted: ["SMS"] });
    try {
      const result = await this.provider.sendSms(to, this.smsBody(escalation));
      return updateEscalationStatus(db, escalation.id, "WAITING_FOR_RESPONSE", { channelAttempted: ["SMS"], providerMessageId: result.providerMessageId });
    } catch {
      return updateEscalationStatus(db, escalation.id, "FAILED", { channelAttempted: ["SMS"], resolution: "SMS send failed." });
    }
  }

  private async placeCallForEscalation(db: DatabaseSync, escalation: EscalationRow, to: string): Promise<EscalationRow> {
    updateEscalationStatus(db, escalation.id, "CALLING", { channelAttempted: ["CALL"] });
    const role = escalation.agentRole ? getAgentRole(db, escalation.agentRole) : undefined;
    const callToken = generateCallToken();
    setCallToken(db, escalation.id, callToken);
    try {
      const result = await this.provider.placeCall(to, this.voiceMessage(escalation, role?.name ?? null), callToken);
      return updateEscalationStatus(db, escalation.id, "WAITING_FOR_RESPONSE", { channelAttempted: ["CALL"], providerCallId: result.providerCallId });
    } catch {
      return this.fallBackToSmsAfterCallFailure(db, escalation.id, to);
    }
  }

  private async fallBackToSmsAfterCallFailure(db: DatabaseSync, escalationId: string, to: string): Promise<EscalationRow> {
    const escalation = getEscalation(db, escalationId);
    if (!escalation) throw new Error(`fallBackToSmsAfterCallFailure: no escalation with id ${escalationId}`);
    return this.sendSmsForEscalation(db, escalation, to);
  }

  /**
   * Driven by a real call-status webhook (Twilio) or, in tests, called
   * directly to simulate one — the exact same code path either way.
   * Section D/E's call→SMS fallback: only fires when the call itself
   * failed to connect a real response, never for a resolved, expired, or
   * already-SMS'd escalation (duplicate Twilio status callbacks, or a
   * status update arriving after the owner already answered/decided,
   * must never trigger a second fallback SMS).
   */
  async handleCallStatusUpdate(db: DatabaseSync, providerCallId: string, status: "answered" | "no-answer" | "busy" | "failed"): Promise<void> {
    const row = db.prepare("SELECT * FROM escalations WHERE providerCallId = ?").get(providerCallId) as EscalationRow | undefined;
    if (!row || isTerminalStatus(row.status)) return;
    if (Date.now() > row.expiresAt) {
      updateEscalationStatus(db, row.id, "EXPIRED", { resolution: "Expired before a response was matched." });
      return;
    }
    if (status === "answered") return; // a real DTMF response arrives via handleCallResponse instead.
    if (parseChannelAttempted(row.channelAttempted).includes("SMS")) return; // fallback already sent once — duplicate status callbacks must not send it again.

    const ownerPhone = process.env.OWNER_PHONE_NUMBER;
    if (!ownerPhone) {
      updateEscalationStatus(db, row.id, "FAILED", { resolution: `Call ${status} and no SMS fallback number configured.` });
      return;
    }
    await this.sendSmsForEscalation(db, row, ownerPhone);
  }

  /** Shared per-sender throttle check — used identically by the SMS and call-response handlers. Returns true when this sender must be refused outright, before any code/token lookup even happens. */
  private isSenderThrottled(db: DatabaseSync, fromNumber: string): boolean {
    return countRecentFailedAttempts(db, fromNumber, FAILED_ATTEMPT_WINDOW_MS) >= MAX_FAILED_ATTEMPTS_PER_SENDER;
  }

  /**
   * Finalizes an APPROVE/REJECT decision through the exact existing
   * `decideApproval` (Section F: "One source of truth") — shared by both
   * the SMS and phone-call response paths. Resolving through either
   * channel invalidates BOTH the SMS response code and the call token,
   * since once the owner has decided, neither the text nor the phone
   * reply should still be able to do anything.
   */
  private decideEscalation(db: DatabaseSync, escalation: EscalationRow, decision: "APPROVED" | "REJECTED", viaLabel: string): { message: string } {
    if (!escalation.approvalId) {
      updateEscalationStatus(db, escalation.id, "CANCELLED", { resolution: "This request has no associated approval to act on.", markResponseCodeUsed: true, markCallTokenUsed: true });
      return { message: "This request has no associated approval to act on." };
    }
    const approval = getApproval(db, escalation.approvalId);
    if (!approval || approval.status !== "PENDING") {
      updateEscalationStatus(db, escalation.id, "CANCELLED", { resolution: "Underlying approval was no longer pending.", markResponseCodeUsed: true, markCallTokenUsed: true });
      return { message: "That request was already resolved." };
    }

    // `decidedBy` is a real FK to `users` — there is exactly one owner
    // account, so that's who a verified SMS/call reply is attributed to;
    // "how" it was decided goes in the free-text note instead.
    const owner = getOwner(db);
    decideApproval(db, escalation.approvalId, decision, { decidedBy: owner?.id, note: `Decided via ${this.provider.name} ${viaLabel}.` });
    updateEscalationStatus(db, escalation.id, decision, {
      ownerResponse: viaLabel,
      resolution: `Owner ${decision.toLowerCase()} via ${this.provider.name} ${viaLabel}.`,
      resolved: true,
      markResponseCodeUsed: true,
      markCallTokenUsed: true,
    });
    return { message: decision === "APPROVED" ? "Approved. Thank you." : "Rejected. Thank you." };
  }

  /**
   * Processes a verified inbound SMS reply. Never a parallel approval
   * mechanism — APPROVE/REJECT flow through `decideEscalation` straight
   * into the existing `decideApproval`.
   *
   * Security-hardening (external review, Defect 2 — "SMS sender identity
   * is not verified"): a valid Twilio signature only proves Twilio
   * relayed this SMS; it does not prove the owner sent it. Every reply
   * must additionally come from the configured `OWNER_PHONE_NUMBER`
   * (normalized/compared as E.164-ish digits) before anything is
   * decided — a mismatch gets the exact same generic response as an
   * unparseable message, so an attacker learns nothing about whether
   * their guessed code was otherwise valid. Both this and code-guessing
   * are also throttled per-sender (`MAX_FAILED_ATTEMPTS_PER_SENDER`).
   */
  handleInboundResponse(db: DatabaseSync, request: { headers: Headers; url: string; rawBody: string }): { message: string } {
    if (!this.provider.verifyInboundRequest(request)) {
      return { message: "" }; // Unverifiable requests get a silent, empty TwiML/response — never a hint about why.
    }

    expireOverdueEscalations(db);
    const { from, body } = this.provider.parseInboundResponse(request.rawBody);
    const normalizedFrom = normalizePhoneNumber(from) ?? from;

    if (this.isSenderThrottled(db, normalizedFrom)) {
      return { message: GENERIC_UNRECOGNIZED_MESSAGE };
    }

    const ownerPhone = process.env.OWNER_PHONE_NUMBER;
    if (!ownerPhone || !phoneNumbersMatch(from, ownerPhone)) {
      recordResponseAttempt(db, { channel: "SMS", fromNumber: normalizedFrom, success: false });
      return { message: GENERIC_UNRECOGNIZED_MESSAGE };
    }

    const match = /^(APPROVE|REJECT|DETAILS|STATUS)\s*([A-Z0-9]{6,10})?$/i.exec(body.trim());
    if (!match) return { message: GENERIC_UNRECOGNIZED_MESSAGE };

    const [, actionRaw, codeRaw] = match;
    const action = actionRaw.toUpperCase();

    if (!codeRaw) {
      return { message: "Please include the code from the text, e.g. APPROVE X7K9QRTM." };
    }
    const code = codeRaw.toUpperCase();

    const escalation = findOpenEscalationByResponseCode(db, code);
    if (!escalation) {
      recordResponseAttempt(db, { channel: "SMS", fromNumber: normalizedFrom, success: false });
      return { message: "That code is invalid, expired, or already used." };
    }
    if (Date.now() > escalation.expiresAt) {
      updateEscalationStatus(db, escalation.id, "EXPIRED", { resolution: "Expired before a response was matched." });
      return { message: "That request has expired." };
    }

    recordResponseAttempt(db, { channel: "SMS", fromNumber: normalizedFrom, success: true });

    if (action === "DETAILS") {
      return { message: this.detailsSmsBody(escalation) };
    }
    if (action === "STATUS") {
      return { message: `Status: ${escalation.status}.` };
    }

    return this.decideEscalation(db, escalation, action === "APPROVE" ? "APPROVED" : "REJECTED", "SMS reply");
  }

  /**
   * Processes a verified inbound phone-call DTMF callback (Defect 1's
   * fix). Identifies the exact escalation purely from the opaque,
   * single-use `callToken` embedded in the callback URL — never from the
   * caller/callee phone numbers alone, and never by reusing the SMS
   * response code (a 1/2/3 keypress can't carry a typed code). `to` is
   * cross-checked against the configured owner number as defense in
   * depth, since the call was always placed TO that exact number.
   */
  handleCallResponse(db: DatabaseSync, request: { headers: Headers; url: string; rawBody: string }): { message: string } {
    if (!this.provider.verifyInboundRequest(request)) {
      return { message: GENERIC_CALL_REJECTION };
    }

    expireOverdueEscalations(db);
    const { from, to, digit } = this.provider.parseInboundCallResponse(request.rawBody);
    const normalizedFrom = normalizePhoneNumber(from) ?? from;

    if (this.isSenderThrottled(db, normalizedFrom)) {
      return { message: GENERIC_CALL_REJECTION };
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const ownerPhone = process.env.OWNER_PHONE_NUMBER;

    if (!token || !ownerPhone || !phoneNumbersMatch(to, ownerPhone)) {
      recordResponseAttempt(db, { channel: "CALL", fromNumber: normalizedFrom, success: false });
      return { message: GENERIC_CALL_REJECTION };
    }

    const escalation = findOpenEscalationByCallToken(db, token);
    if (!escalation) {
      // A missing/invalid/expired/already-used token all collapse to the
      // same lookup failure — no mutation, no hint about which case it
      // was, and a duplicate callback (Twilio retry after the token was
      // already consumed) lands here too, which is exactly the safe,
      // idempotent no-op it should be.
      recordResponseAttempt(db, { channel: "CALL", fromNumber: normalizedFrom, success: false });
      return { message: GENERIC_CALL_REJECTION };
    }
    if (Date.now() > escalation.expiresAt) {
      updateEscalationStatus(db, escalation.id, "EXPIRED", { resolution: "Expired before a response was matched." });
      return { message: GENERIC_CALL_REJECTION };
    }

    recordResponseAttempt(db, { channel: "CALL", fromNumber: normalizedFrom, success: true });

    if (digit === "3") {
      updateEscalationStatus(db, escalation.id, escalation.status, { markCallTokenUsed: true });
      if (ownerPhone) void this.sendDetailsSmsForCall(db, escalation, ownerPhone);
      return { message: "Details sent by text. Goodbye." };
    }
    if (digit === "1") return this.decideEscalation(db, escalation, "APPROVED", "phone call");
    if (digit === "2") return this.decideEscalation(db, escalation, "REJECTED", "phone call");

    const updated = incrementResponseAttempts(db, escalation.id, MAX_RESPONSE_ATTEMPTS_PER_ESCALATION);
    if (updated.status === "CANCELLED") return { message: GENERIC_CALL_REJECTION };
    return { message: "Sorry, I didn't get that. Goodbye." };
  }

  private async sendDetailsSmsForCall(db: DatabaseSync, escalation: EscalationRow, to: string): Promise<void> {
    try {
      await this.provider.sendSms(to, this.detailsSmsBody(escalation));
    } catch {
      // Best-effort — the call itself already told the caller "goodbye";
      // a failed follow-up SMS doesn't change the escalation's status.
    }
  }
}
