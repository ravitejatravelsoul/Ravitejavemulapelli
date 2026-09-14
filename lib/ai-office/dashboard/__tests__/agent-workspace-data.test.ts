import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt, updateTaskStatus, updateAgentRunStatus } from "../../domain/tasks.ts";
import { recordFailure, recordTestResult } from "../../domain/project-outputs.ts";
import { recordAiUsage } from "../../domain/budget.ts";
import { upsertWorkspaceFileRecord } from "../../domain/workspace.ts";
import { getAgentDetail } from "../office-floor-data.ts";
import { getRolePerformance, deriveNextSteps } from "../agent-workspace-data.ts";
import { getRoleSpecialization } from "../../agents/role-specializations.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

describe("getRolePerformance", () => {
  test("a role with no tasks anywhere reports honest zeros and null rates, never a divide-by-zero NaN", () => {
    const t = createTestDb();
    const perf = getRolePerformance(t.db, "frontend-developer");
    assert.equal(perf.tasksCompleted, 0);
    assert.equal(perf.successRate, null);
    assert.equal(perf.totalActiveExecutionMs, null);
    assert.equal(perf.claudeCostUsd, 0);
    t.close();
  });

  test("aggregates a real DONE task's attempts, a real finished run's duration, a real test result, a real file, and real Claude usage — attributed to the correct role only", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id, aiPolicyMode: "HYBRID" });
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "frontend-developer", provider: "claude", model: "claude-sonnet-5" });
    updateAgentRunStatus(t.db, run.id, "SUCCEEDED", run.startedAt + 5000);

    recordTestResult(t.db, { projectId: project.id, taskId: task.id, status: "PASS", summary: "Looks good." });
    upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "index.html", sizeBytes: 120, roleId: "frontend-developer", taskId: task.id });
    recordAiUsage(t.db, { agentRunId: run.id, projectId: project.id, provider: "claude", inputTokens: 500, outputTokens: 200, costUsd: 0.004 });

    // A run belonging to a DIFFERENT role must never leak into this role's totals.
    const otherTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    const otherAttempt = createTaskAttempt(t.db, otherTask.id);
    const otherRun = createAgentRunForAttempt(t.db, { taskAttemptId: otherAttempt.id, roleId: "backend-developer", provider: "claude" });
    recordAiUsage(t.db, { agentRunId: otherRun.id, projectId: project.id, provider: "claude", inputTokens: 999, outputTokens: 999, costUsd: 9.99 });

    updateTaskStatus(t.db, task.id, "DONE");

    const perf = getRolePerformance(t.db, "frontend-developer");
    assert.equal(perf.tasksCompleted, 1);
    assert.equal(perf.successRate, 1);
    assert.equal(perf.totalAttempts, 1);
    assert.equal(perf.totalActiveExecutionMs, 5000);
    assert.equal(perf.testsPassed, 1);
    assert.equal(perf.filesTouched, 1);
    assert.ok(Math.abs(perf.claudeCostUsd - 0.004) < 1e-9, "must not include the other role's $9.99");
    t.close();
  });

  test("classifies a recorded failure as operational vs semantic using the same classifier the runner uses", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "qa-agent", provider: "simulated" });

    recordFailure(t.db, { projectId: project.id, taskId: task.id, agentRunId: run.id, reason: "Ollama request timed out after 30s." });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, agentRunId: run.id, reason: "The button does not toggle the expected class." });

    const perf = getRolePerformance(t.db, "qa-agent");
    assert.equal(perf.operationalRetries, 1);
    assert.equal(perf.semanticRetries, 1);
    t.close();
  });
});

describe("deriveNextSteps", () => {
  test("the Orchestrator's next step is its own real nextAction, not a generic fallback", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const detail = getAgentDetail(t.db, "orchestrator", project.id)!;
    const steps = deriveNextSteps(detail);
    assert.equal(steps.length, 1);
    assert.equal(steps[0], detail.orchestrator!.nextAction);
    t.close();
  });

  test("a BLOCKED task yields an honest blocked next step", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const task = createTask(t.db, { projectId: project.id, roleId: "security-reviewer", title: "Review" });
    updateTaskStatus(t.db, task.id, "BLOCKED");
    const detail = getAgentDetail(t.db, "security-reviewer", project.id)!;
    assert.deepEqual(deriveNextSteps(detail), ["Blocked — awaiting owner review."]);
    t.close();
  });

  test("a real unresolved semantic failure surfaces its exact reason, never a generic placeholder", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "frontend-developer", provider: "simulated" });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, agentRunId: run.id, reason: "The counter never increments." });
    updateTaskStatus(t.db, task.id, "IN_PROGRESS");

    const detail = getAgentDetail(t.db, "frontend-developer", project.id)!;
    assert.deepEqual(deriveNextSteps(detail), ["Address: The counter never increments."]);
    t.close();
  });

  test("a DONE task with no unresolved issues reports honest completion, not a fabricated roadmap item", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const task = createTask(t.db, { projectId: project.id, roleId: "release-agent", title: "Prepare release" });
    updateTaskStatus(t.db, task.id, "DONE");
    const detail = getAgentDetail(t.db, "release-agent", project.id)!;
    assert.deepEqual(deriveNextSteps(detail), ["No further action — this role's task is complete."]);
    t.close();
  });
});

describe("getRoleSpecialization", () => {
  test("every one of the 11 real catalog roles has real, non-empty mission/capabilities metadata", () => {
    const roleIds = [
      "orchestrator",
      "product-owner",
      "research-agent",
      "solution-architect",
      "ui-ux-agent",
      "frontend-developer",
      "backend-developer",
      "qa-agent",
      "security-reviewer",
      "code-reviewer",
      "release-agent",
    ];
    for (const roleId of roleIds) {
      const spec = getRoleSpecialization(roleId);
      assert.ok(spec.mission.length > 0, `${roleId} must have a mission`);
      assert.ok(spec.capabilities.length > 0, `${roleId} must have capabilities`);
    }
  });

  test("an unknown role id gets a safe fallback, never a crash", () => {
    const spec = getRoleSpecialization("not-a-real-role");
    assert.equal(spec.capabilities.length, 0);
    assert.ok(spec.mission.length > 0);
  });
});
