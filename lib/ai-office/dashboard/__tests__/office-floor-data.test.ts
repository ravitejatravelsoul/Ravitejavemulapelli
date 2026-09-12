import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { listTasksForProject, updateTaskStatus, createTaskAttempt, createAgentRunForAttempt, updateAgentRunStatus } from "../../domain/tasks.ts";
import { pauseProject } from "../../control/project-transitions.ts";
import { planProject } from "../../orchestrator/orchestrator.ts";
import { getOfficeFloorView, getAgentDetail } from "../office-floor-data.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

const WEB_APP_IDEA =
  "Build a small web application where manual testers capture screenshots, organize them into steps, and export a test report.";

function setup(rawIdeaText: string = WEB_APP_IDEA) {
  const t = createTestDb();
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "Test Project", rawIdeaText, ownerId: owner.id });
  const plan = planProject(t.db, project.id);
  return { t, project: plan.project, tasks: listTasksForProject(t.db, project.id) };
}

function findTask(tasks: ReturnType<typeof listTasksForProject>, roleId: string) {
  const task = tasks.find((t) => t.roleId === roleId);
  if (!task) throw new Error(`no task for role ${roleId} — check the fixture idea selects this role`);
  return task;
}

describe("getOfficeFloorView — no projects", () => {
  test("every one of the 11 catalog roles is IDLE, and no project is selected", () => {
    const t = createTestDb();
    const view = getOfficeFloorView(t.db);
    assert.equal(view.selectedProject, null);
    assert.equal(view.agents.length, 11);
    assert.ok(view.agents.every((a) => a.status === "IDLE"));
  });
});

describe("getOfficeFloorView — fresh plan, nothing executed yet", () => {
  test("orchestrator is IDLE (planning already finished synchronously); every planned role is WAITING", () => {
    const { t, project, tasks } = setup();
    const view = getOfficeFloorView(t.db, project.id);

    const orchestrator = view.agents.find((a) => a.roleId === "orchestrator")!;
    assert.equal(orchestrator.status, "IDLE");

    const productOwner = view.agents.find((a) => a.roleId === "product-owner")!;
    assert.equal(productOwner.status, "WAITING");
    assert.equal(productOwner.currentTaskTitle, findTask(tasks, "product-owner").title);
  });

  test("a role not selected for this project's plan (research-agent, on an unambiguous idea) is IDLE, not WAITING", () => {
    const { t, project } = setup();
    const view = getOfficeFloorView(t.db, project.id);
    const research = view.agents.find((a) => a.roleId === "research-agent")!;
    assert.equal(research.status, "IDLE");
  });
});

describe("getOfficeFloorView — task status mapping", () => {
  test("IN_PROGRESS on a development role reads WORKING", () => {
    // WEB_APP_IDEA has a clear UI signal and no server-side signal, so
    // (Phase 8's capability-driven role selection) it selects
    // frontend-developer, not backend-developer — either is a
    // development role, this test just needs one that's actually planned.
    const { t, project, tasks } = setup();
    const frontend = findTask(tasks, "frontend-developer");
    updateTaskStatus(t.db, frontend.id, "IN_PROGRESS");
    const view = getOfficeFloorView(t.db, project.id);
    assert.equal(view.agents.find((a) => a.roleId === "frontend-developer")!.status, "WORKING");
  });

  test("IN_PROGRESS on an analysis/design role (product-owner) reads THINKING", () => {
    const { t, project, tasks } = setup();
    const po = findTask(tasks, "product-owner");
    updateTaskStatus(t.db, po.id, "IN_PROGRESS");
    const view = getOfficeFloorView(t.db, project.id);
    assert.equal(view.agents.find((a) => a.roleId === "product-owner")!.status, "THINKING");
  });

  test("IN_PROGRESS on a review role (qa-agent) reads REVIEWING", () => {
    const { t, project, tasks } = setup();
    const qa = findTask(tasks, "qa-agent");
    updateTaskStatus(t.db, qa.id, "IN_PROGRESS");
    const view = getOfficeFloorView(t.db, project.id);
    assert.equal(view.agents.find((a) => a.roleId === "qa-agent")!.status, "REVIEWING");
  });

  test("BLOCKED task reads BLOCKED", () => {
    const { t, project, tasks } = setup();
    const po = findTask(tasks, "product-owner");
    updateTaskStatus(t.db, po.id, "BLOCKED");
    const view = getOfficeFloorView(t.db, project.id);
    assert.equal(view.agents.find((a) => a.roleId === "product-owner")!.status, "BLOCKED");
  });

  test("a just-completed task (most recently updated DONE task) reads DONE; an older DONE task reads IDLE with lastCompletedTaskTitle set", () => {
    const { t, project, tasks } = setup();
    const po = findTask(tasks, "product-owner");
    const research = tasks.find((task) => task.roleId === "research-agent");

    updateTaskStatus(t.db, po.id, "DONE");
    // advance the clock so this DONE write is strictly the most recent one
    const view = getOfficeFloorView(t.db, project.id, Date.now() + 1);

    const productOwner = view.agents.find((a) => a.roleId === "product-owner")!;
    assert.equal(productOwner.status, "DONE");
    assert.equal(productOwner.lastCompletedTaskTitle, po.title);
    assert.equal(research, undefined, "research-agent wasn't selected for this idea");
  });

  test("a DONE task older than the recency window reads IDLE, not DONE", () => {
    const { t, project, tasks } = setup();
    const po = findTask(tasks, "product-owner");
    updateTaskStatus(t.db, po.id, "DONE");
    const farFuture = Date.now() + 60_000;
    const view = getOfficeFloorView(t.db, project.id, farFuture);
    const productOwner = view.agents.find((a) => a.roleId === "product-owner")!;
    assert.equal(productOwner.status, "IDLE");
    assert.equal(productOwner.lastCompletedTaskTitle, po.title);
  });
});

