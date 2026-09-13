import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, updateProjectStatus } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt } from "../../domain/tasks.ts";
import { createApproval } from "../../domain/project-outputs.ts";
import { recordAiUsage } from "../../domain/budget.ts";
import { planProject } from "../../orchestrator/orchestrator.ts";
import { runOneCycle } from "../../runner/runner.ts";
import { closeOffice, openOffice } from "../../control/office-control.ts";
import {
  getOfficeOverview,
  getProjectSummaries,
  getRecentActivity,
  getPendingApprovalsView,
  getRunnerActivityView,
  getBudgetView,
  describeEvent,
} from "../dashboard-data.ts";
import { getProjectDetail } from "../project-detail-data.ts";
import { upsertRunnerHeartbeat, setDeliveryState } from "../../domain/workspace.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

// See agents/__tests__/phase4-simulation.test.ts's identical block for
// why this matters: isolates any real file writes a frontend-developer
// task might trigger into a throwaway temp directory rather than this
// machine's real .data/ai-office-workspaces/.
let workspaceRoot: string;
beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-test-workspace-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
});
afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("dashboard-data — empty states", () => {
  test("a freshly-seeded office with zero projects/approvals/activity looks intentional, not broken", () => {
    const t = createTestDb();
    const overview = getOfficeOverview(t.db);
    assert.equal(overview.officeState, "OPEN");
    assert.equal(overview.activeProjects, 0);
    assert.equal(overview.pendingApprovals, 0);
    assert.equal(overview.currentMonthLiveCostUsd, 0);

    assert.deepEqual(getProjectSummaries(t.db), []);
    assert.deepEqual(getRecentActivity(t.db), []);
    assert.deepEqual(getPendingApprovalsView(t.db), []);

    const budget = getBudgetView(t.db);
    assert.equal(budget.capUsd, 30);
    assert.equal(budget.status, "SAFE");
    assert.match(budget.monthLabel, /\d{4}/);

    t.close();
  });
});

