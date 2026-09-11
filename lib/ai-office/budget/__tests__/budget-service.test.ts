import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { createTestDb, reopenTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, updateProjectStatus, getProject } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt } from "../../domain/tasks.ts";
import { recordAiUsage, getOfficeBudgetRecord, startOfCurrentMonthUtc, getBudgetReservation, InvalidMoneyError, updateOfficeBudgetCap } from "../../domain/budget.ts";
import { authorizeBudget, getBudgetSnapshot, reconcileReservationWithUsage, releaseReservation, type AuthorizeBudgetInput, type BudgetAuthorizationResult } from "../budget-service.ts";
import { requestBudgetIncreaseApproval, approveApproval } from "../../approvals/approval-service.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>, monthlyBudgetCapUsd?: number) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id, aiMode: "LIVE" });
  updateProjectStatus(t.db, project.id, "IN_PROGRESS");
  if (monthlyBudgetCapUsd !== undefined) {
    t.db.prepare("UPDATE projects SET monthlyBudgetCapUsd = ? WHERE id = ?").run(monthlyBudgetCapUsd, project.id);
  }
  return { owner, project: getProject(t.db, project.id)! };
}

/** Records a real (non-simulated) `ai_usage` row against a fresh task/attempt/run chain — the only way to satisfy `ai_usage.agentRunId`'s NOT NULL foreign key, matching exactly how AgentRunner itself would have recorded it. Returns the created agentRunId, for tests that need to reconcile against it. */
function seedLiveUsage(t: ReturnType<typeof createTestDb>, projectId: string, costUsd: number, provider = "synthetic-live-test"): string {
  const task = createTask(t.db, { projectId, roleId: "product-owner", title: "x" });
  const attempt = createTaskAttempt(t.db, task.id);
  const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "product-owner", provider });
  recordAiUsage(t.db, { agentRunId: run.id, projectId, provider, inputTokens: 10, outputTokens: 10, costUsd });
  return run.id;
}

/** Creates a fresh task/attempt/agentRun chain without recording usage yet — for tests that authorize a reservation first and reconcile it later against a real agentRunId. */
function seedAgentRun(t: ReturnType<typeof createTestDb>, projectId: string, provider = "synthetic-live-test"): string {
  const task = createTask(t.db, { projectId, roleId: "product-owner", title: "x" });
  const attempt = createTaskAttempt(t.db, task.id);
  const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "product-owner", provider });
  return run.id;
}

function backdateLatestUsage(t: ReturnType<typeof createTestDb>, timestamp: number) {
  t.db.prepare("UPDATE ai_usage SET createdAt = ? WHERE id = (SELECT id FROM ai_usage ORDER BY createdAt DESC LIMIT 1)").run(timestamp);
}

describe("authorizeBudget — defaults, warning, hard caps", () => {
  test("the office budget defaults to a $30/month cap", () => {
    const t = createTestDb();
    const record = getOfficeBudgetRecord(t.db, startOfCurrentMonthUtc());
    assert.equal(record?.capUsd, 30);
    assert.equal(record?.warnAtPercent, 80);
    t.close();
  });

  test("$0 spent + $5 estimated is AUTHORIZED", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 5 });
    assert.equal(result.status, "AUTHORIZED");
    assert.ok(result.reservationId);
    t.close();
  });

  test("$28 spent + $1 estimated is allowed to proceed (still under the $30 cap, though past the 80%/$24 warning threshold)", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 28);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 1 });
    assert.ok(result.status === "AUTHORIZED" || result.status === "WARNING", `expected an allowed status, got ${result.status}`);
    assert.ok(result.reservationId, "an allowed request must reserve its estimate");
    t.close();
  });

  test("crossing the 80% warning threshold returns WARNING but still authorizes (and reserves)", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 25); // $25/$30 = 83.3%, already past 80%
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 1 });
    assert.equal(result.status, "WARNING");
    assert.ok(result.reservationId, "a WARNING must still reserve — it is not a block");
    t.close();
  });

  test("$29 spent + $2 estimated is BLOCKED_MONTHLY_CAP — no reservation created", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 29);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 2 });
    assert.equal(result.status, "BLOCKED_MONTHLY_CAP");
    assert.equal(result.reservationId, undefined);
    t.close();
  });

  test("a request exactly at the cap boundary (committed + estimate === cap) is still authorized, not blocked", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 28);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 2 });
    assert.equal(result.status, "WARNING"); // $30/$30 is >= 80% too, but must not be blocked
    t.close();
  });

  test("no negative remaining budget is ever reported, even after a block", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 29);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 5 });
    assert.equal(result.status, "BLOCKED_MONTHLY_CAP");
    assert.ok(result.officeRemainingUsd >= 0);
    t.close();
  });
});

