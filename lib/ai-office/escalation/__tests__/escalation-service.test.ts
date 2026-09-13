import { describe, test } from "node:test";
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

function freshServiceAndDb() {
  const t = createTestDb();
  const owner = getOwner(t.db)!;
  const mock = new MockCommunicationProvider();
  const service = new HumanEscalationService(mock);
  return { t, owner, mock, service };
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
    const policy = {
      id: "singleton",
      mode: "SMS" as const,
      quietHoursEnabled: 1 as const,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      timezone: "UTC",
      callWindowStart: "08:00",
      callWindowEnd: "21:00",
      createdAt: 0,
      updatedAt: 0,
    };
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
    setNotificationPolicy(t.db, { mode: "SMS", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" });
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });

    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test" });
    assert.equal(outcome.kind, "SKIPPED_NO_PHONE");
    assert.equal(mock.sentSms.length, 0);
    t.close();
  });

  test("a second request for the same still-open approval is deduped, never a repeat SMS", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, { mode: "SMS", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" });
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const input = { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED" as const, reason: "test", ownerPhoneNumber: "+15551234567" };

    const first = await service.requestEscalation(t.db, input);
    assert.equal(first.kind, "SENT");
    const second = await service.requestEscalation(t.db, input);
    assert.equal(second.kind, "SKIPPED_DUPLICATE");
    assert.equal(mock.sentSms.length, 1, "only one real SMS should have been sent");
    t.close();
  });
});

