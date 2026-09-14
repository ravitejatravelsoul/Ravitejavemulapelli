import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject, updateProjectStatus } from "../../domain/projects.ts";
import { createTask, getTask } from "../../domain/tasks.ts";
import { createApproval, getApproval } from "../../domain/project-outputs.ts";
import { getOfficeBudgetRecord, startOfCurrentMonthUtc } from "../../domain/budget.ts";
import { listEventsForProject, listRecentEvents, listAuditEntries } from "../../domain/events.ts";
import { findEligibleTasks } from "../../runner/eligibility.ts";
import { approveApproval, rejectApproval, requestBudgetIncreaseApproval } from "../approval-service.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  return { owner, project };
}

describe("approveApproval / rejectApproval — basic decisions", () => {
  test("approving a PENDING project-wide approval unblocks the project and records event + audit entry", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "BLOCKED");
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "orchestrator", context: {} });

    const result = approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.approval.status, "APPROVED");
    assert.equal(getProject(t.db, project.id)?.status, "IN_PROGRESS", "the project must resume once its blocking approval clears");

    assert.ok(listEventsForProject(t.db, project.id).some((e) => e.type === "approval.approved"));
    assert.ok(listAuditEntries(t.db).some((e) => e.action === "approval.approved"));

    t.close();
  });

  test("rejecting a PENDING project-wide approval keeps the project BLOCKED and records the decision", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "BLOCKED");
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "orchestrator", context: {} });

    const result = rejectApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id, note: "not needed" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.approval.status, "REJECTED");
      assert.equal(result.approval.decisionNote, "not needed");
    }
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED", "rejection must keep the project blocked, not silently unblock it");

    t.close();
  });

  test("deciding an already-decided approval returns a clean failure, not a throw or a double side effect", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "BLOCKED");
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "orchestrator", context: {} });
    approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });

    const second = approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
    assert.equal(second.ok, false);

    const secondReject = rejectApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
    assert.equal(secondReject.ok, false);

    assert.equal(listEventsForProject(t.db, project.id).filter((e) => e.type === "approval.approved").length, 1, "must not double-record");

    t.close();
  });

  test("deciding a nonexistent approval returns a clean failure", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const result = approveApproval(t.db, { approvalId: "does-not-exist", decidedByUserId: owner.id });
    assert.equal(result.ok, false);
    t.close();
  });
});

describe("exact-scope enforcement — task-scoped vs. project-wide, no replay across unrelated actions", () => {
  test("a task-scoped approval blocks only that task, leaving a sibling task in the same project eligible", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "IN_PROGRESS");
    const gatedTask = createTask(t.db, { projectId: project.id, roleId: "release-agent", title: "Release" });
    const freeTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement" });

    createApproval(t.db, { projectId: project.id, taskId: gatedTask.id, kind: "production_deploy", requestedBy: "orchestrator", context: {} });

    const eligible = findEligibleTasks(t.db).map((task) => task.id);
    assert.ok(!eligible.includes(gatedTask.id), "the gated task must not be eligible");
    assert.ok(eligible.includes(freeTask.id), "an unrelated task in the same project must remain eligible");

    t.close();
  });

  test("approving one project's/task's approval does not unblock a second, unrelated pending approval in the same project", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "IN_PROGRESS");
    const releaseTask = createTask(t.db, { projectId: project.id, roleId: "release-agent", title: "Release" });

    const deployApproval = createApproval(t.db, {
      projectId: project.id,
      taskId: releaseTask.id,
      kind: "production_deploy",
      requestedBy: "orchestrator",
      context: {},
    });
    const budgetApproval = requestBudgetIncreaseApproval(t.db, {
      currentCapUsd: 30,
      requestedCapUsd: 40,
      reason: "test",
      requestedBy: "orchestrator",
    });

    // Approve only the deploy approval.
    approveApproval(t.db, { approvalId: deployApproval.id, decidedByUserId: owner.id });

    assert.equal(getApproval(t.db, deployApproval.id)?.status, "APPROVED");
    assert.equal(getApproval(t.db, budgetApproval.id)?.status, "PENDING", "an unrelated approval must remain untouched");

    const eligible = findEligibleTasks(t.db).map((task) => task.id);
    assert.ok(eligible.includes(releaseTask.id), "the release task becomes eligible once its own approval is decided");

    t.close();
  });

  test("rejecting a task-scoped approval BLOCKs only that task, not the whole project", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "IN_PROGRESS");
    const gatedTask = createTask(t.db, { projectId: project.id, roleId: "release-agent", title: "Release" });
    const freeTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement" });
    const approval = createApproval(t.db, { projectId: project.id, taskId: gatedTask.id, kind: "production_deploy", requestedBy: "orchestrator", context: {} });

    rejectApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });

    assert.equal(getTask(t.db, gatedTask.id)?.status, "BLOCKED");
    assert.equal(getProject(t.db, project.id)?.status, "IN_PROGRESS", "the project itself must not be blocked by a task-scoped rejection");
    const eligible = findEligibleTasks(t.db).map((task) => task.id);
    assert.ok(eligible.includes(freeTask.id));

    t.close();
  });
});

describe("budget-increase approval — cap changes only after approval", () => {
  test("requesting an increase does not change the persisted cap", () => {
    const t = createTestDb();
    requestBudgetIncreaseApproval(t.db, { currentCapUsd: 30, requestedCapUsd: 40, reason: "test", requestedBy: "system" });
    const record = getOfficeBudgetRecord(t.db, startOfCurrentMonthUtc());
    assert.equal(record?.capUsd, 30, "the cap must not change merely from requesting an increase");
    t.close();
  });

  test("approving the increase changes the persisted cap to exactly the requested value", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const approval = requestBudgetIncreaseApproval(t.db, { currentCapUsd: 30, requestedCapUsd: 40, reason: "test", requestedBy: "system" });

    const result = approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
    assert.equal(result.ok, true);

    const record = getOfficeBudgetRecord(t.db, startOfCurrentMonthUtc());
    assert.equal(record?.capUsd, 40);
    assert.ok(listRecentEvents(t.db).some((e) => e.type === "budget.cap_changed"));

    t.close();
  });

  test("rejecting the increase leaves the cap unchanged", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const approval = requestBudgetIncreaseApproval(t.db, { currentCapUsd: 30, requestedCapUsd: 40, reason: "test", requestedBy: "system" });

    rejectApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });

    const record = getOfficeBudgetRecord(t.db, startOfCurrentMonthUtc());
    assert.equal(record?.capUsd, 30);

    t.close();
  });

  test("requestBudgetIncreaseApproval refuses a non-increase (equal or lower cap)", () => {
    const t = createTestDb();
    assert.throws(() => requestBudgetIncreaseApproval(t.db, { currentCapUsd: 30, requestedCapUsd: 30, reason: "x", requestedBy: "system" }));
    assert.throws(() => requestBudgetIncreaseApproval(t.db, { currentCapUsd: 30, requestedCapUsd: 20, reason: "x", requestedBy: "system" }));
    t.close();
  });
});