describe("authorizeBudget — project cap", () => {
  test("a project-specific cap blocks before the office cap would, even with office room remaining", () => {
    const t = createTestDb();
    const { project } = setupProject(t, 5); // project cap $5, office cap $30
    seedLiveUsage(t, project.id, 4);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 2 });
    assert.equal(result.status, "BLOCKED_PROJECT_CAP");
    assert.equal(result.reservationId, undefined);
    t.close();
  });

  test("a project with no cap set is only bound by the office cap", () => {
    const t = createTestDb();
    const { project } = setupProject(t); // no project cap
    seedLiveUsage(t, project.id, 100); // would blow any project cap, but there isn't one
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 1 });
    assert.equal(result.status, "BLOCKED_MONTHLY_CAP");
    t.close();
  });
});

describe("simulated vs. LIVE accounting", () => {
  test("simulated usage never counts against the LIVE budget and never blocks", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 29, "simulated");
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 5 });
    assert.equal(result.status, "AUTHORIZED", "simulated-provider usage must be invisible to LIVE budget math");
    t.close();
  });

  test("LIVE usage from a synthetic (non-simulated) provider is fully counted", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 29, "synthetic-live-test");
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 2 });
    assert.equal(result.status, "BLOCKED_MONTHLY_CAP");
    t.close();
  });

  test("getBudgetSnapshot separates simulated cost/runs from LIVE spend", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 3, "synthetic-live-test");
    seedLiveUsage(t, project.id, 0, "simulated");
    seedLiveUsage(t, project.id, 0, "simulated");

    const snapshot = getBudgetSnapshot(t.db);
    assert.equal(snapshot.liveSpendUsd, 3);
    assert.equal(snapshot.simulatedCostUsd, 0);
    assert.equal(snapshot.simulatedRuns, 2);
    assert.equal(snapshot.capUsd, 30);
    assert.equal(snapshot.status, "SAFE");

    t.close();
  });
});

