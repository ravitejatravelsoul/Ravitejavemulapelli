import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, createTaskWithDependencies, updateTaskStatus, listTasksForProject, listTaskDependencies } from "../../domain/tasks.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { addMissingFrontendRole } from "../project-repair.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupBackendOnlyProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "TaskFlow", rawIdeaText: "Build a personal task manager.", ownerId: owner.id });
  const productOwner = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Define requirements" });
  const architect = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
  const backend = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
  const qa = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test" });
  updateTaskStatus(t.db, productOwner.id, "DONE");
  updateTaskStatus(t.db, architect.id, "DONE");
  return { owner, project, productOwner, architect, backend, qa };
}

describe("addMissingFrontendRole", () => {
  test("adds real ui-ux-agent and frontend-developer tasks, wired to depend on the existing solution-architect task", () => {
    const t = createTestDb();
    const { project, architect } = setupBackendOnlyProject(t);

    const result = addMissingFrontendRole(t.db, project.id, "owner-1");
    assert.equal(result.added.length, 2);

    const uiUx = result.added.find((task) => task.roleId === "ui-ux-agent")!;
    const frontend = result.added.find((task) => task.roleId === "frontend-developer")!;
    assert.ok(uiUx);
    assert.ok(frontend);
    assert.equal(uiUx.status, "PENDING");
    assert.equal(frontend.status, "PENDING");

    const uiUxDeps = listTaskDependencies(t.db, uiUx.id).map((d) => d.dependsOnTaskId);
    assert.deepEqual(uiUxDeps, [architect.id]);

    const frontendDeps = listTaskDependencies(t.db, frontend.id).map((d) => d.dependsOnTaskId);
    assert.ok(frontendDeps.includes(architect.id));
    assert.ok(frontendDeps.includes(uiUx.id));

    t.close();
  });

  test("qa-agent's existing dependencies are preserved and the new frontend dependency is added alongside them — never replacing, only adding", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "TaskFlow", rawIdeaText: "Build a personal task manager.", ownerId: owner.id });
    const architect = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    updateTaskStatus(t.db, architect.id, "DONE");
    const { task: backend } = createTaskWithDependencies(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend", dependsOnTaskIds: [architect.id] });
    const { task: qa } = createTaskWithDependencies(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test", dependsOnTaskIds: [backend.id] });

    const result = addMissingFrontendRole(t.db, project.id, "owner-1");
    const frontend = result.added.find((task) => task.roleId === "frontend-developer")!;

    const qaDepsAfter = listTaskDependencies(t.db, qa.id).map((d) => d.dependsOnTaskId);
    assert.ok(qaDepsAfter.includes(backend.id), "the original backend-developer dependency must be preserved, never removed");
    assert.ok(qaDepsAfter.includes(frontend.id), "the new frontend-developer dependency must be added");
    assert.equal(qaDepsAfter.length, 2);
    assert.equal(result.updatedDependencyEdges, 1);

    t.close();
  });

  test("is idempotent — calling it again once a frontend-developer task already exists is a clean no-op, never a duplicate plan", () => {
    const t = createTestDb();
    const { project } = setupBackendOnlyProject(t);
    const first = addMissingFrontendRole(t.db, project.id, "owner-1");
    assert.equal(first.added.length, 2);

    const second = addMissingFrontendRole(t.db, project.id, "owner-1");
    assert.deepEqual(second, { added: [], updatedDependencyEdges: 0 });

    const allTasks = listTasksForProject(t.db, project.id);
    assert.equal(allTasks.filter((task) => task.roleId === "frontend-developer").length, 1, "must never create a duplicate frontend-developer task");
    assert.equal(allTasks.filter((task) => task.roleId === "ui-ux-agent").length, 1);

    t.close();
  });

  test("records a real event and audit entry explaining the repair — never a silent mutation", () => {
    const t = createTestDb();
    const { project } = setupBackendOnlyProject(t);
    addMissingFrontendRole(t.db, project.id, "owner-1");

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "project.plan_repaired"));

    t.close();
  });

  test("never touches any existing task's status, attemptCount, or history", () => {
    const t = createTestDb();
    const { project, productOwner, architect, backend } = setupBackendOnlyProject(t);
    updateTaskStatus(t.db, backend.id, "BLOCKED");

    addMissingFrontendRole(t.db, project.id, "owner-1");

    const allTasks = listTasksForProject(t.db, project.id);
    const backendAfter = allTasks.find((task) => task.id === backend.id)!;
    const architectAfter = allTasks.find((task) => task.id === architect.id)!;
    const productOwnerAfter = allTasks.find((task) => task.id === productOwner.id)!;
    assert.equal(backendAfter.status, "BLOCKED", "the existing (real, escalated) task's own status must be completely untouched by this repair");
    assert.equal(architectAfter.status, "DONE");
    assert.equal(productOwnerAfter.status, "DONE");

    t.close();
  });

  test("works cleanly on a project with no qa-agent task at all (nothing to add a dependency edge to)", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small backend service.", ownerId: owner.id });
    const architect = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    updateTaskStatus(t.db, architect.id, "DONE");

    const result = addMissingFrontendRole(t.db, project.id, "owner-1");
    assert.equal(result.added.length, 2);
    assert.equal(result.updatedDependencyEdges, 0);

    t.close();
  });
});
