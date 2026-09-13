import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { createTask, getTask, listTaskAttempts } from "../../domain/tasks.ts";
import { createApproval } from "../../domain/project-outputs.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { executeTask } from "../../agents/agent-runner.ts";
import { checkTaskRetryEligibility, retryEscalatedTask } from "../task-transitions.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, {
    title: "Screenshot report tool",
    rawIdeaText: "Manual testers capture screenshots and generate a test report.",
    ownerId: owner.id,
  });
  return { owner, project };
}

function lowerMaxRetries(t: ReturnType<typeof createTestDb>, roleId: string, maxRetries: number) {
  t.db.prepare("UPDATE agent_roles SET maxRetries = ? WHERE id = ?").run(maxRetries, roleId);
}

async function escalateTask(t: ReturnType<typeof createTestDb>, projectId: string, roleId: string) {
  lowerMaxRetries(t, roleId, 1);
  const task = createTask(t.db, { projectId, roleId, title: "Do something risky" });
  await executeTask(t.db, task.id, { scenario: "failure" });
  const outcome = await executeTask(t.db, task.id, { scenario: "failure" });
  assert.equal(outcome.outcome, "escalated");
  assert.equal(getTask(t.db, task.id)?.status, "BLOCKED");
  return task;
}

describe("checkTaskRetryEligibility", () => {
  test("only a BLOCKED task is eligible", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Plan it" });
    const result = checkTaskRetryEligibility(t.db, task);
    assert.equal(result.eligible, false);
    assert.match(result.reason!, /blocked/i);
    t.close();
  });
});

describe("retryEscalatedTask", () => {
  test("moves a BLOCKED task back to PENDING, preserving attemptCount and full attempt history", async () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    const task = await escalateTask(t, project.id, "solution-architect");
    const attemptsBefore = listTaskAttempts(t.db, task.id).length;
    assert.equal(attemptsBefore, 2);
    const attemptCountBefore = getTask(t.db, task.id)!.attemptCount;
    assert.equal(attemptCountBefore, 2);

    const result = retryEscalatedTask(t.db, task.id, owner.id, "root cause fixed");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.task.status, "PENDING");
    // attemptCount is NEVER reset — task_attempts.attemptNumber is
    // derived from it and is UNIQUE per task; resetting it would
    // guarantee the very next attempt collides with real history (the
    // exact real defect this test guards against — see
    // task-transitions.ts's docblock).
    assert.equal(result.task.attemptCount, attemptCountBefore);
    assert.equal(result.task.retryBaselineAttemptCount, attemptCountBefore);

    // History of prior attempts must be untouched.
    assert.equal(listTaskAttempts(t.db, task.id).length, attemptsBefore);

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "task.retried"));

    t.close();
  });

  test("a retried task can actually be re-executed without colliding with its prior attempt history (real regression for the UNIQUE constraint crash)", async () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    const task = await escalateTask(t, project.id, "solution-architect");

    retryEscalatedTask(t.db, task.id, owner.id);

    // This is exactly what the runner does on its next poll cycle — if
    // retryEscalatedTask had reset attemptCount to 0 instead of leaving
    // it alone, this would throw "UNIQUE constraint failed:
    // task_attempts.taskId, task_attempts.attemptNumber" immediately,
    // every single time, forever.
    const outcome = await executeTask(t.db, task.id, { scenario: "success" });
    assert.equal(outcome.outcome, "succeeded");
    assert.equal(getTask(t.db, task.id)?.status, "DONE");
    assert.equal(listTaskAttempts(t.db, task.id).length, 3);

    t.close();
  });

  test("a fresh retry window still escalates again after maxRetries new failures — not immediately, and not never", async () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    // escalateTask lowers solution-architect's maxRetries to 1 and burns
    // both attempts (1 retried, 1 escalated) before returning.
    const task = await escalateTask(t, project.id, "solution-architect");

    retryEscalatedTask(t.db, task.id, owner.id);

    // Baseline is now 2 (attemptCount at retry time), maxRetries is
    // still 1 — attempt 3 (delta 1) should retry, not escalate; attempt
    // 4 (delta 2) should escalate again.
    const third = await executeTask(t.db, task.id, { scenario: "failure" });
    assert.equal(third.outcome, "retried");
    assert.equal(getTask(t.db, task.id)?.status, "PENDING");

    const fourth = await executeTask(t.db, task.id, { scenario: "failure" });
    assert.equal(fourth.outcome, "escalated");
    assert.equal(getTask(t.db, task.id)?.status, "BLOCKED");

    t.close();
  });

  test("restores project status to IN_PROGRESS once the escalated task was the only block", async () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    const task = await escalateTask(t, project.id, "solution-architect");
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    const result = retryEscalatedTask(t.db, task.id, owner.id);
    assert.equal(result.ok, true);
    assert.equal(getProject(t.db, project.id)?.status, "IN_PROGRESS");

    t.close();
  });

  test("leaves the project BLOCKED when another blocked task remains", async () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    const task = await escalateTask(t, project.id, "solution-architect");
    // A second, independent escalation on the same project keeps it blocked overall.
    await escalateTask(t, project.id, "ui-ux-agent");
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    const result = retryEscalatedTask(t.db, task.id, owner.id);
    assert.equal(result.ok, true);
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED", "a second still-blocked task must keep the project blocked");

    t.close();
  });

  test("leaves the project BLOCKED when a pending approval remains", async () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    const task = await escalateTask(t, project.id, "solution-architect");
    createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: owner.id, context: {} });
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    const result = retryEscalatedTask(t.db, task.id, owner.id);
    assert.equal(result.ok, true);
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED", "an unresolved pending approval must keep the project blocked");

    t.close();
  });

  test("a non-BLOCKED task is refused", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Plan it" });

    const result = retryEscalatedTask(t.db, task.id, owner.id);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /blocked/i);
    assert.equal(getTask(t.db, task.id)?.status, "PENDING");

    t.close();
  });

  test("a nonexistent task returns a clean failure, not a throw", () => {
    const t = createTestDb();
    const { owner } = setupProject(t);
    const result = retryEscalatedTask(t.db, "does-not-exist", owner.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not found/i);
    t.close();
  });

  test("retrying an already-retried task is refused cleanly (race-safe, not a throw)", async () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    const task = await escalateTask(t, project.id, "solution-architect");

    const first = retryEscalatedTask(t.db, task.id, owner.id);
    assert.equal(first.ok, true);

    const second = retryEscalatedTask(t.db, task.id, owner.id);
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.reason, /no longer blocked|already|only a blocked/i);

    t.close();
  });
});