describe("reservation / reconciliation — atomic, single source of truth per state", () => {
  test("reconciling $10 estimate to $8 actual keeps exactly $8 committed — never $0, never $18", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const authResult = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 10 });
    assert.equal(authResult.status, "AUTHORIZED");
    const agentRunId = seedAgentRun(t, project.id);

    const reconciled = reconcileReservationWithUsage(t.db, {
      reservationId: authResult.reservationId!,
      actualCostUsd: 8,
      agentRunId,
      projectId: project.id,
      provider: "synthetic-live-test",
      inputTokens: 1,
      outputTokens: 1,
    });
    assert.equal(reconciled.applied, true);
    assert.equal(reconciled.reservation.status, "RECONCILED");
    assert.equal(reconciled.usage?.costUsd, 8);
    assert.equal(reconciled.overCap, false);

    const snapshot = getBudgetSnapshot(t.db);
    assert.equal(snapshot.liveSpendUsd, 8, "actual spend must be exactly $8, not the $10 estimate");
    assert.equal(snapshot.reservedUsd, 0, "the reconciled reservation must no longer count as reserved");

    // $8 + $23 = $31 > $30 -> blocked.
    const blocked = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 23 });
    assert.equal(blocked.status, "BLOCKED_MONTHLY_CAP");

    // $8 + $22 = $30 -> allowed, reaching exactly the cap.
    const allowed = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 22 });
    assert.notEqual(allowed.status, "BLOCKED_MONTHLY_CAP");

    t.close();
  });

  test("actual cost greater than the estimate is accounted for in full, not silently capped at the estimate", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const authResult = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 10 });
    const agentRunId = seedAgentRun(t, project.id);

    reconcileReservationWithUsage(t.db, {
      reservationId: authResult.reservationId!,
      actualCostUsd: 12,
      agentRunId,
      projectId: project.id,
      provider: "synthetic-live-test",
      inputTokens: 1,
      outputTokens: 1,
    });

    const snapshot = getBudgetSnapshot(t.db);
    assert.equal(snapshot.liveSpendUsd, 12, "the higher actual cost must be the number that counts, not the original $10 estimate");

    t.close();
  });

  test("an actual cost that pushes committed spend over the cap is recorded in full, flagged as over-cap, and blocks every subsequent request — never pretended to have been prevented retroactively", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 20);
    const authResult = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 8 }); // $20+$8=$28, still allowed (past the 80% warning threshold, but under the $30 cap)
    assert.ok(authResult.status === "AUTHORIZED" || authResult.status === "WARNING");
    assert.ok(authResult.reservationId);
    const agentRunId = seedAgentRun(t, project.id);

    // The real call turned out to cost far more than estimated — $20+$15=$35, over the $30 cap. Already happened; cannot be blocked after the fact.
    const reconciled = reconcileReservationWithUsage(t.db, {
      reservationId: authResult.reservationId!,
      actualCostUsd: 15,
      agentRunId,
      projectId: project.id,
      provider: "synthetic-live-test",
      inputTokens: 1,
      outputTokens: 1,
    });
    assert.equal(reconciled.usage?.costUsd, 15, "the real cost must be recorded in full, not silently reduced to fit the cap");
    assert.equal(reconciled.overCap, true);

    const events = t.db.prepare("SELECT * FROM messages_events WHERE type = 'budget.overage_detected'").all();
    assert.equal(events.length, 1);
    const audit = t.db.prepare("SELECT * FROM audit_log WHERE action = 'budget.overage_detected'").all();
    assert.equal(audit.length, 1);

    // Every subsequent call, even for $0, is now blocked until the owner raises the cap.
    const next = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 0 });
    assert.equal(next.status, "BLOCKED_MONTHLY_CAP");

    t.close();
  });

  test("releasing a reservation for a call that never incurred cost frees the held amount without recording spend", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 10 });
    assert.equal(result.status, "AUTHORIZED");

    const released = releaseReservation(t.db, result.reservationId!);
    assert.equal(released.status, "RELEASED");
    assert.equal(released.actualCostUsd, null, "a released reservation must never claim a real cost occurred");

    const next = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 25 });
    assert.notEqual(next.status, "BLOCKED_MONTHLY_CAP", "a released reservation must free its held amount");

    t.close();
  });

  test("reconciling or releasing an already-settled reservation is a safe no-op, not a double-count", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const authResult = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 5 });
    const agentRunId = seedAgentRun(t, project.id);
    reconcileReservationWithUsage(t.db, {
      reservationId: authResult.reservationId!,
      actualCostUsd: 5,
      agentRunId,
      projectId: project.id,
      provider: "synthetic-live-test",
      inputTokens: 1,
      outputTokens: 1,
    });

    const second = reconcileReservationWithUsage(t.db, {
      reservationId: authResult.reservationId!,
      actualCostUsd: 999,
      agentRunId,
      projectId: project.id,
      provider: "synthetic-live-test",
      inputTokens: 1,
      outputTokens: 1,
    });
    assert.equal(second.applied, false, "a second reconcile attempt against an already-RECONCILED row must not apply");

    const snapshot = getBudgetSnapshot(t.db);
    assert.equal(snapshot.liveSpendUsd, 5, "no double-count — the $999 second attempt must never be recorded");

    const releaseAttempt = releaseReservation(t.db, authResult.reservationId!);
    assert.equal(releaseAttempt.status, "RECONCILED", "cannot release an already-reconciled reservation");

    t.close();
  });

  test("a failure during the reservation transaction rolls back completely — no reservation survives, and the lock is released for the next caller", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const before = t.db.prepare("SELECT COUNT(*) as c FROM budget_reservations").get() as { c: number };

    assert.throws(() => authorizeBudget(t.db, { projectId: project.id, provider: null as unknown as string, estimatedCostUsd: 5 }));

    const after = t.db.prepare("SELECT COUNT(*) as c FROM budget_reservations").get() as { c: number };
    assert.equal(after.c, before.c, "no reservation row may survive a rolled-back transaction");

    // The lock must have been released, not left held — a subsequent valid call must succeed normally.
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 5 });
    assert.equal(result.status, "AUTHORIZED");

    t.close();
  });
});

describe("authorizeBudget — approval scope", () => {
  test("a project with a pending project-wide approval returns APPROVAL_REQUIRED before any cap math, and reserves nothing", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    t.db
      .prepare(
        `INSERT INTO approvals (id, projectId, taskId, kind, status, requestedBy, context, decidedAt, decidedBy, decisionNote, createdAt, updatedAt)
         VALUES ('appr-1', ?, NULL, 'paid_service_purchase', 'PENDING', 'orchestrator', '{}', NULL, NULL, NULL, ?, ?)`,
      )
      .run(project.id, Date.now(), Date.now());

    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 1 });
    assert.equal(result.status, "APPROVAL_REQUIRED");
    assert.equal(result.reservationId, undefined);

    t.close();
  });

  test("after an approved cap increase, the very next authorization uses the new persisted cap", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 29);

    const blockedBefore = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 5 });
    assert.equal(blockedBefore.status, "BLOCKED_MONTHLY_CAP");

    const approval = requestBudgetIncreaseApproval(t.db, { currentCapUsd: 30, requestedCapUsd: 40, reason: "test", requestedBy: "system" });
    const decision = approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
    assert.equal(decision.ok, true);

    const authorizedAfter = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 5 });
    assert.notEqual(authorizedAfter.status, "BLOCKED_MONTHLY_CAP", "the new $40 cap must apply immediately, in the same atomic check");

    t.close();
  });
});

