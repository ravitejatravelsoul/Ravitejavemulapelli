import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { createTask, createTaskWithDependencies, getTask, listTasksForProject, listTaskAttempts } from "../../domain/tasks.ts";
import { listArtifactsForProject, listTestResultsForTask, listUnresolvedFailures } from "../../domain/project-outputs.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { listAiUsageForProject, sumAiUsageCostForProject } from "../../domain/budget.ts";
import { getProjectMemory } from "../../domain/project-memory.ts";
import { executeTask } from "../agent-runner.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

// Isolates any real file writes a frontend-developer task might trigger
// (Phase 8's SimulatedAdapter fixture writes real files) into a throwaway
// temp directory — without this, a test whose idea/role selection ever
// touches frontend-developer would leak real directories into this
// machine's actual .data/ai-office-workspaces/, orphaned forever since
// the owning project only ever exists in this test's temp SQLite DB.
let workspaceRoot: string;
beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-test-workspace-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
});
afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(workspaceRoot, { recursive: true, force: true });
});

const IDEA_TEXT = "Build a simple tool where manual testers capture screenshots and generate a test report.";

/**
 * The full Phase 4 acceptance scenario — docs/ai-office/05-orchestration-workflow.md
 * §3.1's required sequence, manually constructed (no real Orchestrator,
 * per this phase's explicit scope). Project created -> Product ->
 * Research -> Architecture -> Development -> QA fails -> Developer fix
 * -> QA passes -> Security -> Code Review -> Release readiness.
 */
async function runFullSimulation() {
  const t = createTestDb();
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, {
    title: "Screenshot Test Report Tool",
    rawIdeaText: IDEA_TEXT,
    ownerId: owner.id,
  });

  const productTask = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Define requirements" });
  const { task: researchTask } = createTaskWithDependencies(t.db, {
    projectId: project.id,
    roleId: "research-agent",
    title: "Research prior art",
    dependsOnTaskIds: [productTask.id],
  });
  const { task: archTask } = createTaskWithDependencies(t.db, {
    projectId: project.id,
    roleId: "solution-architect",
    title: "Design architecture",
    dependsOnTaskIds: [researchTask.id],
  });
  const { task: devTask } = createTaskWithDependencies(t.db, {
    projectId: project.id,
    roleId: "backend-developer",
    title: "Implement the tool",
    dependsOnTaskIds: [archTask.id],
  });
  const { task: qaTask } = createTaskWithDependencies(t.db, {
    projectId: project.id,
    roleId: "qa-agent",
    title: "Test the tool",
    dependsOnTaskIds: [devTask.id],
  });
  const { task: securityTask } = createTaskWithDependencies(t.db, {
    projectId: project.id,
    roleId: "security-reviewer",
    title: "Security review",
    dependsOnTaskIds: [qaTask.id],
  });
  const { task: codeReviewTask } = createTaskWithDependencies(t.db, {
    projectId: project.id,
    roleId: "code-reviewer",
    title: "Code review",
    dependsOnTaskIds: [qaTask.id],
  });
  const { task: releaseTask } = createTaskWithDependencies(t.db, {
    projectId: project.id,
    roleId: "release-agent",
    title: "Prepare release",
    dependsOnTaskIds: [securityTask.id, codeReviewTask.id],
  });

  const outcomes = {
    product: await executeTask(t.db, productTask.id, { scenario: "success" }),
    research: await executeTask(t.db, researchTask.id, { scenario: "success" }),
    architecture: await executeTask(t.db, archTask.id, { scenario: "success" }),
    devFirst: await executeTask(t.db, devTask.id, { scenario: "success" }),
    qaFail: await executeTask(t.db, qaTask.id, { scenario: "failure" }),
    devFix: await executeTask(t.db, devTask.id, { scenario: "retry-success" }),
    qaPass: await executeTask(t.db, qaTask.id, { scenario: "success" }),
    security: await executeTask(t.db, securityTask.id, { scenario: "success" }),
    codeReview: await executeTask(t.db, codeReviewTask.id, { scenario: "success" }),
    release: await executeTask(t.db, releaseTask.id, { scenario: "success" }),
  };

  const taskIds = {
    productTask: productTask.id,
    researchTask: researchTask.id,
    archTask: archTask.id,
    devTask: devTask.id,
    qaTask: qaTask.id,
    securityTask: securityTask.id,
    codeReviewTask: codeReviewTask.id,
    releaseTask: releaseTask.id,
  };

  return { t, project, taskIds, outcomes };
}

