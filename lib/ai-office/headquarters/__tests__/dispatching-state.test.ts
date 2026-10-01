import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { planProject } from "../../orchestrator/orchestrator.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt, updateAgentRunStatus, updateTaskStatus } from "../../domain/tasks.ts";
import { getAIHeadquartersWorldState } from "../world-state.ts";
import { agentBriefing } from "../presentation.ts";
import { proximityBriefing } from "../experience.ts";

process.env.OFFICE_OWNER_EMAIL = "acceptance@example.test";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic";

/**
 * "Project accepted — dispatching the remote workforce" — a real, grounded
 * presentation of the genuine cold-start window between a real remote
 * project's creation and GitHub Actions picking up its first task. Every
 * scenario here uses the exact real project-creation/planning path
 * (createProjectWithIdea + planProject), never a hand-built fixture.
 */
function freshRemoteProject(t: ReturnType<typeof createTestDb>, title = "task tracker") {
  const { project } = createProjectWithIdea(t.db, { title, rawIdeaText: "Build a small Personal Task Tracker web app with add, complete and delete.", ownerId: getOwner(t.db)!.id, routingMode: "FREE_MULTI_MODEL" });
  planProject(t.db, project.id);
  return project;
}

test("dispatching is true only for a freshly created REMOTE project with zero completed tasks and no active agent", () => {
  const t = createTestDb();
  try {
    const project = freshRemoteProject(t);
    const remote = getAIHeadquartersWorldState(t.db, project.id, "remote");
    assert.equal(remote.project!.status, "IN_PROGRESS");
    assert.equal(remote.project!.completed, 0);
    assert.equal(remote.project!.dispatching, true, "a freshly planned remote project with no progress yet is genuinely dispatching");

    // The SAME real state, viewed in local mode, must never claim this —
    // local execution starts near-instantly and has no such cold start.
    const local = getAIHeadquartersWorldState(t.db, project.id, "local");
    assert.equal(local.project!.dispatching, false);
  } finally { t.close(); }
});

test("dispatching clears the instant real progress exists — first completed task", () => {
  const t = createTestDb();
  try {
    const project = freshRemoteProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Define requirements" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "product-owner", provider: "groq", model: "m" });
    updateAgentRunStatus(t.db, run.id, "SUCCEEDED", Date.now());
    updateTaskStatus(t.db, task.id, "DONE");

    const state = getAIHeadquartersWorldState(t.db, project.id, "remote");
    assert.equal(state.project!.completed, 1);
    assert.equal(state.project!.dispatching, false, "real progress must clear the dispatching presentation immediately");
  } finally { t.close(); }
});

test("dispatching clears the instant a real agent run is actually in flight, even with zero completed tasks", () => {
  const t = createTestDb();
  try {
    const project = freshRemoteProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Define requirements" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "product-owner", provider: "groq", model: "m" });
    updateAgentRunStatus(t.db, run.id, "RUNNING");
    updateTaskStatus(t.db, task.id, "IN_PROGRESS");

    const state = getAIHeadquartersWorldState(t.db, project.id, "remote");
    assert.equal(state.project!.completed, 0);
    const active = state.agents.find((a) => a.roleId === "product-owner")!;
    assert.notEqual(active.status, undefined);
    assert.equal(state.project!.dispatching, false, "a genuinely active real agent run means dispatching is over, whatever its status label");
  } finally { t.close(); }
});

test("no fake agent activity: dispatching never marks any real role active, only a synthetic, clearly-labeled Orchestrator coordination state", () => {
  const t = createTestDb();
  try {
    const project = freshRemoteProject(t);
    const state = getAIHeadquartersWorldState(t.db, project.id, "remote");
    assert.equal(state.project!.dispatching, true);
    for (const a of state.agents) {
      if (a.roleId === "orchestrator") continue;
      assert.notEqual(a.status, "WORKING", `${a.roleId} must not be presented as active before any real run exists`);
      assert.equal(a.completedWork, null, `${a.roleId} has no completed work yet — nothing fabricated`);
      assert.equal(a.provider, null, `${a.roleId} has no recorded provider yet — nothing fabricated`);
    }
    const orchestrator = state.agents.find((a) => a.roleId === "orchestrator")!;
    assert.equal(orchestrator.status, "WORKING");
    assert.equal(orchestrator.task, "Dispatching the remote workforce");
  } finally { t.close(); }
});

test("proximity and detail briefings say \"Project accepted. Dispatching the remote workforce…\" while dispatching, and never once real progress exists", () => {
  const t = createTestDb();
  try {
    const project = freshRemoteProject(t);
    const dispatchingState = getAIHeadquartersWorldState(t.db, project.id, "remote");
    const orchestrator = dispatchingState.agents.find((a) => a.roleId === "orchestrator")!;
    const proximity = proximityBriefing(orchestrator, dispatchingState, 9);
    const detail = agentBriefing(orchestrator, dispatchingState, 9);
    assert.match(proximity, /Project accepted\. Dispatching the remote workforce…/);
    assert.match(detail, /Project accepted\. Dispatching the remote workforce\./);
    assert.doesNotMatch(proximity, /No active roles recorded/);

    // Local mode with the identical persisted state must be worded exactly as before — unchanged.
    const localState = getAIHeadquartersWorldState(t.db, project.id, "local");
    const localOrchestrator = localState.agents.find((a) => a.roleId === "orchestrator")!;
    assert.match(proximityBriefing(localOrchestrator, localState, 9), /No active roles recorded/);
    assert.doesNotMatch(proximityBriefing(localOrchestrator, localState, 9), /Dispatching the remote workforce/);

    // First completed task: real progress, dispatching language must be gone.
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Define requirements" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "product-owner", provider: "groq", model: "m" });
    updateAgentRunStatus(t.db, run.id, "SUCCEEDED", Date.now());
    updateTaskStatus(t.db, task.id, "DONE");
    const doneState = getAIHeadquartersWorldState(t.db, project.id, "remote");
    const doneOrchestrator = doneState.agents.find((a) => a.roleId === "orchestrator")!;
    assert.doesNotMatch(proximityBriefing(doneOrchestrator, doneState, 9), /Dispatching the remote workforce/);
    assert.match(proximityBriefing(doneOrchestrator, doneState, 9), /1 of \d+ tasks complete/);
  } finally { t.close(); }
});

test("a project with no plan yet (before planProject runs) is never presented as dispatching", () => {
  const t = createTestDb();
  try {
    const { project } = createProjectWithIdea(t.db, { title: "unplanned", rawIdeaText: "x".repeat(20), ownerId: getOwner(t.db)!.id, routingMode: "FREE_MULTI_MODEL" });
    const state = getAIHeadquartersWorldState(t.db, project.id, "remote");
    assert.equal(state.project!.dispatching, false, "status is not yet IN_PROGRESS before planning — never claim dispatching");
  } finally { t.close(); }
});
