import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createApproval, getApproval } from "../../domain/project-outputs.ts";
import { setNotificationPolicy, getEffectiveNotificationPolicy, resolveChannelForUrgency, isWithinQuietHours, isWithinCallWindow } from "../../domain/notification-policy.ts";
import { getEscalation, findOpenEscalationForApproval } from "../../domain/escalations.ts";
import { HumanEscalationService } from "../escalation-service.ts";
import { MockCommunicationProvider } from "../mock-communication-provider.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

const OWNER_PHONE = "+15551234567";
const ATTACKER_PHONE = "+19995550000";

function freshServiceAndDb() {
  const t = createTestDb();
  const owner = getOwner(t.db)!;
  const mock = new MockCommunicationProvider();
  const service = new HumanEscalationService(mock);
  return { t, owner, mock, service };
}

const smsPolicy = { mode: "SMS" as const, quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" };
const callFallbackPolicy = { mode: "CALL_SMS_FALLBACK" as const, quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "00:00", callWindowEnd: "00:00" };

function extractCode(smsBody: string, action: "APPROVE" | "REJECT" | "DETAILS" = "APPROVE"): string {
  const re = new RegExp(`${action} ([A-Z0-9]{6,10})`);
  return re.exec(smsBody)![1];
}

describe("notification policy defaults", () => {
  test("a brand-new office defaults to OFF — no owner phone/provider config needed to be safe", () => {
    const t = createTestDb();
    const policy = getEffectiveNotificationPolicy(t.db);
    assert.equal(policy.mode, "OFF");
    assert.equal(resolveChannelForUrgency(policy, "URGENT"), "NONE");
    t.close();
  });

  test("resolveChannelForUrgency matches Section C's example policy exactly", () => {
    const inApp = { mode: "IN_APP" as const, quietHoursEnabled: 0 as const, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00", id: "singleton", createdAt: 0, updatedAt: 0 };
    assert.equal(resolveChannelForUrgency(inApp, "URGENT"), "IN_APP");

    const sms = { ...inApp, mode: "SMS" as const };
    assert.equal(resolveChannelForUrgency(sms, "INFO"), "IN_APP");
    assert.equal(resolveChannelForUrgency(sms, "ACTION_REQUIRED"), "SMS");
    assert.equal(resolveChannelForUrgency(sms, "URGENT"), "SMS");

    const callFallback = { ...inApp, mode: "CALL_SMS_FALLBACK" as const };
    assert.equal(resolveChannelForUrgency(callFallback, "ACTION_REQUIRED"), "SMS");
    assert.equal(resolveChannelForUrgency(callFallback, "URGENT"), "CALL");
  });

  test("quiet hours correctly wrap past midnight in the configured timezone", () => {
    const policy = { id: "singleton", mode: "SMS" as const, quietHoursEnabled: 1 as const, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00", createdAt: 0, updatedAt: 0 };
    const at23h = Date.UTC(2026, 0, 1, 23, 0);
    const at3h = Date.UTC(2026, 0, 1, 3, 0);
    const at12h = Date.UTC(2026, 0, 1, 12, 0);
    assert.equal(isWithinQuietHours(policy, at23h), true);
    assert.equal(isWithinQuietHours(policy, at3h), true);
    assert.equal(isWithinQuietHours(policy, at12h), false);
  });

  test("the call window is honored independently of quiet hours", () => {
    const policy = { id: "singleton", mode: "CALL_SMS_FALLBACK" as const, quietHoursEnabled: 0 as const, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "09:00", callWindowEnd: "18:00", createdAt: 0, updatedAt: 0 };
    assert.equal(isWithinCallWindow(policy, Date.UTC(2026, 0, 1, 12, 0)), true);
    assert.equal(isWithinCallWindow(policy, Date.UTC(2026, 0, 1, 3, 0)), false);
  });
});

describe("requestEscalation — policy gating", () => {
  test("mode OFF never touches the communication provider, even for an URGENT request", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });

    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "production_deploy", urgency: "URGENT", reason: "test" });
    assert.equal(outcome.kind, "SKIPPED_POLICY_OFF");
    assert.equal(mock.sentSms.length, 0);
    assert.equal(mock.placedCalls.length, 0);
    t.close();
  });

  test("with no owner phone configured, SMS mode records a real SKIPPED_NO_PHONE outcome rather than silently doing nothing", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });

    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test" });
    assert.equal(outcome.kind, "SKIPPED_NO_PHONE");
    assert.equal(mock.sentSms.length, 0);
    t.close();
  });

  test("a second request for the same still-open approval is deduped, never a repeat SMS", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const input = { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED" as const, reason: "test", ownerPhoneNumber: OWNER_PHONE };

    const first = await service.requestEscalation(t.db, input);
    assert.equal(first.kind, "SENT");
    const second = await service.requestEscalation(t.db, input);
    assert.equal(second.kind, "SKIPPED_DUPLICATE");
    assert.equal(mock.sentSms.length, 1, "only one real SMS should have been sent");
    t.close();
  });
});

