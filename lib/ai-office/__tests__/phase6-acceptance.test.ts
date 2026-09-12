import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/test-helpers.ts";
import { getOwner } from "../domain/users.ts";
import { createProjectWithIdea, getProject } from "../domain/projects.ts";
import { planProject } from "../orchestrator/orchestrator.ts";
import { runOneCycle, type RunnerCycleOutcome } from "../runner/runner.ts";
import { openOffice, closeOffice } from "../control/office-control.ts";
import { pauseProject, resumeProject } from "../control/project-transitions.ts";
import { approveApproval, rejectApproval } from "../approvals/approval-service.ts";
import { getOfficeOverview, getProjectSummaries, getPendingApprovalsView } from "../dashboard/dashboard-data.ts";
import { getBudgetSnapshot } from "../budget/budget-service.ts";
import { getOfficeStatus } from "../domain/office.ts";
import { listPendingApprovals } from "../domain/project-outputs.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

/**
 * The Phase 6 brief's exact end-to-end acceptance scenario (§25-27),
 * driven the same way the private UI's Server Actions drive it — real
 * domain/service function calls, real SQLite, real Runner cycles — just
 * without an actual browser. `app/office/actions/**` are thin
 * authenticated wrappers around exactly these same functions (proven
 * separately via a live Playwright walkthrough during this phase's
 * development, since Server Actions depend on Next.js's request-scoped
 * `cookies()`/`redirect()` APIs that plain `node --test` cannot host);
 * this file is the permanent, fast, regression-safe proof that the
 * underlying behavior is correct.
 */

async function runUntilSettled(
  db: Parameters<typeof runOneCycle>[0],
  runnerId: string,
  isSettled: () => boolean,
  options: Parameters<typeof runOneCycle>[2] = {},
  maxCycles = 100,
): Promise<RunnerCycleOutcome[]> {
  const outcomes: RunnerCycleOutcome[] = [];
  for (let i = 0; i < maxCycles && !isSettled(); i++) {
    outcomes.push(await runOneCycle(db, runnerId, options));
  }
  return outcomes;
}

