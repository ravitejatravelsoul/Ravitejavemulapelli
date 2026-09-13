import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { decideApproval, getApproval } from "../domain/project-outputs.ts";
import { getAgentRole } from "../domain/agent-roles.ts";
import { getOwner } from "../domain/users.ts";
import {
  createEscalation,
  getEscalation,
  findOpenEscalationForApproval,
  findOpenEscalationByResponseCode,
  updateEscalationStatus,
  countRecentExternalEscalations,
  expireOverdueEscalations,
  type EscalationRow,
} from "../domain/escalations.ts";
import { getEffectiveNotificationPolicy, resolveChannelForUrgency, isWithinQuietHours, isWithinCallWindow, type EscalationUrgency } from "../domain/notification-policy.ts";
import { getCommunicationProvider } from "./provider-factory.ts";
import type { CommunicationProvider } from "./communication-provider.ts";

const ESCALATION_TTL_MS = 30 * 60 * 1000; // 30 minutes to respond.
const MAX_EXTERNAL_ESCALATIONS_PER_HOUR = 6; // Section L anti-spam ceiling.

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
    try {
      const result = await this.provider.placeCall(to, this.voiceMessage(escalation, role?.name ?? null));
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
   * Section D/E's call→SMS fallback: only fires when the policy is
   * CALL_SMS_FALLBACK and the call did not result in a real response.
   */
  async handleCallStatusUpdate(db: DatabaseSync, providerCallId: string, status: "answered" | "no-answer" | "busy" | "failed"): Promise<void> {
    const row = db.prepare("SELECT * FROM escalations WHERE providerCallId = ?").get(providerCallId) as EscalationRow | undefined;
    if (!row || row.status === "APPROVED" || row.status === "REJECTED") return;
    if (status === "answered") return; // a real DTMF response arrives via handleInboundResponse instead.

    const ownerPhone = process.env.OWNER_PHONE_NUMBER;
    if (!ownerPhone) {
      updateEscalationStatus(db, row.id, "FAILED", { resolution: `Call ${status} and no SMS fallback number configured.` });
      return;
    }
    await this.sendSmsForEscalation(db, row, ownerPhone);
  }

  /**
   * Processes a verified inbound SMS/call-DTMF reply. Never a parallel
   * approval mechanism — APPROVE/REJECT call straight into the existing
   * `decideApproval` (Section F: "One source of truth").
   */
  handleInboundResponse(db: DatabaseSync, request: { headers: Headers; url: string; rawBody: string }): { message: string } {
    if (!this.provider.verifyInboundRequest(request)) {
      return { message: "" }; // Unverifiable requests get a silent, empty TwiML/response — never a hint about why.
    }

    expireOverdueEscalations(db);
    const { body } = this.provider.parseInboundResponse(request.rawBody);
    const match = /^(APPROVE|REJECT|DETAILS|STATUS)\s*(\d{4})?$/i.exec(body.trim());
    if (!match) return { message: "Sorry, I didn't understand that reply." };

    const [, actionRaw, code] = match;
    const action = actionRaw.toUpperCase();

    if (!code) {
      return { message: "Please include the code from the text, e.g. APPROVE 1234." };
    }

    const escalation = findOpenEscalationByResponseCode(db, code);
    if (!escalation) {
      return { message: "That code is invalid, expired, or already used." };
    }
    if (Date.now() > escalation.expiresAt) {
      updateEscalationStatus(db, escalation.id, "EXPIRED", { resolution: "Expired before a response was matched." });
      return { message: "That request has expired." };
    }

    if (action === "DETAILS") {
      return { message: `${escalation.reason}${escalation.estimatedCostUsd != null ? ` Est. cost: $${escalation.estimatedCostUsd.toFixed(2)}.` : ""}` };
    }

    if (action === "STATUS") {
      return { message: `Status: ${escalation.status}.` };
    }

    if (!escalation.approvalId) {
      return { message: "This request has no associated approval to act on." };
    }

    const decision = action === "APPROVE" ? "APPROVED" : "REJECTED";
    const approval = getApproval(db, escalation.approvalId);
    if (!approval || approval.status !== "PENDING") {
      updateEscalationStatus(db, escalation.id, "CANCELLED", { resolution: "Underlying approval was no longer pending." });
      return { message: "That request was already resolved." };
    }

    // `decidedBy` is a real FK to `users` — there is exactly one owner
    // account, so that's who a verified SMS/call reply is attributed to;
    // "how" it was decided goes in the free-text note instead.
    const owner = getOwner(db);
    decideApproval(db, escalation.approvalId, decision, { decidedBy: owner?.id, note: `Decided via ${this.provider.name} SMS/call reply.` });
    updateEscalationStatus(db, escalation.id, decision, {
      ownerResponse: body,
      resolution: `Owner ${decision.toLowerCase()} via ${this.provider.name}.`,
      resolved: true,
      markResponseCodeUsed: true,
    });

    return { message: decision === "APPROVED" ? "Approved. Thank you." : "Rejected. Thank you." };
  }
}