function assertFullSimulation(result: Awaited<ReturnType<typeof runFullSimulation>>) {
  const { t, project, taskIds, outcomes } = result;

  // Every step's immediate outcome.
  assert.equal(outcomes.product.outcome, "succeeded");
  assert.equal(outcomes.research.outcome, "succeeded");
  assert.equal(outcomes.architecture.outcome, "succeeded");
  assert.equal(outcomes.devFirst.outcome, "succeeded");
  assert.equal(outcomes.qaFail.outcome, "retried");
  assert.equal(outcomes.devFix.outcome, "succeeded");
  assert.equal(outcomes.qaPass.outcome, "succeeded");
  assert.equal(outcomes.security.outcome, "succeeded");
  assert.equal(outcomes.codeReview.outcome, "succeeded");
  assert.equal(outcomes.release.outcome, "succeeded");

  // Expected project status: READY_FOR_REVIEW (all 8 tasks DONE, latest test PASS).
  const finalProject = getProject(t.db, project.id);
  assert.equal(finalProject?.status, "READY_FOR_REVIEW");

  // Every task DONE — no pending task left unintentionally.
  const allTasks = listTasksForProject(t.db, project.id);
  assert.equal(allTasks.length, 8);
  for (const task of allTasks) {
    assert.equal(task.status, "DONE", `task "${task.title}" (${task.roleId}) should be DONE, was ${task.status}`);
  }

  // Retry counts: dev and QA attempted twice, everything else once.
  assert.equal(getTask(t.db, taskIds.devTask)?.attemptCount, 2);
  assert.equal(getTask(t.db, taskIds.qaTask)?.attemptCount, 2);
  for (const id of [taskIds.productTask, taskIds.researchTask, taskIds.archTask, taskIds.securityTask, taskIds.codeReviewTask, taskIds.releaseTask]) {
    assert.equal(getTask(t.db, id)?.attemptCount, 1);
  }

  // Every TaskAttempt exists with the right terminal status. The
  // developer succeeds both times it's asked to work (first pass, then
  // the fix) — it's QA's own attempt that records the FAILED outcome
  // when it finds the bug, per docs/ai-office/05-orchestration-workflow.md
  // §3.1 ("TaskAttempt(FAILED) on QA task").
  assert.deepEqual(
    listTaskAttempts(t.db, taskIds.devTask).map((a) => a.status),
    ["SUCCEEDED", "SUCCEEDED"],
  );
  assert.deepEqual(
    listTaskAttempts(t.db, taskIds.qaTask).map((a) => a.status),
    ["FAILED", "SUCCEEDED"],
  );

  // Artifacts: requirements, research-notes, architecture, code x2 (v1 fail path produced none — code is only written on SUCCESS, so exactly 2: first success + retry-success), security-report, review-notes, release-summary.
  const artifacts = listArtifactsForProject(t.db, project.id);
  const artifactTypes = artifacts.map((a) => a.type).sort();
  assert.deepEqual(artifactTypes, [
    "architecture",
    "code",
    "code",
    "release-summary",
    "requirements",
    "research-notes",
    "review-notes",
    "security-report",
  ]);

  // Test results: one FAIL (first QA attempt), one PASS (second).
  const testResults = listTestResultsForTask(t.db, taskIds.qaTask);
  assert.deepEqual(
    testResults.map((r) => r.status),
    ["FAIL", "PASS"],
  );

  // Failure history: the QA-triggered failure against the dev task exists and was resolved once the fix succeeded.
  assert.equal(listUnresolvedFailures(t.db, project.id).length, 0, "the failure should have been resolved by the successful fix");

  // Events: at least one failed + several succeeded events recorded.
  const events = listEventsForProject(t.db, project.id);
  assert.equal(events.filter((e) => e.type === "agent_run.failed").length, 1);
  assert.equal(events.filter((e) => e.type === "agent_run.succeeded").length, 9);

  // AI usage: one row per executeTask call (10 total), all $0.
  const usage = listAiUsageForProject(t.db, project.id);
  assert.equal(usage.length, 10);
  assert.equal(sumAiUsageCostForProject(t.db, project.id), 0);

  // Project memory reflects the finished state.
  const memory = getProjectMemory(t.db, project.id);
  assert.ok(memory);
  assert.match(memory!.summary, /8\/8 tasks complete/);
  assert.match(memory!.summary, /READY_FOR_REVIEW/);
  assert.match(memory!.summary, /Latest test result: PASS/);
  assert.deepEqual(JSON.parse(memory!.knownIssues), [], "no unresolved issues once the fix landed");
}

describe("Phase 4 full simulation acceptance test", () => {
  test("idea -> product -> research -> architecture -> dev -> QA fail -> fix -> QA pass -> security -> code review -> release readiness", async () => {
    const result = await runFullSimulation();
    assertFullSimulation(result);
    result.t.close();
  });

  test("the same scenario run 3 consecutive times against fresh databases produces identical, deterministic results", async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const result = await runFullSimulation();
      assertFullSimulation(result);
      runs.push(result);
    }

    // Cross-run determinism: the same artifact content, same summary text,
    // same attempt counts — every run of an identical scenario sequence
    // against a fresh DB produces the same shape of outcome.
    const summaries = runs.map((r) => listArtifactsForProject(r.t.db, r.project.id).map((a) => a.content));
    assert.deepEqual(summaries[0], summaries[1]);
    assert.deepEqual(summaries[1], summaries[2]);

    const memorySummaries = runs.map((r) => getProjectMemory(r.t.db, r.project.id)?.summary.replace(r.project.id, "<id>"));
    // Summaries reference project title/status/counts, not ids — should be identical across runs.
    assert.equal(memorySummaries[0], memorySummaries[1]);
    assert.equal(memorySummaries[1], memorySummaries[2]);

    for (const r of runs) r.t.close();
  });
});
