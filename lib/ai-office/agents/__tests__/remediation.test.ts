import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { createTask, createTaskWithDependencies, getTask, listTaskAttempts } from "../../domain/tasks.ts";
import { listUnresolvedFailures } from "../../domain/project-outputs.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { executeTask } from "../agent-runner.ts";
import { getProjectDetail } from "../../dashboard/project-detail-data.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

// See phase4-simulation.test.ts's identical block for why this matters:
// isolates any real file writes a frontend-developer task might trigger
// into a throwaway temp directory rather than this machine's real
// .data/ai-office-workspaces/.
let workspaceRoot: string;
beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-test-workspace-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
});
afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(workspaceRoot, { recursive: true, force: true });
});

/**
 * Regression coverage for the fix described in the Phase 4 status note
 * in docs/ai-office/11-implementation-phases.md: Security Reviewer and
 * Code Reviewer failures used to reopen QA (their *direct* dependency)
 * instead of the development task that actually needs a code change.
 * These tests build the real Phase 4 workflow graph — Developer -> QA ->
 * Security and Developer -> QA -> Code Review — and drive failures
 * through the real AgentRunner/domain APIs, never by hand-editing rows.
 */

function setupProjectWithChain(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, {
    title: "Screenshot report tool",
    rawIdeaText: "Manual testers capture screenshots and generate a test report.",
    ownerId: owner.id,
  });

  const devTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement tool" });
  const { task: qaTask } = createTaskWithDependencies(t.db, {
    projectId: project.id,
    roleId: "qa-agent",
    title: "Test tool",
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

  return { t, project, devTask, qaTask, securityTask, codeReviewTask, releaseTask };
}

async function runToSecurityAndCodeReview(ctx: ReturnType<typeof setupProjectWithChain>) {
  await executeTask(ctx.t.db, ctx.devTask.id, { scenario: "success" });
  await executeTask(ctx.t.db, ctx.qaTask.id, { scenario: "success" });
}

describe("Security Reviewer failure routes to the responsible development task", () => {
  test("dev succeeds -> QA passes -> Security fails -> failure recorded against dev, not QA -> dev+QA+Security all reopened", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    await runToSecurityAndCodeReview(ctx);
    assert.equal(getTask(ctx.t.db, ctx.qaTask.id)?.status, "DONE");

    const result = await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "failure" });
    assert.equal(result.outcome, "retried");

    const failures = listUnresolvedFailures(ctx.t.db, ctx.project.id);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].taskId, ctx.devTask.id, "the failure belongs to the developer task, not QA");

    assert.equal(getTask(ctx.t.db, ctx.devTask.id)?.status, "PENDING", "dev is reopened for remediation");
    assert.equal(getTask(ctx.t.db, ctx.qaTask.id)?.status, "PENDING", "QA is invalidated — it validated the code now being changed");
    assert.equal(getTask(ctx.t.db, ctx.securityTask.id)?.status, "PENDING", "Security itself is reopened to re-run");

    const invalidationEvents = listEventsForProject(ctx.t.db, ctx.project.id).filter(
      (e) => e.type === "task.invalidated_by_upstream_change",
    );
    assert.equal(invalidationEvents.length, 1);
    assert.equal(JSON.parse(invalidationEvents[0].payload).taskId, ctx.qaTask.id);

    ctx.t.close();
  });

  test("the project detail page explains why a reopened task is queued again, instead of silently reducing progress (reliability fix)", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    await runToSecurityAndCodeReview(ctx);
    await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "failure" });

    const detail = getProjectDetail(ctx.t.db, ctx.project.id);
    assert.ok(detail);
    const devTaskView = detail!.tasks.find((t) => t.id === ctx.devTask.id)!;
    const qaTaskView = detail!.tasks.find((t) => t.id === ctx.qaTask.id)!;
    const releaseTaskView = detail!.tasks.find((t) => t.id === ctx.releaseTask.id)!;

    assert.match(devTaskView.reopenedNote!, /security reviewer/i, "names the role that actually requested the rework — the real remediation target");
    // QA is reopened through a *different* mechanism (upstream-invalidation,
    // "task.invalidated_by_upstream_change" — see the test above) rather
    // than being a named remediation target of the Security failure itself,
    // so it correctly gets no note from this lookup rather than a
    // misattributed one.
    assert.equal(qaTaskView.reopenedNote, null);
    assert.equal(releaseTaskView.reopenedNote, null, "a task that was never attempted has nothing to explain");

    ctx.t.close();
  });

  test("full remediation loop: dev fix -> QA reruns and passes -> Security reruns and passes -> workflow continues", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    await runToSecurityAndCodeReview(ctx);
    await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "failure" });

    const devFix = await executeTask(ctx.t.db, ctx.devTask.id, { scenario: "retry-success" });
    assert.equal(devFix.outcome, "succeeded");
    assert.equal(getTask(ctx.t.db, ctx.devTask.id)?.attemptCount, 2);

    const qaRerun = await executeTask(ctx.t.db, ctx.qaTask.id, { scenario: "success" });
    assert.equal(qaRerun.outcome, "succeeded");
    assert.equal(getTask(ctx.t.db, ctx.qaTask.id)?.attemptCount, 2);

    const securityRerun = await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "success" });
    assert.equal(securityRerun.outcome, "succeeded");
    assert.equal(getTask(ctx.t.db, ctx.securityTask.id)?.attemptCount, 2);

    assert.equal(listUnresolvedFailures(ctx.t.db, ctx.project.id).length, 0, "the failure is resolved once the dev fix succeeds");

    // Code Review still hasn't run — project must not be ready yet.
    assert.notEqual(getProject(ctx.t.db, ctx.project.id)?.status, "READY_FOR_REVIEW");

    const codeReview = await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "success" });
    assert.equal(codeReview.outcome, "succeeded");

    const release = await executeTask(ctx.t.db, ctx.releaseTask.id, { scenario: "success" });
    assert.equal(release.outcome, "succeeded");
    assert.equal(getProject(ctx.t.db, ctx.project.id)?.status, "READY_FOR_REVIEW");

    ctx.t.close();
  });
});

