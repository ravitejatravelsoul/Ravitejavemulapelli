import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt, updateTaskStatus } from "../../domain/tasks.ts";
import { recordFailure } from "../../domain/project-outputs.ts";
import { recordAiUsage } from "../../domain/budget.ts";
import { planProject } from "../../orchestrator/orchestrator.ts";
import { runOneCycle } from "../../runner/runner.ts";
import { getProjectPipeline, getCollaborationFeed, getProjectDetail } from "../project-detail-data.ts";
import { listTasksForProject } from "../../domain/tasks.ts";
import { getOfficeAnalytics } from "../analytics-data.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

/**
 * No forced `scenario` override — a project whose plan includes
 * frontend-developer exercises the real, deliberate bug-then-fix
 * SimulatedAdapter fixture (attempt 1 writes a real but broken button,
 * attempt 2 fixes it), which only self-corrects when `executeTask`'s own
 * attempt-based scenario default is left alone. Forcing "success" on
 * every cycle (as the simpler backend-only tests do) would leave that
 * bug in place forever and the task stuck retrying.
 */
async function runToCompletion(db: Parameters<typeof runOneCycle>[0], maxCycles = 40) {
  for (let i = 0; i < maxCycles; i++) {
    const outcome = await runOneCycle(db, "runner-1", {});
    if (outcome.kind === "idle" || outcome.kind === "office-closed") break;
  }
}

describe("getProjectPipeline", () => {
  test("a fully completed, frontend-only project shows every planned stage COMPLETE and Build/backend as SKIPPED-consistent (no backend task exists)", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Static Page",
      rawIdeaText: "Build a small static webpage with a heading and a button. No backend or database is needed.",
      ownerId: owner.id,
    });
    planProject(t.db, project.id);
    await runToCompletion(t.db);

    const pipeline = getProjectPipeline(t.db, project.id);
    const byKey = Object.fromEntries(pipeline.map((s) => [s.key, s.state]));
    assert.equal(byKey.idea, "COMPLETE");
    assert.equal(byKey.requirements, "COMPLETE");
    assert.equal(byKey.build, "COMPLETE", "frontend-developer alone still satisfies the Build stage");
    assert.equal(byKey.release, "COMPLETE");
    t.close();
  });

  test("a stage with no role selected at all reads SKIPPED, never PENDING/BLOCKED", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    // No tasks planned at all — every later stage has zero roleIds present.
    const pipeline = getProjectPipeline(t.db, project.id);
    for (const stage of pipeline) {
      if (stage.key === "idea") continue;
      assert.equal(stage.state, "SKIPPED");
    }
    t.close();
  });

  test("a BLOCKED task's stage reads BLOCKED, not COMPLETE, even if other stages finished", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build something.", ownerId: owner.id });
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test" });
    const attempt = createTaskAttempt(t.db, task.id);
    createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "qa-agent", provider: "simulated" });
    // Force it BLOCKED directly via the same mechanism escalation uses.
    updateTaskStatus(t.db, task.id, "BLOCKED");

    const pipeline = getProjectPipeline(t.db, project.id);
    const qaStage = pipeline.find((s) => s.key === "qa")!;
    assert.equal(qaStage.state, "BLOCKED");
    t.close();
  });
});