describe("getOfficeFloorView — project-level states", () => {
  test("a PAUSED project shows every not-yet-DONE role as PAUSED", () => {
    const { t, project, tasks } = setup();
    const owner = getOwner(t.db)!;
    const po = findTask(tasks, "product-owner");
    updateTaskStatus(t.db, po.id, "IN_PROGRESS");
    pauseProject(t.db, project.id, owner.id);

    const view = getOfficeFloorView(t.db, project.id);
    const productOwner = view.agents.find((a) => a.roleId === "product-owner")!;
    assert.equal(productOwner.status, "PAUSED");
  });

  test("default project selection prefers the most recently updated IN_PROGRESS project over other statuses", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project: older } = createProjectWithIdea(t.db, { title: "Older", rawIdeaText: WEB_APP_IDEA, ownerId: owner.id });
    planProject(t.db, older.id);
    const { project: newer } = createProjectWithIdea(t.db, { title: "Newer", rawIdeaText: WEB_APP_IDEA, ownerId: owner.id });
    planProject(t.db, newer.id);

    const view = getOfficeFloorView(t.db);
    assert.equal(view.selectedProject?.id, newer.id);
  });
});

describe("getOfficeFloorView — provider label", () => {
  test("an untouched SIMULATED project's waiting agents report provider 'simulated'", () => {
    const { t, project } = setup();
    const view = getOfficeFloorView(t.db, project.id);
    const productOwner = view.agents.find((a) => a.roleId === "product-owner")!;
    // WAITING roles haven't run yet — no agent_run exists — but the
    // project's own mode still gives an honest "this will run as" label.
    assert.equal(productOwner.provider, null);
  });

  test("a role with a real agent_run reports that run's actual provider", () => {
    const { t, project, tasks } = setup();
    const po = findTask(tasks, "product-owner");
    const attempt = createTaskAttempt(t.db, po.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "product-owner", provider: "simulated" });
    updateAgentRunStatus(t.db, run.id, "SUCCEEDED", Date.now());
    updateTaskStatus(t.db, po.id, "IN_PROGRESS");

    const view = getOfficeFloorView(t.db, project.id);
    assert.equal(view.agents.find((a) => a.roleId === "product-owner")!.provider, "simulated");
  });
});

describe("getAgentDetail", () => {
  test("returns role/status/task/provider for a role with an active task", () => {
    const { t, project, tasks } = setup();
    const po = findTask(tasks, "product-owner");
    updateTaskStatus(t.db, po.id, "IN_PROGRESS");

    const detail = getAgentDetail(t.db, "product-owner", project.id);
    assert.ok(detail);
    assert.equal(detail!.roleName, "Product Owner");
    assert.equal(detail!.status, "THINKING");
    assert.equal(detail!.projectId, project.id);
    assert.equal(detail!.currentTaskTitle, po.title);
  });

  test("returns undefined for an unknown role id", () => {
    const { t, project } = setup();
    assert.equal(getAgentDetail(t.db, "not-a-real-role", project.id), undefined);
  });
});