describe("dashboard-data — project summaries and activity reflect real state", () => {
  test("a READY_FOR_REVIEW project is displayed with full progress and $0 simulated cost", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Test Project", rawIdeaText: "Build a small backend utility.", ownerId: owner.id });
    planProject(t.db, project.id);

    for (let i = 0; i < 20; i++) {
      const outcome = await runOneCycle(t.db, "runner-1", { execution: { scenario: "success" } });
      if (outcome.kind === "idle" || outcome.kind === "office-closed") break;
    }

    const summaries = getProjectSummaries(t.db);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].status, "READY_FOR_REVIEW");
    assert.equal(summaries[0].completedTasks, summaries[0].totalTasks);
    assert.equal(summaries[0].simulatedCostUsd, 0);
    assert.equal(summaries[0].canPause, false, "a READY_FOR_REVIEW project cannot be paused");

    const activity = getRecentActivity(t.db);
    assert.ok(activity.length > 0);
    // Human-readable prose is allowed to quote a real task title (e.g.
    // `Frontend Developer started work on "Implement frontend".`) — the
    // real thing this guards against is a raw, undescribed JSON payload
    // leaking straight into the message, which always starts with `{`.
    assert.ok(activity.every((entry) => !entry.message.trim().startsWith("{")), "activity messages must be human-readable, not raw JSON");

    // Overview "Ready for Review" counts this legacy/pure-text project
    // (no workspace at all) — its status is honest as-is.
    const overview = getOfficeOverview(t.db);
    assert.equal(overview.readyForReviewProjects, 1);
    assert.equal(overview.readyForReviewUnverifiedProjects, 0);

    t.close();
  });

  test("unresolved failures and pending approvals are reflected in the project summary", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Needs approval",
      rawIdeaText: "Build a tool that integrates a paid service subscription for SMS notifications.",
      ownerId: owner.id,
    });
    planProject(t.db, project.id);

    const summaries = getProjectSummaries(t.db);
    assert.equal(summaries[0].pendingApprovals, 1);
    assert.equal(summaries[0].status, "BLOCKED");
    assert.equal(summaries[0].canPause, false, "a BLOCKED project cannot be paused by the central policy");

    const approvalsView = getPendingApprovalsView(t.db);
    assert.equal(approvalsView.length, 1);
    assert.equal(approvalsView[0].scopeLabel, "Entire project");
    assert.equal(approvalsView[0].projectTitle, "Needs approval");

    t.close();
  });

  test("a Claude routing approval exposes provider and roleId for the project detail page's prominent approval card", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Pomodoro timer", rawIdeaText: "Build a Pomodoro timer.", ownerId: owner.id });

    createApproval(t.db, {
      projectId: project.id,
      kind: "paid_service_purchase",
      requestedBy: "system",
      context: {
        provider: "claude",
        role: "frontend-developer",
        reason: "PAID AI APPROVAL REQUIRED — Provider: Claude · Role: Frontend Developer · Reason: no qualified local model is available for this capability.",
      },
    });

    const approvalsView = getPendingApprovalsView(t.db);
    assert.equal(approvalsView.length, 1);
    assert.equal(approvalsView[0].provider, "claude");
    assert.equal(approvalsView[0].roleId, "frontend-developer");
    assert.match(approvalsView[0].reason!, /PAID AI APPROVAL REQUIRED/);

    t.close();
  });

  test("an approval with no provider/role in its context (e.g. a budget increase) exposes provider/roleId as null, never a crash", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });

    createApproval(t.db, { projectId: project.id, kind: "budget_increase", requestedBy: "system", context: { reason: "Owner requested a higher cap." } });

    const approvalsView = getPendingApprovalsView(t.db);
    assert.equal(approvalsView.length, 1);
    assert.equal(approvalsView[0].provider, null);
    assert.equal(approvalsView[0].roleId, null);

    t.close();
  });

  test("Office Overview never folds an unverified real-workspace project into the honest 'Ready for Review' count (Phase 8 Part L)", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Real dev, not verified", rawIdeaText: "x", ownerId: owner.id });
    updateProjectStatus(t.db, project.id, "READY_FOR_REVIEW");
    setDeliveryState(t.db, project.id, "BUILDING"); // a real workspace exists, but nothing has been verified yet

    const overview = getOfficeOverview(t.db);
    assert.equal(overview.readyForReviewProjects, 0, "an unverified real-deliverable project must not count as honestly ready");
    assert.equal(overview.readyForReviewUnverifiedProjects, 1);

    t.close();
  });

  test("describeEvent never renders raw JSON and has a safe fallback for unknown event types", () => {
    const t = createTestDb();
    const fakeEvent = {
      id: "e1",
      projectId: null,
      type: "some.unmapped.event",
      payload: JSON.stringify({ x: 1 }),
      actor: "system",
      occurredAt: Date.now(),
      createdAt: Date.now(),
    };
    const message = describeEvent(t.db, fakeEvent);
    assert.ok(!message.includes("{"));
    assert.match(message, /some unmapped event/);
    t.close();
  });
});