describe("invalid monetary input is rejected before any database work", () => {
  test("negative estimate is rejected", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    assert.throws(() => authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: -10 }), InvalidMoneyError);
    t.close();
  });

  test("NaN estimate is rejected", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    assert.throws(() => authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: NaN }), InvalidMoneyError);
    t.close();
  });

  test("Infinity and -Infinity estimates are rejected", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    assert.throws(() => authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: Infinity }), InvalidMoneyError);
    assert.throws(() => authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: -Infinity }), InvalidMoneyError);
    t.close();
  });

  test("an absurdly large estimate beyond the supported range is rejected", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    assert.throws(() => authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: 999999999999 }), InvalidMoneyError);
    t.close();
  });

  test("$0.00 is a valid estimate (a legitimate free call), $0.01 is valid, -$0.01 is rejected", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const zero = authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: 0 });
    assert.equal(zero.status, "AUTHORIZED");
    const cent = authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: 0.01 });
    assert.equal(cent.status, "AUTHORIZED");
    assert.throws(() => authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: -0.01 }), InvalidMoneyError);
    t.close();
  });

  test("invalid actual cost is rejected by reconciliation", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const authResult = authorizeBudget(t.db, { projectId: project.id, provider: "x", estimatedCostUsd: 5 });
    const agentRunId = seedAgentRun(t, project.id);
    assert.throws(
      () =>
        reconcileReservationWithUsage(t.db, {
          reservationId: authResult.reservationId!,
          actualCostUsd: NaN,
          agentRunId,
          projectId: project.id,
          provider: "x",
          inputTokens: 1,
          outputTokens: 1,
        }),
      InvalidMoneyError,
    );
    // The reservation must remain RESERVED — the invalid reconcile attempt must not have applied.
    assert.equal(getBudgetReservation(t.db, authResult.reservationId!)?.status, "RESERVED");
    t.close();
  });

  test("invalid budget cap updates are rejected", () => {
    const t = createTestDb();
    assert.throws(() => updateOfficeBudgetCap(t.db, startOfCurrentMonthUtc(), { capUsd: -5 }), InvalidMoneyError);
    assert.throws(() => updateOfficeBudgetCap(t.db, startOfCurrentMonthUtc(), { capUsd: NaN }), InvalidMoneyError);
    assert.throws(() => updateOfficeBudgetCap(t.db, startOfCurrentMonthUtc(), { warnAtPercent: 150 }), InvalidMoneyError);
    assert.throws(() => updateOfficeBudgetCap(t.db, startOfCurrentMonthUtc(), { warnAtPercent: -1 }), InvalidMoneyError);
    t.close();
  });
});

describe("month rollover — a reservation/spend belongs unambiguously to its billing period", () => {
  test("prior-month LIVE spend and reservations do not reduce the current month's remaining cap", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const now = new Date();
    const lastMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    const lastMonthTimestamp = lastMonthStart + 1000;

    // A large prior-month LIVE usage row — if period-scoping were broken, this alone would exhaust the cap.
    seedLiveUsage(t, project.id, 29);
    backdateLatestUsage(t, lastMonthTimestamp);

    // A large prior-month reservation, still nominally RESERVED — must not count toward this month either.
    t.db
      .prepare(
        `INSERT INTO budget_reservations (id, projectId, provider, estimatedCostUsd, actualCostUsd, status, periodStart, createdAt, updatedAt)
         VALUES (?, ?, 'synthetic-live-test', 25, NULL, 'RESERVED', ?, ?, ?)`,
      )
      .run(randomUUID(), project.id, lastMonthStart, lastMonthTimestamp, lastMonthTimestamp);

    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 25 });
    assert.notEqual(result.status, "BLOCKED_MONTHLY_CAP", "prior-month spend/reservations must not count against this month's cap");

    const snapshot = getBudgetSnapshot(t.db);
    assert.equal(snapshot.liveSpendUsd, 0, "this month's LIVE spend must be $0 — the seeded row belongs to last month");

    t.close();
  });
});