describe("requestEscalation — SMS flow end-to-end via the mock provider", () => {
  test("SMS mode sends a real SMS containing a one-time code, and APPROVE <code> decides the real underlying approval", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, { mode: "SMS", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" });
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
      ownerPhoneNumber: "+15551234567",
    });
    assert.equal(outcome.kind, "SENT");
    assert.equal(mock.sentSms.length, 1);
    assert.match(mock.sentSms[0].body, /APPROVE \d{4}/);
    assert.doesNotMatch(mock.sentSms[0].body, /sk-ant|AUTH|SECRET/i, "SMS body must never contain a secret");

    const code = /APPROVE (\d{4})/.exec(mock.sentSms[0].body)![1];
    const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=%2B15551234567&Body=APPROVE ${code}` });
    assert.match(result.message, /Approved/i);

    const decided = getApproval(t.db, approval.id);
    assert.equal(decided!.status, "APPROVED");
    assert.equal(decided!.decidedBy, owner.id);

    const escalation = getEscalation(t.db, outcome.escalation.id);
    assert.equal(escalation!.status, "APPROVED");
    assert.equal(escalation!.responseCodeUsed, 1);
    t.close();
  });

  test("REJECT <code> rejects the real approval through the same existing service — never a parallel decision path", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, { mode: "SMS", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" });
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: "+15551234567" });
    assert.equal(outcome.kind, "SENT");

    const code = outcome.escalation.responseCode!;
    service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=%2B1&Body=REJECT ${code}` });
    assert.equal(getApproval(t.db, approval.id)!.status, "REJECTED");
    t.close();
  });

  test("an already-used code cannot be replayed to flip a decision", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, { mode: "SMS", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" });
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: "+15551234567" });
    assert.equal(outcome.kind, "SENT");
    const code = outcome.escalation.responseCode!;

    service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=%2B1&Body=APPROVE ${code}` });
    assert.equal(getApproval(t.db, approval.id)!.status, "APPROVED");

    const replay = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=%2B1&Body=REJECT ${code}` });
    assert.match(replay.message, /invalid|expired|already used/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "APPROVED", "the replayed code must not flip an already-decided approval");
    t.close();
  });

  test("an expired escalation cannot be approved even with the correct code", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, { mode: "SMS", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" });
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "paid_service_purchase", urgency: "ACTION_REQUIRED", reason: "test", ownerPhoneNumber: "+15551234567" });
    assert.equal(outcome.kind, "SENT");
    // Force it into the past directly (the service always sets a real 30-minute TTL; this simulates time passing).
    t.db.prepare("UPDATE escalations SET expiresAt = ? WHERE id = ?").run(Date.now() - 1000, outcome.escalation.id);

    const code = outcome.escalation.responseCode!;
    const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=%2B1&Body=APPROVE ${code}` });
    assert.match(result.message, /expired/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });

  test("an unrecognized reply is handled honestly instead of silently approving anything", async () => {
    const { t, service } = freshServiceAndDb();
    const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: "From=%2B1&Body=hello there" });
    assert.match(result.message, /didn't understand/i);
    t.close();
  });

  test("DETAILS <code> returns safe context without deciding the approval", async () => {
    const { t, owner, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, { mode: "SMS", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" });
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, {
      projectId: project.id,
      approvalId: approval.id,
      type: "paid_service_purchase",
      urgency: "ACTION_REQUIRED",
      reason: "Needs $0.32 of Claude.",
      estimatedCostUsd: 0.32,
      ownerPhoneNumber: "+15551234567",
    });
    const code = (outcome as { escalation: { responseCode: string } }).escalation.responseCode;
    const result = service.handleInboundResponse(t.db, { headers: new Headers(), url: "http://localhost/x", rawBody: `From=%2B1&Body=DETAILS ${code}` });
    assert.match(result.message, /0\.32/);
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });
});

describe("call → SMS fallback", () => {
  test("an unanswered call falls back to SMS under CALL_SMS_FALLBACK policy", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, {
      mode: "CALL_SMS_FALLBACK",
      quietHoursEnabled: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      timezone: "UTC",
      callWindowStart: "00:00",
      callWindowEnd: "00:00", // zero-width window == always allowed, per isWithinWindow's documented misconfiguration-safe default.
    });
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });

    // The call→SMS fallback fires from an async webhook with no access to
    // the original request's parameters, so — exactly like real
    // production operation — it can only ever read the one owner phone
    // number from the environment.
    process.env.OWNER_PHONE_NUMBER = "+15551234567";
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

      const callId = mock.placedCalls[0].providerCallId;
      await service.handleCallStatusUpdate(t.db, callId, "no-answer");
      assert.equal(mock.sentSms.length, 1, "an unanswered call must fall back to SMS");

      const escalation = findOpenEscalationForApproval(t.db, approval.id);
      assert.ok(escalation, "the escalation should still be open, now waiting on the SMS reply");
    } finally {
      delete process.env.OWNER_PHONE_NUMBER;
    }
    t.close();
  });

  test("an answered call does not trigger an SMS fallback", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, { mode: "CALL_SMS_FALLBACK", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "00:00", callWindowEnd: "00:00" });
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });
    const outcome = await service.requestEscalation(t.db, { projectId: project.id, approvalId: approval.id, type: "production_deploy", urgency: "URGENT", reason: "test", ownerPhoneNumber: "+15551234567" });
    assert.equal(outcome.kind, "SENT");

    await service.handleCallStatusUpdate(t.db, mock.placedCalls[0].providerCallId, "answered");
    assert.equal(mock.sentSms.length, 0);
    t.close();
  });
});

describe("rate limiting", () => {
  test("external escalations beyond the hourly ceiling are refused, not silently queued forever", async () => {
    const { t, owner, mock, service } = freshServiceAndDb();
    setNotificationPolicy(t.db, { mode: "SMS", quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC", callWindowStart: "08:00", callWindowEnd: "21:00" });
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
        ownerPhoneNumber: "+15551234567",
      });
      if (outcome.kind === "SKIPPED_RATE_LIMITED") rateLimited++;
    }
    assert.ok(rateLimited > 0, "at least one of 8 rapid distinct escalations should be rate-limited");
    assert.ok(mock.sentSms.length <= 6, "no more than the configured ceiling of real SMS should ever be sent in the window");
    t.close();
  });
});