describe("dashboard-data — runner visibility is a real heartbeat (Phase 8 Part P)", () => {
  test("no runner heartbeat has ever been recorded — OFFLINE, with clear non-alarming guidance", () => {
    const t = createTestDb();
    const view = getRunnerActivityView(t.db);
    assert.equal(view.runnerStatus, "OFFLINE");
    assert.match(view.message, /npm run ai-office:runner/);
    t.close();
  });

  test("a stale heartbeat (older than the freshness window) reports OFFLINE, never 'idle'", () => {
    const t = createTestDb();
    const staleTime = Date.now() - 60_000;
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-1", status: "IDLE", now: staleTime });
    const view = getRunnerActivityView(t.db, staleTime + 60_000);
    assert.equal(view.runnerStatus, "OFFLINE");
    assert.match(view.message, /offline/i);
    t.close();
  });

  test("a fresh heartbeat reporting WORKING is reflected as ONLINE_WORKING", () => {
    const t = createTestDb();
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-1", status: "WORKING" });
    const view = getRunnerActivityView(t.db);
    assert.equal(view.runnerStatus, "ONLINE_WORKING");
    assert.match(view.message, /executing a task/);
    t.close();
  });

  test("a fresh heartbeat reporting IDLE while Office is OPEN is reflected as ONLINE_IDLE", () => {
    const t = createTestDb();
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-1", status: "IDLE" });
    const view = getRunnerActivityView(t.db);
    assert.equal(view.officeState, "OPEN");
    assert.equal(view.runnerStatus, "ONLINE_IDLE");
    assert.match(view.message, /idle — waiting/);
    t.close();
  });

  test("a fresh heartbeat while Office is CLOSED is still ONLINE — the runner process is alive, it just won't claim new work", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-1", status: "IDLE" });
    closeOffice(t.db, owner.id);
    const view = getRunnerActivityView(t.db);
    assert.equal(view.officeState, "CLOSED");
    assert.equal(view.runnerStatus, "ONLINE_IDLE", "the process itself is still alive — only its ability to claim work is gated");
    assert.match(view.message, /closed/i);
    t.close();
  });

  test("reopening a closed office is reflected immediately", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    closeOffice(t.db, owner.id);
    openOffice(t.db, owner.id);
    const view = getRunnerActivityView(t.db);
    assert.equal(view.officeState, "OPEN");
    t.close();
  });

  test("real runner activity (via runOneCycle) still populates the legacy hasRecentActivity/lastActivityAt fields for any remaining consumer", async () => {
    const t = createTestDb();
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: getOwner(t.db)!.id });
    updateProjectStatus(t.db, project.id, "IN_PROGRESS");
    createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });
    await runOneCycle(t.db, "runner-1", { execution: { scenario: "success" } });

    const view = getRunnerActivityView(t.db);
    assert.equal(view.hasRecentActivity, true);
    assert.ok(view.lastActivityAt !== null);

    t.close();
  });
});

describe("project-detail-data", () => {
  test("aggregates tasks, attempts, agent runs, memory, and cost for one project", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Detail Test", rawIdeaText: "Build a small backend utility.", ownerId: owner.id });
    planProject(t.db, project.id);

    for (let i = 0; i < 20; i++) {
      const outcome = await runOneCycle(t.db, "runner-1", { execution: { scenario: "success" } });
      if (outcome.kind === "idle" || outcome.kind === "office-closed") break;
    }

    const detail = getProjectDetail(t.db, project.id);
    assert.ok(detail);
    assert.equal(detail!.project.status, "READY_FOR_REVIEW");
    assert.equal(detail!.progress.completed, detail!.progress.total);
    assert.ok(detail!.tasks.length > 0);
    for (const task of detail!.tasks) {
      assert.ok(task.attempts.length >= 1);
      assert.ok(task.attempts[0].agentRun);
    }
    assert.ok(detail!.memorySummary);
    assert.equal(detail!.simulatedCostUsd, 0);
    assert.ok(detail!.activity.length > 0);

    t.close();
  });

  test("returns undefined for a nonexistent project rather than throwing", () => {
    const t = createTestDb();
    assert.equal(getProjectDetail(t.db, "does-not-exist"), undefined);
    t.close();
  });

  test("simulated and LIVE cost are reported separately, never merged — a LIVE-provider usage row must never appear as 'simulated' cost", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id, aiMode: "LIVE" });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "product-owner", provider: "synthetic-live-test" });
    recordAiUsage(t.db, { agentRunId: run.id, projectId: project.id, provider: "synthetic-live-test", inputTokens: 1, outputTokens: 1, costUsd: 2.5 });

    const detail = getProjectDetail(t.db, project.id);
    assert.equal(detail!.liveCostUsd, 2.5);
    assert.equal(detail!.simulatedCostUsd, 0, "a LIVE-provider usage row must never be counted as simulated cost");

    t.close();
  });
});
