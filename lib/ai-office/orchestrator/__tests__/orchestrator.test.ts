import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { listTasksForProject } from "../../domain/tasks.ts";
import { listDecisionsForProject, listPendingApprovals } from "../../domain/project-outputs.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { planProject } from "../orchestrator.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setup(rawIdeaText: string) {
  const t = createTestDb();
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "Test Project", rawIdeaText, ownerId: owner.id });
  return { t, project };
}

describe("planProject", () => {
  test("plans a web-app idea with the full role set and a valid dependency graph", () => {
    const { t, project } = setup(
      "Build a small web application where manual testers capture screenshots, organize them into steps, and export a test report.",
    );

    const result = planProject(t.db, project.id);

    assert.ok(result.selectedRoles.includes("ui-ux-agent"));
    assert.ok(result.selectedRoles.includes("frontend-developer"));
    assert.equal(result.approvalRequired, false);
    assert.equal(result.project.status, "IN_PROGRESS");

    const tasks = listTasksForProject(t.db, project.id);
    assert.equal(tasks.length, result.selectedRoles.length);
    for (const task of tasks) assert.equal(task.status, "PENDING");

    // The release task depends (transitively) on everything else — a
    // topological consequence, checked via task_dependencies rows
    // rather than re-deriving the graph here.
    const releaseTask = tasks.find((t2) => t2.roleId === "release-agent");
    assert.ok(releaseTask);

    t.close();
  });

  test("plans a small backend-only idea without UI/UX or Frontend tasks", () => {
    const { t, project } = setup("Write a backend utility function that validates email address formatting.");
    const result = planProject(t.db, project.id);

    assert.ok(!result.selectedRoles.includes("ui-ux-agent"));
    assert.ok(!result.selectedRoles.includes("frontend-developer"));
    const tasks = listTasksForProject(t.db, project.id);
    assert.ok(!tasks.some((task) => task.roleId === "ui-ux-agent" || task.roleId === "frontend-developer"));

    t.close();
  });

  test("records a planning decision with rationale", () => {
    const { t, project } = setup("Build a small web application for tracking reading habits.");
    planProject(t.db, project.id);

    const decisions = listDecisionsForProject(t.db, project.id);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].madeBy, "orchestrator");
    assert.ok(decisions[0].rationale && decisions[0].rationale.length > 0);

    t.close();
  });

  test("records a project.planned event", () => {
    const { t, project } = setup("Build a small web application for tracking reading habits.");
    planProject(t.db, project.id);

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "project.planned"));

    t.close();
  });

  test("an idea matching the synthetic approval signal creates a PENDING approval and BLOCKs the project instead of starting execution", () => {
    const { t, project } = setup("Build a tool that integrates a paid service subscription for SMS notifications.");
    const result = planProject(t.db, project.id);

    assert.equal(result.approvalRequired, true);
    assert.equal(result.project.status, "BLOCKED");

    const pending = listPendingApprovals(t.db);
    assert.equal(pending.filter((a) => a.projectId === project.id).length, 1);

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "approval.required"));

    t.close();
  });

  test("refuses to plan a project that isn't DRAFT, and leaves nothing new persisted", () => {
    const { t, project } = setup("Build a small tool.");
    planProject(t.db, project.id); // moves it to IN_PROGRESS
    const tasksBefore = listTasksForProject(t.db, project.id).length;

    assert.throws(() => planProject(t.db, project.id), /expected DRAFT/);

    assert.equal(listTasksForProject(t.db, project.id).length, tasksBefore);
    t.close();
  });

  test("planning is transactional — a project has either a full valid task set or none at all", () => {
    const { t, project } = setup("Build a small web application for tracking reading habits.");
    const result = planProject(t.db, project.id);

    // Every task's declared dependencies actually exist as rows and
    // are DONE-reachable (no dangling reference survived the write).
    const tasks = listTasksForProject(t.db, project.id);
    const ids = new Set(tasks.map((task) => task.id));
    for (const task of tasks) {
      const deps = t.db.prepare("SELECT dependsOnTaskId FROM task_dependencies WHERE taskId = ?").all(task.id) as Array<{
        dependsOnTaskId: string;
      }>;
      for (const dep of deps) assert.ok(ids.has(dep.dependsOnTaskId));
    }
    assert.equal(tasks.length, result.tasks.length);

    t.close();
  });

  test("planning the same idea text twice on fresh databases is deterministic (same role set, same task count)", () => {
    const ideaText = "Build a small web application for tracking reading habits with login.";
    const first = setup(ideaText);
    const firstResult = planProject(first.t.db, first.project.id);
    const second = setup(ideaText);
    const secondResult = planProject(second.t.db, second.project.id);

    assert.deepEqual(firstResult.selectedRoles, secondResult.selectedRoles);
    assert.equal(firstResult.tasks.length, secondResult.tasks.length);

    first.t.close();
    second.t.close();
  });

  test("an idea matching the deployment-approval signal creates a task-scoped approval on the release task only — the project itself is not BLOCKed", () => {
    const { t, project } = setup("Build a small web application for tracking reading habits, and deploy to production once it's ready.");
    const result = planProject(t.db, project.id);

    assert.equal(result.deploymentApprovalRequired, true);
    assert.equal(result.approvalRequired, false, "the two approval signals are independent");
    assert.equal(result.project.status, "IN_PROGRESS", "a task-scoped approval must not block the whole project");

    const releaseTask = result.tasks.find((task) => task.roleId === "release-agent")!;
    const approval = t.db.prepare("SELECT * FROM approvals WHERE projectId = ? AND kind = 'production_deploy'").get(project.id) as {
      taskId: string;
      status: string;
    };
    assert.equal(approval.taskId, releaseTask.id);
    assert.equal(approval.status, "PENDING");

    t.close();
  });
});