describe("Code Reviewer failure routes to the responsible development task", () => {
  test("dev succeeds -> QA passes -> Code Review fails -> failure recorded against dev, not QA -> dev+QA+CodeReview all reopened", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    await runToSecurityAndCodeReview(ctx);

    const result = await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "failure" });
    assert.equal(result.outcome, "retried");

    const failures = listUnresolvedFailures(ctx.t.db, ctx.project.id);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].taskId, ctx.devTask.id, "the failure belongs to the developer task, not QA");
    assert.match(failures[0].reason, /error handling/);

    assert.equal(getTask(ctx.t.db, ctx.devTask.id)?.status, "PENDING");
    assert.equal(getTask(ctx.t.db, ctx.qaTask.id)?.status, "PENDING");
    assert.equal(getTask(ctx.t.db, ctx.codeReviewTask.id)?.status, "PENDING");

    ctx.t.close();
  });

  test("full remediation loop: dev fix -> QA reruns -> Code Review reruns and passes -> workflow continues", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    await runToSecurityAndCodeReview(ctx);
    await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "failure" });

    await executeTask(ctx.t.db, ctx.devTask.id, { scenario: "retry-success" });
    await executeTask(ctx.t.db, ctx.qaTask.id, { scenario: "success" });
    const codeReviewRerun = await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "success" });
    assert.equal(codeReviewRerun.outcome, "succeeded");

    await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "success" });
    const release = await executeTask(ctx.t.db, ctx.releaseTask.id, { scenario: "success" });
    assert.equal(release.outcome, "succeeded");
    assert.equal(getProject(ctx.t.db, ctx.project.id)?.status, "READY_FOR_REVIEW");

    ctx.t.close();
  });
});

describe("combined: Security already passed, Code Review fails afterward -> Security must rerun", () => {
  test("Security (already DONE) is invalidated and reopened when Code Review fails on the same development task", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    await runToSecurityAndCodeReview(ctx);

    const security = await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "success" });
    assert.equal(security.outcome, "succeeded");
    assert.equal(getTask(ctx.t.db, ctx.securityTask.id)?.status, "DONE");

    const codeReviewFail = await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "failure" });
    assert.equal(codeReviewFail.outcome, "retried");

    // Security already passed — but the code is changing again, so it's stale.
    assert.equal(
      getTask(ctx.t.db, ctx.securityTask.id)?.status,
      "PENDING",
      "an already-passed Security review must be invalidated when Code Review sends the code back for changes",
    );
    assert.equal(getTask(ctx.t.db, ctx.qaTask.id)?.status, "PENDING");
    assert.equal(getTask(ctx.t.db, ctx.devTask.id)?.status, "PENDING");

    const invalidationEvents = listEventsForProject(ctx.t.db, ctx.project.id).filter(
      (e) => e.type === "task.invalidated_by_upstream_change",
    );
    const invalidatedTaskIds = invalidationEvents.map((e) => JSON.parse(e.payload).taskId).sort();
    assert.deepEqual(invalidatedTaskIds, [ctx.qaTask.id, ctx.securityTask.id].sort());

    // Full recovery: dev fix -> QA -> both reviews rerun -> release.
    await executeTask(ctx.t.db, ctx.devTask.id, { scenario: "retry-success" });
    await executeTask(ctx.t.db, ctx.qaTask.id, { scenario: "success" });
    const securityRerun = await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "success" });
    assert.equal(securityRerun.outcome, "succeeded");
    assert.equal(getTask(ctx.t.db, ctx.securityTask.id)?.attemptCount, 2, "Security genuinely re-ran, it wasn't just left alone");
    const codeReviewRerun = await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "success" });
    assert.equal(codeReviewRerun.outcome, "succeeded");

    const release = await executeTask(ctx.t.db, ctx.releaseTask.id, { scenario: "success" });
    assert.equal(release.outcome, "succeeded");
    assert.equal(getProject(ctx.t.db, ctx.project.id)?.status, "READY_FOR_REVIEW");

    ctx.t.close();
  });
});