// Platform-hardening / runner-reliability follow-up, Phase 6 — the
// second real AI Office pilot's owner saw "Idea/Requirements/
// Architecture COMPLETE" in the pipeline alongside "Progress: 2/7
// tasks" and read that as a contradiction. It never actually was one —
// `getProjectPipeline`'s "Idea" entry is a hardcoded, always-COMPLETE
// synthetic stage (the input, not a planned task) and was never counted
// in `progress.completed`/`.total`, which is derived purely from the
// real `tasks` table — but the confusion itself was real, so this locks
// the already-correct invariant in permanently: both views must always
// derive from the exact same task source and can never mathematically
// disagree.
describe("progress/pipeline consistency (Part 6 of the runner-reliability follow-up)", () => {
  test("numeric progress never counts the synthetic 'Idea' pipeline stage as one of the real tasks", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small backend service with a database.", ownerId: owner.id });
    createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test" });

    const detail = getProjectDetail(t.db, project.id)!;
    const realTaskCount = listTasksForProject(t.db, project.id).length;
    assert.equal(detail.progress.total, realTaskCount, "progress.total must equal the real task count — 'Idea' is never one of them");

    const pipeline = getProjectPipeline(t.db, project.id);
    assert.equal(pipeline.find((s) => s.key === "idea")?.state, "COMPLETE", "the Idea stage itself is always shown complete (it's the input, not a task)");
    // "Idea" being COMPLETE must never inflate progress.total by one.
    assert.notEqual(detail.progress.total, realTaskCount + 1);
  });

  test("progress.completed and every DONE-derived pipeline stage always agree — completing every real task makes both report full completion together", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Static Page",
      rawIdeaText: "Build a small static webpage with a heading and a button. No backend or database is needed.",
      ownerId: owner.id,
    });
    planProject(t.db, project.id);
    await runToCompletion(t.db);

    const detail = getProjectDetail(t.db, project.id)!;
    assert.equal(detail.progress.completed, detail.progress.total, "every real task completed — progress must read fully done");

    const pipeline = getProjectPipeline(t.db, project.id);
    const nonSkippedNonIdea = pipeline.filter((s) => s.key !== "idea" && s.state !== "SKIPPED");
    assert.ok(nonSkippedNonIdea.length > 0);
    assert.ok(nonSkippedNonIdea.every((s) => s.state === "COMPLETE"), "every planned (non-skipped) stage must read COMPLETE exactly when progress reports 100%");
  });

  test("a partially-done project's progress fraction reflects exactly the real DONE task count, matching the pipeline's own ACTIVE/PENDING stages — the literal 2/7 scenario the owner saw", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "TaskFlow", rawIdeaText: "Build a personal task manager.", ownerId: owner.id });
    const roles = ["product-owner", "solution-architect", "backend-developer", "qa-agent", "security-reviewer", "code-reviewer", "release-agent"];
    const tasks = roles.map((roleId) => createTask(t.db, { projectId: project.id, roleId, title: `Task for ${roleId}` }));
    updateTaskStatus(t.db, tasks[0].id, "DONE");
    updateTaskStatus(t.db, tasks[1].id, "DONE");
    updateTaskStatus(t.db, tasks[2].id, "IN_PROGRESS");

    const detail = getProjectDetail(t.db, project.id)!;
    assert.equal(detail.progress.completed, 2);
    assert.equal(detail.progress.total, 7);

    const pipeline = getProjectPipeline(t.db, project.id);
    const byKey = Object.fromEntries(pipeline.map((s) => [s.key, s.state]));
    assert.equal(byKey.idea, "COMPLETE");
    assert.equal(byKey.requirements, "COMPLETE");
    assert.equal(byKey.architecture, "COMPLETE");
    assert.equal(byKey.build, "ACTIVE");
    assert.equal(byKey.qa, "PENDING");
    t.close();
  });
});

describe("getCollaborationFeed", () => {
  test("a completed task produces a real, role-attributed completion entry", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a tiny tool.", ownerId: owner.id });
    planProject(t.db, project.id);
    await runToCompletion(t.db);

    const feed = getCollaborationFeed(t.db, project.id);
    assert.ok(feed.length > 0);
    assert.ok(feed.some((e) => e.fromRoleName === "Product Owner" && e.message.includes("Completed")));
    t.close();
  });

  test("a real failure hand-off names the detecting reviewer and the target role it was returned to", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });

    const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    const qaTask = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test" });
    const qaAttempt = createTaskAttempt(t.db, qaTask.id);
    const qaRun = createAgentRunForAttempt(t.db, { taskAttemptId: qaAttempt.id, roleId: "qa-agent", provider: "simulated" });

    recordFailure(t.db, { projectId: project.id, taskId: devTask.id, agentRunId: qaRun.id, reason: "The button does not respond to clicks." });

    const feed = getCollaborationFeed(t.db, project.id);
    const handoff = feed.find((e) => e.message.includes("does not respond"));
    assert.ok(handoff, "expected a hand-off entry for the recorded failure");
    assert.equal(handoff!.fromRoleName, "QA/Test Agent");
    assert.match(handoff!.message, /Returning to Frontend Developer\.$/);
    t.close();
  });

  test("an empty project returns an empty feed, not an error", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    assert.deepEqual(getCollaborationFeed(t.db, project.id), []);
    t.close();
  });
});

describe("getOfficeAnalytics", () => {
  test("a fresh office with no projects reports honest zeros, never omitted sections", () => {
    const t = createTestDb();
    const a = getOfficeAnalytics(t.db);
    assert.equal(a.totalProjects, 0);
    assert.equal(a.claudeCalls, 0);
    assert.equal(a.claudeCostUsd, 0);
    t.close();
  });

  test("a real Claude ai_usage row attributed to a DONE task is counted correctly, including cache tokens", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id, aiPolicyMode: "HYBRID" });
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "frontend-developer", provider: "claude", model: "claude-sonnet-5" });
    recordAiUsage(t.db, {
      agentRunId: run.id,
      projectId: project.id,
      provider: "claude",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0105,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 800,
    });
    updateTaskStatus(t.db, task.id, "DONE");

    const a = getOfficeAnalytics(t.db);
    assert.equal(a.claudeCalls, 1);
    assert.ok(Math.abs(a.claudeCostUsd - 0.0105) < 1e-9);
    assert.equal(a.claudeInputTokens, 1000);
    assert.equal(a.claudeOutputTokens, 500);
    assert.equal(a.claudeCacheReadTokens, 800);
    assert.equal(a.claudeCacheWriteTokens, 200);
    assert.ok(Math.abs(a.costPerCompletedPaidTask - 0.0105) < 1e-9);
    t.close();
  });
});
