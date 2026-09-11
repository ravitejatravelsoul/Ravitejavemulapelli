import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, updateProjectStatus, getProject } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt } from "../../domain/tasks.ts";
import { recordAiUsage, getOfficeBudgetRecord, startOfCurrentMonthUtc } from "../../domain/budget.ts";
import { authorizeBudget, getBudgetSnapshot, reconcileReservation, releaseReservation } from "../budget-service.ts";

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

/** Records a real (non-simulated) `ai_usage` row against a fresh task/attempt/run chain — the only way to satisfy `ai_usage.agentRunId`'s NOT NULL foreign key, matching exactly how AgentRunner itself would have recorded it. */
function seedLiveUsage(t: ReturnType<typeof createTestDb>, projectId: string, costUsd: number, provider = "synthetic-live-test") {
  const task = createTask(t.db, { projectId, roleId: "product-owner", title: "x" });
  const attempt = createTaskAttempt(t.db, task.id);
  const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "product-owner", provider });
  recordAiUsage(t.db, { agentRunId: run.id, projectId, provider, inputTokens: 10, outputTokens: 10, costUsd });
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
    // office cap $30, $100 already "spent" against it — must block on the office cap instead
    assert.equal(result.status, "BLOCKED_MONTHLY_CAP");
    t.close();
  });
});

describe("simulated vs. LIVE accounting", () => {
  test("simulated usage never counts against the LIVE budget and never blocks", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    seedLiveUsage(t, project.id, 29, "simulated"); // even at "simulated" provider, huge amount
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

describe("reservation / reconciliation", () => {
  test("an authorized request creates a RESERVED reservation that counts toward the committed total", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const first = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 20 });
    assert.equal(first.status, "AUTHORIZED");

    // A second request for $15 should now see $20 already reserved — $20+$15=$35 > $30 cap.
    const second = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 15 });
    assert.equal(second.status, "BLOCKED_MONTHLY_CAP", "the reservation from the first request must count against the second's check");

    t.close();
  });

  test("reconciling a reservation to its actual cost removes it from 'reserved' and the real cost is what remains committed", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 10 });
    assert.equal(result.status, "AUTHORIZED");

    const reconciled = reconcileReservation(t.db, result.reservationId!, 8);
    assert.equal(reconciled.status, "RECONCILED");
    assert.equal(reconciled.actualCostUsd, 8);

    // Reserved sum should no longer include this $10 hold.
    const next = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 20 });
    assert.equal(next.status, "AUTHORIZED", "the reconciled reservation must no longer count as 'reserved'");

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

    // If the $10 hold were still counted, a fresh $25 request (10+25=35>30) would block; freed, it fits (25<30).
    const next = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 25 });
    assert.notEqual(next.status, "BLOCKED_MONTHLY_CAP", "a released reservation must free its held amount");

    t.close();
  });

  test("reconciling or releasing an already-settled reservation is a safe no-op, not a double-count", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const result = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 5 });
    reconcileReservation(t.db, result.reservationId!, 5);

    const second = reconcileReservation(t.db, result.reservationId!, 999); // must not overwrite
    assert.equal(second.actualCostUsd, 5, "a second reconcile attempt against an already-RECONCILED row must not apply");

    const releaseAttempt = releaseReservation(t.db, result.reservationId!);
    assert.equal(releaseAttempt.status, "RECONCILED", "cannot release an already-reconciled reservation");

    t.close();
  });

  test("concurrency safety: two $23 authorizations against a $30 cap with $0 spent — at most one succeeds, never both", () => {
    const t = createTestDb();
    const { project } = setupProject(t);

    // A naive check-then-act implementation (read committed spend,
    // compute committed+estimate<=cap, authorize) run twice back to
    // back without an intervening reservation would have both calls
    // see the same $0-committed snapshot — 0+23=23<=30 — and wrongly
    // authorize both, committing $46 against a $30 cap. The atomic
    // reserve-immediately-on-authorize design must prevent that: the
    // second call has to see the first's $23 reservation already
    // committed (23+23=46>30) and block.
    const a = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 23 });
    const b = authorizeBudget(t.db, { projectId: project.id, provider: "synthetic-live-test", estimatedCostUsd: 23 });

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["AUTHORIZED", "BLOCKED_MONTHLY_CAP"], "exactly one of the two must authorize");

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
});