describe("repeated Security/Code Review failure escalates and does not loop forever", () => {
  test("Security failing past maxRetries escalates instead of retrying indefinitely", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    ctx.t.db.prepare("UPDATE agent_roles SET maxRetries = 1 WHERE id = 'security-reviewer'").run();
    await runToSecurityAndCodeReview(ctx);

    const first = await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "failure" });
    assert.equal(first.outcome, "retried");

    // Fix cycle back to Security without actually fixing the underlying issue (still "failure" scenario).
    await executeTask(ctx.t.db, ctx.devTask.id, { scenario: "retry-success" });
    await executeTask(ctx.t.db, ctx.qaTask.id, { scenario: "success" });
    const second = await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "failure" });

    assert.equal(second.outcome, "escalated");
    assert.equal(getTask(ctx.t.db, ctx.securityTask.id)?.status, "BLOCKED");
    assert.equal(getProject(ctx.t.db, ctx.project.id)?.status, "BLOCKED");

    // No infinite loop: a third call is refused outright.
    const third = await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "success" });
    assert.equal(third.outcome, "not-eligible");

    ctx.t.close();
  });

  test("Code Review failing past maxRetries escalates instead of retrying indefinitely", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    ctx.t.db.prepare("UPDATE agent_roles SET maxRetries = 1 WHERE id = 'code-reviewer'").run();
    await runToSecurityAndCodeReview(ctx);

    await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "failure" });
    await executeTask(ctx.t.db, ctx.devTask.id, { scenario: "retry-success" });
    await executeTask(ctx.t.db, ctx.qaTask.id, { scenario: "success" });
    const second = await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "failure" });

    assert.equal(second.outcome, "escalated");
    assert.equal(getTask(ctx.t.db, ctx.codeReviewTask.id)?.status, "BLOCKED");
    assert.equal(getProject(ctx.t.db, ctx.project.id)?.status, "BLOCKED");

    assert.deepEqual(
      listTaskAttempts(ctx.t.db, ctx.codeReviewTask.id).map((a) => a.status),
      ["FAILED", "FAILED"],
    );

    ctx.t.close();
  });
});

describe("project readiness still requires every review task to be DONE", () => {
  test("READY_FOR_REVIEW is unreachable while a reopened review task is pending, and reached once everything is DONE again", async () => {
    const ctx = setupProjectWithChain(createTestDb());
    await runToSecurityAndCodeReview(ctx);
    await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "success" });
    await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "failure" }); // invalidates Security too

    assert.notEqual(getProject(ctx.t.db, ctx.project.id)?.status, "READY_FOR_REVIEW");

    await executeTask(ctx.t.db, ctx.devTask.id, { scenario: "retry-success" });
    await executeTask(ctx.t.db, ctx.qaTask.id, { scenario: "success" });
    await executeTask(ctx.t.db, ctx.securityTask.id, { scenario: "success" });
    assert.notEqual(getProject(ctx.t.db, ctx.project.id)?.status, "READY_FOR_REVIEW", "Code Review still hasn't re-passed");

    await executeTask(ctx.t.db, ctx.codeReviewTask.id, { scenario: "success" });
    await executeTask(ctx.t.db, ctx.releaseTask.id, { scenario: "success" });
    assert.equal(getProject(ctx.t.db, ctx.project.id)?.status, "READY_FOR_REVIEW");

    ctx.t.close();
  });
});