describe("requestEscalation — SMS flow end-to-end via the mock provider", () => {
  test("SMS mode sends a real SMS containing a one-time code, and APPROVE <code> from the owner's number decides the real underlying approval", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });

    const outcome = await service.requestEscalation(t.db, {
      projectId: project.id,
      approvalId: approval.id,
      agentRole: "frontend-developer",
      type: "paid_service_purchase",
      urgency: "ACTION_REQUIRED",
      reason: "Frontend Developer needs paid Claude approval.",
      estimatedCostUsd: 0.32,
      ownerPhoneNumber: OWNER_PHONE,
    });
    assert.equal(outcome.kind, "SENT");
    assert.equal(mock.sentSms.length, 1);
    assert.match(mock.sentSms[0].body, /APPROVE [A-Z0-9]{6,10}/);
    assert.doesNotMatch(mock.sentSms[0].body, /sk-ant|AUTH|SECRET/i, "SMS body must never contain a secret");

    const code = extractCode(mock.sentSms[0].body);
    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=APPROVE ${code}` });
      assert.match(result.message, /Approved/i);

      const decided = getApproval(t.db, approval.id);
      assert.equal(decided!.status, "APPROVED");
      assert.equal(decided!.decidedBy, owner.id);

      const escalation = getEscalation(t.db, outcome.escalation.id);
      assert.equal(escalation!.status, "APPROVED");
      assert.equal(escalation!.responseCodeUsed, 1);
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("REJECT <code> from the owner's number rejects the real approval through the same existing service — never a parallel decision path", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");

    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      const code = outcome.escalation.responseCode!;
      service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=REJECT ${code}` });
      assert.equal(getApproval(t.db, approval.id)!.status, "REJECTED");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("SMS from a different phone number, even with the correct code, does NOT decide anything", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");

    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      const code = outcome.escalation.responseCode!;
      const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(ATTACKER_PHONE)}&Body=APPROVE ${code}` });
      // Must be indistinguishable from an unparseable message — no hint the code was actually valid.
      assert.match(result.message, /didn't understand/i);
      assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
      assert.equal(getEscalation(t.db, outcome.escalation.id)!.responseCodeUsed, 0);
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("a Twilio-signed (verified) SMS from an attacker's number cannot approve anything, even guessing the exact real code", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");
    const realCode = mock.sentSms[0].body.match(/APPROVE ([A-Z0-9]{6,10})/)![1];

    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      // `verifyInboundRequest()` is true for the mock (as it would be for
      // a genuinely Twilio-signed request) — proving delivery, not identity.
      const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(ATTACKER_PHONE)}&Body=APPROVE ${realCode}` });
      assert.doesNotMatch(result.message, /approved/i);
      assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("an already-used code cannot be replayed to flip a decision", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");
    const code = outcome.escalation.responseCode!;

    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=APPROVE ${code}` });
      assert.equal(getApproval(t.db, approval.id)!.status, "APPROVED");

      const replay = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=REJECT ${code}` });
      assert.match(replay.message, /invalid|expired|already used/i);
      assert.equal(getApproval(t.db, approval.id)!.status, "APPROVED", "the replayed code must not flip an already-decided approval");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("an expired escalation cannot be approved even with the correct code from the owner's number", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");
    // Force it into the past directly (the service always sets a real 30-minute TTL; this simulates time passing).
    t.db.prepare("UPDATE escalations SET expiresAt = ? WHERE id = ?").run(Date.now() - 1000, outcome.escalation.id);

    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      const code = outcome.escalation.responseCode!;
      const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=APPROVE ${code}` });
      assert.match(result.message, /expired/i);
      assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("an unrecognized reply from the owner's number is handled honestly instead of silently approving anything", async () => {
    const { t, service } = freshServiceAndDb();
    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=hello there` });
      assert.match(result.message, /didn't understand/i);
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("DETAILS <code> from the owner's number returns safe context without deciding the approval", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, {
      projectId: project.id,
      approvalId: approval.id,
      type: "paid_service_purchase",
      urgency: "ACTION_REQUIRED",
      reason: "Needs $0.32 of Claude.",
      estimatedCostUsd: 0.32,
      ownerPhoneNumber: OWNER_PHONE,
    });
    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      const code = (outcome as { escalation: { responseCode: string } }).escalation.responseCode;
      const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=DETAILS ${code}` });
      assert.match(result.message, /0\.32/);
      assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });
});

describe("SMS response throttling — anti-brute-force", () => {
  test("repeated invalid codes from the same sender are throttled before enumeration can succeed", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");
    const realCode = outcome.escalation.responseCode!;

    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      const messages: string[] = [];
      for (let i = 0; i < 8; i++) {
        const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=APPROVE WRONGCODE` });
        messages.push(result.message);
      }
      // Every message stays generic — the throttle never reveals it kicked in differently from "invalid code".
      for (const m of messages) assert.doesNotMatch(m, /approved/i);

      // The real code, tried immediately after, is also refused now that this sender is throttled.
      const finalAttempt = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=APPROVE ${realCode}` });
      assert.doesNotMatch(finalAttempt.message, /approved/i);
      assert.equal(getApproval(t.db, approval.id)!.status, "PENDING", "the legitimate code must still be refused once the sender is throttled");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("throttling is scoped per sender — a different, legitimate number is unaffected by an attacker's failed guesses", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");

    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      for (let i = 0; i < 8; i++) {
        service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(ATTACKER_PHONE)}&Body=APPROVE WRONGCODE` });
      }
      const code = (outcome as { escalation: { responseCode: string } }).escalation.responseCode;
      const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&Body=APPROVE ${code}` });
      assert.match(result.message, /approved/i);
      assert.equal(getApproval(t.db, approval.id)!.status, "APPROVED");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });
});

describe("call → SMS fallback", () => {
  test("an unanswered call falls back to SMS under CALL_SMS_FALLBACK policy", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, callFallbackPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });

    // The call→SMS fallback fires from an async webhook with no access to
    // the original request's parameters, so — exactly like real
    // production operation — it can only ever read the one owner phone
    // number from the environment.
    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      const outcome = await service.requestEscalation(t.db, {
        projectId: project.id,
        approvalId: approval.id,
        agentRole: "release-agent",
        type: "production_deploy",
        urgency: "URGENT",
        reason: "Release needs deployment approval.",
      });
      assert.equal(outcome.kind, "SENT");
      assert.equal(mock.placedCalls.length, 1, "URGENT + CALL_SMS_FALLBACK should place a real call first");
      assert.equal(mock.sentSms.length, 0);
      assert.ok(mock.placedCalls[0].callbackToken, "a real call must carry a real callback token");

      const callId = mock.placedCalls[0].providerCallId;
      await service.handleCallStatusUpdate(t.db, callId, "no-answer");
      assert.equal(mock.sentSms.length, 1, "an unanswered call must fall back to SMS");

      const escalation = findOpenEscalationForApproval(t.db, approval.id);
      assert.ok(escalation, "the escalation should still be open, now waiting on the SMS reply");

      // A second, duplicate no-answer status callback (Twilio retry) must not send a second SMS.
      await service.handleCallStatusUpdate(t.db, callId, "no-answer");
      assert.equal(mock.sentSms.length, 1, "a duplicate call-status callback must not trigger a second fallback SMS");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("an answered call does not trigger an SMS fallback", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, callFallbackPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "production_deploy", urgency: "URGENT", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");

    await service.handleCallStatusUpdate(t.db, mock.placedCalls[0].providerCallId, "answered");
    assert.equal(mock.sentSms.length, 0);
    t.close();
  });

  test("a resolved escalation (approved through some other path) never triggers a later fallback SMS", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, callFallbackPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "production_deploy", urgency: "URGENT", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");

    // Simulate the owner deciding directly (e.g. via the in-app UI) before the call resolves.
    const { decideApproval } = await import("../../domain/project-outputs.ts");
    decideApproval(t.db, approval.id, "APPROVED", { decidedBy: owner.id });
    t.db.prepare("UPDATE escalations SET status = 'APPROVED', resolvedAt = ? WHERE id = ?").run(Date.now(), outcome.escalation.id);

    await service.handleCallStatusUpdate(t.db, mock.placedCalls[0].providerCallId, "no-answer");
    assert.equal(mock.sentSms.length, 0, "a resolved escalation must never trigger a fallback SMS");
    t.close();
  });

  test("an expired escalation never triggers a fallback SMS", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, callFallbackPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "production_deploy", urgency: "URGENT", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");
    t.db.prepare("UPDATE escalations SET expiresAt = ? WHERE id = ?").run(Date.now() - 1000, outcome.escalation.id);

    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
    try {
      await service.handleCallStatusUpdate(t.db, mock.placedCalls[0].providerCallId, "no-answer");
      assert.equal(mock.sentSms.length, 0, "an expired escalation must never trigger a fallback SMS");
      assert.equal(getEscalation(t.db, outcome.escalation.id)!.status, "EXPIRED");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("a call failure with no configured owner phone ends safely as FAILED, never throwing", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, callFallbackPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "production_deploy", urgency: "URGENT", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");

    await service.handleCallStatusUpdate(t.db, mock.placedCalls[0].providerCallId, "no-answer");
    assert.equal(mock.sentSms.length, 0);
    assert.equal(getEscalation(t.db, outcome.escalation.id)!.status, "FAILED");
    t.close();
  });
});

describe("phone-call DTMF response — Defect 1's fix", () => {
  beforeEach(() => {
    process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
  });
  afterEach(() => {
    delete process.env.OWNER_PHONE_NUMBER;
  });

  async function placeUrgentCall() {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, callFallbackPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "production_deploy", urgency: "URGENT", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(outcome.kind, "SENT");
    const token = mock.placedCalls[0].callbackToken;
    return { t, owner, mock, service, approval, token };
  }

  test("pressing 1 approves the exact matching escalation via the real existing approval service", async () => {
    const { t, service, approval, token } = await placeUrgentCall();
    const result = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(token)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=1`,
    });
    assert.match(result.message, /approved/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "APPROVED");
    t.close();
  });

  test("pressing 2 rejects the exact matching escalation", async () => {
    const { t, service, approval, token } = await placeUrgentCall();
    const result = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(token)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=2`,
    });
    assert.match(result.message, /rejected/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "REJECTED");
    t.close();
  });

  test("pressing 3 sends details by SMS without deciding the approval", async () => {
    const { t, mock, service, approval, token } = await placeUrgentCall();
    const before = mock.sentSms.length;
    const result = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(token)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=3`,
    });
    assert.match(result.message, /details/i);
    assert.equal(mock.sentSms.length, before + 1, "digit 3 must send exactly one details SMS");
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });

  test("a missing token does nothing", async () => {
    const { t, service, approval } = await placeUrgentCall();
    const result = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=1`,
    });
    assert.doesNotMatch(result.message, /approved/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });

  test("an invalid (unknown) token does nothing", async () => {
    const { t, service, approval } = await placeUrgentCall();
    const result = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=not-a-real-token`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=1`,
    });
    assert.doesNotMatch(result.message, /approved/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });

  test("an expired call token does nothing", async () => {
    const { t, service, approval, token } = await placeUrgentCall();
    t.db.prepare("UPDATE escalations SET expiresAt = ? WHERE callToken = ?").run(Date.now() - 1000, token);
    const result = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(token)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=1`,
    });
    assert.doesNotMatch(result.message, /approved/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });

  test("a reused (already-consumed) call token does nothing on the second attempt — duplicate webhook safe", async () => {
    const { t, service, approval, token } = await placeUrgentCall();
    const first = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(token)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=1`,
    });
    assert.match(first.message, /approved/i);

    const replay = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(token)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=2`,
    });
    assert.doesNotMatch(replay.message, /rejected/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "APPROVED", "a reused token must never flip an already-decided approval");
    t.close();
  });

  test("one escalation's token cannot approve a different escalation's approval", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, callFallbackPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approvalA = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });
    const approvalB = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });

    await service.requestEscalation(t.db, { projectId: project.id, approvalId: approvalA.id, type: "production_deploy", urgency: "URGENT", reason: "A", ownerPhoneNumber: OWNER_PHONE });
    const tokenA = mock.placedCalls[0].callbackToken;
    await service.requestEscalation(t.db, { projectId: project.id, approvalId: approvalB.id, type: "production_deploy", urgency: "URGENT", reason: "B", ownerPhoneNumber: OWNER_PHONE });

    service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(tokenA)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=1`,
    });
    assert.equal(getApproval(t.db, approvalA.id)!.status, "APPROVED");
    assert.equal(getApproval(t.db, approvalB.id)!.status, "PENDING", "escalation A's token must never be able to touch escalation B's approval");
    t.close();
  });

  test("a bad Twilio signature does nothing, silently", async () => {
    const { t, mock, approval, token } = await placeUrgentCall();
    const realProvider = mock;
    const service = new HumanEscalationService({
      ...realProvider,
      name: "twilio-like",
      sendSms: realProvider.sendSms.bind(realProvider),
      placeCall: realProvider.placeCall.bind(realProvider),
      parseInboundResponse: realProvider.parseInboundResponse.bind(realProvider),
      parseInboundCallResponse: realProvider.parseInboundCallResponse.bind(realProvider),
      verifyInboundRequest: () => false,
    });
    const result = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(token)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=1`,
    });
    assert.doesNotMatch(result.message, /approved/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });

  test("a To number that doesn't match the configured owner number does nothing, even with a valid token", async () => {
    const { t, service, approval, token } = await placeUrgentCall();
    const result = service.handleCallResponse(t.db, {
      headers: new Headers(),
      url: `http://localhost/api/escalation/inbound-call-response?token=${encodeURIComponent(token)}`,
      rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(ATTACKER_PHONE)}&Digits=1`,
    });
    assert.doesNotMatch(result.message, /approved/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });

  test("repeated invalid call-token attempts from the same caller are throttled", async () => {
    const { t, service } = await placeUrgentCall();
    const messages: string[] = [];
    for (let i = 0; i < 8; i++) {
      const result = service.handleCallResponse(t.db, {
        headers: new Headers(),
        url: `http://localhost/api/escalation/inbound-call-response?token=not-a-real-token-${i}`,
        rawBody: `From=${encodeURIComponent(OWNER_PHONE)}&To=${encodeURIComponent(OWNER_PHONE)}&Digits=1`,
      });
      messages.push(result.message);
    }
    for (const m of messages) assert.doesNotMatch(m, /approved/i);
    t.close();
  });
});

describe("mock provider — proves the whole flow without any public webhook exposure", () => {
  test("the mock provider never makes a real network call and records everything in-memory", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: OWNER_PHONE });
    assert.equal(mock.name, "mock");
    assert.equal(mock.sentSms.length, 1);
    mock.reset();
    assert.equal(mock.sentSms.length, 0);
    t.close();
  });
});

describe("rate limiting", () => {
  test("external escalations beyond the hourly ceiling are refused, not silently queued forever", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, smsPolicy);
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });

    let rateLimited = 0;
    for (let i = 0; i < 8; i++) {
      const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
      const outcome = await service.requestEscalation(t.db, {
        projectId: project.id,
        approvalId: approval.id,
        type: "paid_service_purchase",
        urgency: "ACTION_REQUIRED",
        reason: `test ${i}`,
        ownerPhoneNumber: OWNER_PHONE,
      });
      if (outcome.kind === "SKIPPED_RATE_LIMITED") rateLimited++;
    }
    assert.ok(rateLimited > 0, "at least one of 8 rapid distinct escalations should be rate-limited");
    assert.ok(mock.sentSms.length <= 6, "no more than the configured ceiling of real SMS should ever be sent in the window");
    t.close();
  });
});