describe("Phase 6 acceptance — idea to READY_FOR_REVIEW through the real dashboard-facing services", () => {
  test("owner submits an idea; it plans, runs (including a QA failure/remediation loop), and reaches READY_FOR_REVIEW; the dashboard reflects every step; Office Close/Open and Pause/Resume behave exactly as specified", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;

    // "Owner logs in → opens AI Office → sees Office OPEN" — already true from seedAll().
    assert.equal(getOfficeStatus(t.db)?.state, "OPEN");

    // "clicks Start New Project → enters the idea" — the exact wording from the brief.
    const { project } = createProjectWithIdea(t.db, {
      title: "Screenshot Test Report Tool",
      rawIdeaText: "Build a small web tool where manual testers capture screenshots and generate a test report.",
      ownerId: owner.id,
    });
    assert.equal(project.status, "DRAFT");

    // "deterministic Orchestrator plans it" — same call the "Start New
    // Project" Server Action makes.
    const planned = planProject(t.db, project.id);
    assert.ok(planned.tasks.length > 0);
    assert.equal(getProject(t.db, project.id)?.status, "IN_PROGRESS");

    // "dashboard/project page shows task graph" — the aggregation layer
    // the pages actually render from.
    const overview = getOfficeOverview(t.db);
    assert.equal(overview.activeProjects, 1);
    let summaries = getProjectSummaries(t.db);
    assert.equal(summaries[0].totalTasks, planned.tasks.length);

    // "standalone Runner processes tasks" — steer QA to fail once, then
    // succeed, to exercise "simulated QA failure occurs → development
    // remediation occurs → QA reruns" without ever picking a task
    // manually.
    let qaFailedOnce = false;
    await runUntilSettled(
      t.db,
      "acceptance-runner",
      () => getProject(t.db, project.id)!.status === "READY_FOR_REVIEW",
      {
        execution: (task) => {
          if (task.roleId === "qa-agent" && task.attemptCount === 0) {
            qaFailedOnce = true;
            return { scenario: "failure" };
          }
          if (task.attemptCount > 0) return { scenario: "retry-success" };
          return { scenario: "success" };
        },
      },
    );

    assert.ok(qaFailedOnce, "the scenario must have actually exercised a QA failure");
    assert.equal(getProject(t.db, project.id)?.status, "READY_FOR_REVIEW", "→ Security/Code Review complete → Release completes → READY_FOR_REVIEW");

    // "dashboard reflects completion"
    summaries = getProjectSummaries(t.db);
    assert.equal(summaries[0].status, "READY_FOR_REVIEW");
    assert.equal(summaries[0].completedTasks, summaries[0].totalTasks);

    // "simulated cost remains $0"
    assert.equal(summaries[0].simulatedCostUsd, 0);
    assert.equal(summaries[0].liveCostUsd, 0);
    const budget = getBudgetSnapshot(t.db);
    assert.equal(budget.liveSpendUsd, 0);

    // ---- A second, independent project to prove Close/Open + Pause/Resume ----
    const { project: project2 } = createProjectWithIdea(t.db, {
      title: "Second Project",
      rawIdeaText: "Build a small backend utility to convert CSV files to JSON.",
      ownerId: owner.id,
    });
    planProject(t.db, project2.id);

    // "Close Office → create/preserve pending work → Runner does not process it"
    closeOffice(t.db, owner.id);
    const beforeClose = getProjectSummaries(t.db).find((p) => p.id === project2.id)!;
    const closedOutcome = await runOneCycle(t.db, "acceptance-runner");
    assert.equal(closedOutcome.kind, "office-closed");
    const afterClose = getProjectSummaries(t.db).find((p) => p.id === project2.id)!;
    assert.equal(afterClose.completedTasks, beforeClose.completedTasks, "no work may be processed while closed");

    // "Open Office → Runner resumes"
    openOffice(t.db, owner.id);
    const reopenedOutcome = await runOneCycle(t.db, "acceptance-runner");
    assert.equal(reopenedOutcome.kind, "executed");

    // "Pause Project → that project stops → Other project → continues"
    const pauseResult = pauseProject(t.db, project2.id, owner.id);
    assert.equal(pauseResult.ok, true);
    assert.equal(getProject(t.db, project2.id)?.status, "PAUSED");

    // A third project proves an unrelated project keeps progressing
    // while the second stays paused.
    const { project: project3 } = createProjectWithIdea(t.db, {
      title: "Third Project",
      rawIdeaText: "Build a small backend utility to reformat log files.",
      ownerId: owner.id,
    });
    planProject(t.db, project3.id);

    await runUntilSettled(
      t.db,
      "acceptance-runner",
      () => getProject(t.db, project3.id)!.status === "READY_FOR_REVIEW",
      { execution: { scenario: "success" } },
    );
    assert.equal(getProject(t.db, project3.id)?.status, "READY_FOR_REVIEW", "the unrelated project must complete while the second stays paused");
    assert.equal(getProject(t.db, project2.id)?.status, "PAUSED", "pausing one project must not affect another");

    // "Resume → project continues"
    const resumeResult = resumeProject(t.db, project2.id, owner.id);
    assert.equal(resumeResult.ok, true);
    await runUntilSettled(
      t.db,
      "acceptance-runner",
      () => getProject(t.db, project2.id)!.status === "READY_FOR_REVIEW",
      { execution: { scenario: "success" } },
    );
    assert.equal(getProject(t.db, project2.id)?.status, "READY_FOR_REVIEW");

    t.close();
  });
});