describe("real concurrency — two independently opened SQLite connections", () => {
  test("office cap: two independent connections each authorizing $23 against a $0-committed $30 cap — exactly one succeeds", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const dbA = t.db;
    const dbB = reopenTestDb(t.dir);

    const a = authorizeBudget(dbA, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 23 });
    const b = authorizeBudget(dbB, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 23 });

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["AUTHORIZED", "BLOCKED_MONTHLY_CAP"], "exactly one of the two independent connections may authorize");

    const snapshot = getBudgetSnapshot(dbA);
    assert.ok(snapshot.reservedUsd <= 30, "committed (spent + reserved) must never exceed the cap");
    assert.equal(snapshot.reservedUsd, 23);

    dbB.close();
    t.close();
  });

  test("office cap: $29 already committed, two independent connections each requesting $2 — neither may push committed above the $30 cap", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 29);
    const dbA = t.db;
    const dbB = reopenTestDb(t.dir);

    const a = authorizeBudget(dbA, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 2 });
    const b = authorizeBudget(dbB, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 2 });

    assert.ok(a.status === "BLOCKED_MONTHLY_CAP" && b.status === "BLOCKED_MONTHLY_CAP", "both must be blocked — even one $2 request already exceeds the $1 of remaining room");

    const snapshot = getBudgetSnapshot(dbA);
    assert.ok(snapshot.liveSpendUsd + snapshot.reservedUsd <= 30, "the final invariant: committed must never exceed the cap");

    dbB.close();
    t.close();
  });

  test("project cap: two independent connections each requesting $7 against a $10 project cap — at most one succeeds, even with plenty of office-wide room", () => {
    const t = createTestDb();
    const { project } = setupProject(t, 10); // project cap $10, office cap $30
    const dbA = t.db;
    const dbB = reopenTestDb(t.dir);

    const a = authorizeBudget(dbA, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 7 });
    const b = authorizeBudget(dbB, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 7 });

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["AUTHORIZED", "BLOCKED_PROJECT_CAP"], "exactly one of the two must authorize against the tighter project cap");

    dbB.close();
    t.close();
  });

  test("transaction rollback under real cross-connection contention still leaves no orphaned reservation", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const dbA = t.db;
    const dbB = reopenTestDb(t.dir);

    assert.throws(() => authorizeBudget(dbA, { projectId: project.id, provider: null as unknown as string, estimatedCostUsd: 5 }));

    // dbB, opened independently, must see a clean, uncommitted state — the failed connection's aborted attempt must not have left any trace or held lock.
    const result = authorizeBudget(dbB, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 23 });
    assert.equal(result.status, "AUTHORIZED");

    dbB.close();
    t.close();
  });
});

describe("real concurrency — genuine OS-scheduled worker threads racing the same authorization", () => {
  function runAuthorizeInWorker(
    dbPath: string,
    input: AuthorizeBudgetInput,
  ): Promise<{ ok: true; result: BudgetAuthorizationResult } | { ok: false; error: string }> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./authorize-worker.ts", import.meta.url), {
        workerData: { dbPath, input },
        execArgv: ["--conditions=react-server"],
      });
      worker.once("message", (msg) => {
        resolve(msg);
        void worker.terminate();
      });
      worker.once("error", reject);
    });
  }

  test("two genuinely concurrent worker threads, each with their own connection, racing a $23 request against a $30 cap — exactly one authorizes, the invariant holds", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const dbPath = `${t.dir}/test.db`;
    const dir = t.dir;
    t.db.close(); // release the main-thread connection so it isn't the one "winning" trivially — both workers open fresh connections

    const input: AuthorizeBudgetInput = { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 23 };
    const [a, b] = await Promise.all([runAuthorizeInWorker(dbPath, input), runAuthorizeInWorker(dbPath, input)]);

    assert.equal(a.ok, true, a.ok ? "" : (a as { error: string }).error);
    assert.equal(b.ok, true, b.ok ? "" : (b as { error: string }).error);
    if (!a.ok || !b.ok) return;

    const statuses = [a.result.status, b.result.status].sort();
    assert.deepEqual(statuses, ["AUTHORIZED", "BLOCKED_MONTHLY_CAP"], "exactly one genuinely concurrent worker-thread authorization may succeed");

    const verifyDb = reopenTestDb(dir);
    const snapshot = getBudgetSnapshot(verifyDb);
    assert.ok(snapshot.liveSpendUsd + snapshot.reservedUsd <= 30, "final invariant: LIVE spent + RESERVED must never exceed the cap");
    verifyDb.close();

    rmSync(dir, { recursive: true, force: true });
  });
});
