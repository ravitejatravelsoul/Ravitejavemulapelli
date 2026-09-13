import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt, updateAgentRunStatus, updateTaskStatus } from "../../domain/tasks.ts";
import { recordAiUsage } from "../../domain/budget.ts";
import { getProjectDetail } from "../project-detail-data.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  return { owner, project };
}

/** Creates one real task_attempts + agent_runs + ai_usage row set for a Claude call, exactly mirroring what agent-runner.ts itself does — no shortcuts, so this test exercises the real join `buildClaudeCostSummary` performs. */
function recordClaudeCall(
  t: ReturnType<typeof createTestDb>,
  projectId: string,
  taskId: string,
  roleId: string,
  opts: { model: string; inputTokens: number; outputTokens: number; costUsd: number; succeeded: boolean; cacheCreation?: number; cacheRead?: number },
) {
  const attempt = createTaskAttempt(t.db, taskId);
  let run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId, provider: "claude", model: opts.model });
  run = updateAgentRunStatus(t.db, run.id, opts.succeeded ? "SUCCEEDED" : "FAILED", Date.now());
  recordAiUsage(t.db, {
    agentRunId: run.id,
    projectId,
    provider: "claude",
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    costUsd: opts.costUsd,
    cacheCreationInputTokens: opts.cacheCreation ?? null,
    cacheReadInputTokens: opts.cacheRead ?? null,
  });
  return run;
}

describe("buildClaudeCostSummary (via getProjectDetail.claudeCosts)", () => {
  test("distinguishes successful from failed calls and sums their cost separately", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend — P" });

    recordClaudeCall(t, project.id, task.id, "frontend-developer", { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 2000, costUsd: 0.05, succeeded: false });
    recordClaudeCall(t, project.id, task.id, "frontend-developer", { model: "claude-sonnet-5", inputTokens: 1200, outputTokens: 2200, costUsd: 0.06, succeeded: true });
    updateTaskStatus(t.db, task.id, "DONE");

    const { claudeCosts } = getProjectDetail(t.db, project.id)!;
    assert.equal(claudeCosts.totalCalls, 2);
    assert.equal(claudeCosts.successfulCalls, 1);
    assert.equal(claudeCosts.failedCalls, 1);
    assert.ok(Math.abs(claudeCosts.failedCallsCostUsd - 0.05) < 1e-9);
    assert.ok(Math.abs(claudeCosts.totalCostUsd - 0.11) < 1e-9);
    // The second call is beyond the first for this task -> counts as retry cost, succeeded or not.
    assert.ok(Math.abs(claudeCosts.retryCostUsd - 0.06) < 1e-9);

    t.close();
  });

  test("estimatedCleanRunCostUsd sums only the first successful call per task — a real, non-fabricated baseline", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const taskA = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend — P" });
    const taskB = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Architecture — P" });

    recordClaudeCall(t, project.id, taskA.id, "frontend-developer", { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 100, costUsd: 0.02, succeeded: false });
    recordClaudeCall(t, project.id, taskA.id, "frontend-developer", { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 100, costUsd: 0.03, succeeded: true });
    recordClaudeCall(t, project.id, taskB.id, "solution-architect", { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 100, costUsd: 0.01, succeeded: true });

    const { claudeCosts } = getProjectDetail(t.db, project.id)!;
    // Clean-run = first SUCCESSFUL call per task: 0.03 (taskA's only success) + 0.01 (taskB) = 0.04 — the failed 0.02 call is excluded.
    assert.ok(claudeCosts.estimatedCleanRunCostUsd !== null);
    assert.ok(Math.abs(claudeCosts.estimatedCleanRunCostUsd! - 0.04) < 1e-9);

    t.close();
  });

  test("estimatedCleanRunCostUsd is null (never fabricated) when no call has ever succeeded", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend — P" });
    recordClaudeCall(t, project.id, task.id, "frontend-developer", { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 100, costUsd: 0.02, succeeded: false });

    const { claudeCosts } = getProjectDetail(t.db, project.id)!;
    assert.equal(claudeCosts.estimatedCleanRunCostUsd, null);

    t.close();
  });

  test("groups cost by role and by model correctly", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const taskA = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend — P" });
    const taskB = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Architecture — P" });

    recordClaudeCall(t, project.id, taskA.id, "frontend-developer", { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 100, costUsd: 0.05, succeeded: true });
    recordClaudeCall(t, project.id, taskB.id, "solution-architect", { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 100, costUsd: 0.02, succeeded: true });

    const { claudeCosts } = getProjectDetail(t.db, project.id)!;
    const frontend = claudeCosts.costByRole.find((r) => r.roleId === "frontend-developer");
    const architect = claudeCosts.costByRole.find((r) => r.roleId === "solution-architect");
    assert.ok(Math.abs(frontend!.costUsd - 0.05) < 1e-9);
    assert.ok(Math.abs(architect!.costUsd - 0.02) < 1e-9);
    assert.equal(claudeCosts.costByModel.length, 1);
    assert.equal(claudeCosts.costByModel[0].model, "claude-sonnet-5");
    assert.ok(Math.abs(claudeCosts.costByModel[0].costUsd - 0.07) < 1e-9);

    t.close();
  });

  test("sums input/output/cache tokens across all calls", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend — P" });
    recordClaudeCall(t, project.id, task.id, "frontend-developer", {
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.03,
      succeeded: true,
      cacheCreation: 200,
      cacheRead: 50,
    });

    const { claudeCosts } = getProjectDetail(t.db, project.id)!;
    assert.equal(claudeCosts.totalInputTokens, 1000);
    assert.equal(claudeCosts.totalOutputTokens, 500);
    assert.equal(claudeCosts.totalCacheCreationInputTokens, 200);
    assert.equal(claudeCosts.totalCacheReadInputTokens, 50);

    t.close();
  });
});