describe("Phase 6 acceptance — approval workflow (§26)", () => {
  test("a task-scoped approval blocks only its own action; owner approves it; only that exact request becomes eligible; an unrelated approval-required action remains blocked; audit trail records the decision", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;

    const { project } = createProjectWithIdea(t.db, {
      title: "Approval Demo",
      rawIdeaText: "Build a small web application and deploy to production once it's ready.",
      ownerId: owner.id,
    });
    const planned = planProject(t.db, project.id);
    assert.equal(planned.deploymentApprovalRequired, true);
    assert.equal(getProject(t.db, project.id)?.status, "IN_PROGRESS", "a task-scoped approval must not block the whole project");

    // "dashboard displays it"
    const pendingView = getPendingApprovalsView(t.db);
    assert.equal(pendingView.length, 1);
    assert.equal(pendingView[0].scopeLabel, "This task only");

    const releaseTask = planned.tasks.find((task) => task.roleId === "release-agent")!;

    function taskStatus(taskId: string): string {
      return (t.db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string }).status;
    }

    // "Runner cannot execute blocked action" — drive every OTHER task to
    // completion; the release task alone must never become eligible. No
    // forced scenario here: this idea selects frontend-developer, whose
    // real SimulatedAdapter fixture writes a deliberately-buggy first
    // attempt (Phase 8) for real QA to genuinely catch — forcing
    // "success" on every cycle would repeat the same bug forever instead
    // of letting the natural attempt-based retry-success fix apply.
    await runUntilSettled(
      t.db,
      "approval-acceptance-runner",
      () => planned.tasks.filter((task) => task.roleId !== "release-agent").every((task) => taskStatus(task.id) === "DONE"),
      {},
      50,
    );
    assert.equal(taskStatus(releaseTask.id), "PENDING", "the release task must still be blocked, everything else done");

    // "owner approves → only matching action becomes eligible"
    const approval = t.db.prepare("SELECT id FROM approvals WHERE taskId = ?").get(releaseTask.id) as { id: string };
    const approveResult = approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
    assert.equal(approveResult.ok, true);

    await runUntilSettled(t.db, "approval-acceptance-runner", () => getProject(t.db, project.id)!.status === "READY_FOR_REVIEW", {});
    assert.equal(getProject(t.db, project.id)?.status, "READY_FOR_REVIEW");

    // "audit trail records approval"
    const auditRow = t.db.prepare("SELECT * FROM audit_log WHERE action = 'approval.approved'").get();
    assert.ok(auditRow);

    // ---- Rejection, on an unrelated second project ----
    const { project: project2 } = createProjectWithIdea(t.db, {
      title: "Rejected Deploy",
      rawIdeaText: "Build a small web application and deploy to production once ready.",
      ownerId: owner.id,
    });
    const planned2 = planProject(t.db, project2.id);
    const releaseTask2 = planned2.tasks.find((task) => task.roleId === "release-agent")!;
    const approval2 = t.db.prepare("SELECT id FROM approvals WHERE taskId = ?").get(releaseTask2.id) as { id: string };

    const rejectResult = rejectApproval(t.db, { approvalId: approval2.id, decidedByUserId: owner.id, note: "not ready" });
    assert.equal(rejectResult.ok, true);

    // "action does not execute" / "project/task remains appropriately blocked"
    const releaseTask2Row = t.db.prepare("SELECT status FROM tasks WHERE id = ?").get(releaseTask2.id) as { status: string };
    assert.equal(releaseTask2Row.status, "BLOCKED");

    // Even after many runner cycles, the rejected task never executes.
    for (let i = 0; i < 20; i++) {
      const outcome = await runOneCycle(t.db, "approval-acceptance-runner", { execution: { scenario: "success" } });
      if (outcome.kind === "executed") assert.notEqual((outcome.detail as { taskId?: string })?.taskId, releaseTask2.id);
    }
    assert.equal(
      (t.db.prepare("SELECT status FROM tasks WHERE id = ?").get(releaseTask2.id) as { status: string }).status,
      "BLOCKED",
    );

    // "rejection recorded"
    const rejectAuditRow = t.db.prepare("SELECT * FROM audit_log WHERE action = 'approval.rejected'").get();
    assert.ok(rejectAuditRow);

    // No real destructive action occurred anywhere in this scenario —
    // simply a persisted approval decision and normal task status.
    assert.equal(listPendingApprovals(t.db).length, 0);

    t.close();
  });
});
