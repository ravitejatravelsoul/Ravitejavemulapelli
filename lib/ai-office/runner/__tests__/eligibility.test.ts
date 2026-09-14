import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, updateProjectStatus } from "../../domain/projects.ts";
import { createTask, createTaskWithDependencies, claimTask, updateTaskStatus } from "../../domain/tasks.ts";
import { createApproval } from "../../domain/project-outputs.ts";
import { findEligibleTasks, hasAnyPendingTask } from "../eligibility.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupInProgressProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  updateProjectStatus(t.db, project.id, "IN_PROGRESS");
  return project;
}

describe("findEligibleTasks", () => {
  test("a PENDING task with no dependencies in an IN_PROGRESS project is eligible", () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const eligible = findEligibleTasks(t.db);
    assert.ok(eligible.some((e) => e.id === task.id));
    t.close();
  });

  test("a task whose project is DRAFT (not yet planned/started) is not eligible", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const eligible = findEligibleTasks(t.db);
    assert.ok(!eligible.some((e) => e.id === task.id));
    t.close();
  });

  test("a task whose project is PAUSED is not eligible", () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    updateProjectStatus(t.db, project.id, "PAUSED");

    const eligible = findEligibleTasks(t.db);
    assert.ok(!eligible.some((e) => e.id === task.id));
    t.close();
  });

  test("a task with an incomplete dependency is not eligible", () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const upstream = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    const { task: downstream } = createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "solution-architect",
      title: "Architecture",
      dependsOnTaskIds: [upstream.id],
    });

    let eligible = findEligibleTasks(t.db);
    assert.ok(eligible.some((e) => e.id === upstream.id));
    assert.ok(!eligible.some((e) => e.id === downstream.id));

    updateTaskStatus(t.db, upstream.id, "DONE");
    eligible = findEligibleTasks(t.db);
    assert.ok(eligible.some((e) => e.id === downstream.id));
    t.close();
  });

  test("a task with an unexpired lease is not eligible", () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-a", leaseDurationMs: 60_000 });

    const eligible = findEligibleTasks(t.db);
    assert.ok(!eligible.some((e) => e.id === task.id));
    t.close();
  });

  test("a task with an expired lease becomes eligible again", () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-a", leaseDurationMs: -1000 });

    const eligible = findEligibleTasks(t.db, Date.now());
    assert.ok(eligible.some((e) => e.id === task.id));
    t.close();
  });

  test("a task in a project with a PENDING approval is not eligible", () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "orchestrator", context: {} });

    const eligible = findEligibleTasks(t.db);
    assert.ok(!eligible.some((e) => e.id === task.id));
    t.close();
  });

  test("a LIVE-mode project's PENDING task is still structurally eligible (refused later by the budget gate, not hidden here)", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id, aiMode: "LIVE" });
    updateProjectStatus(t.db, project.id, "IN_PROGRESS");
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const eligible = findEligibleTasks(t.db);
    assert.ok(eligible.some((e) => e.id === task.id));
    t.close();
  });

  test("a task already DONE is not returned", () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    updateTaskStatus(t.db, task.id, "DONE");

    const eligible = findEligibleTasks(t.db);
    assert.ok(!eligible.some((e) => e.id === task.id));
    t.close();
  });

  test("hasAnyPendingTask reflects whether any task anywhere is PENDING, independent of eligibility", () => {
    const t = createTestDb();
    assert.equal(hasAnyPendingTask(t.db), false);
    const project = setupInProgressProject(t);
    updateProjectStatus(t.db, project.id, "PAUSED"); // makes any task ineligible, but still PENDING
    createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    assert.equal(hasAnyPendingTask(t.db), true);
    assert.equal(findEligibleTasks(t.db).length, 0);
    t.close();
  });
});
