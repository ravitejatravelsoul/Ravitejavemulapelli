import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../users.ts";
import { getOfficeStatus, setOfficeStatus } from "../office.ts";
import { createProjectWithIdea, getProject, getProjectIdea, listProjects, updateProjectStatus } from "../projects.ts";
import {
  createTask,
  createTaskWithDependencies,
  listTaskDependencies,
  createTaskAttempt,
  listTaskAttempts,
  createAgentRunForAttempt,
  updateAgentRunStatus,
  claimTask,
  releaseLease,
  findStaleLeasedTasks,
  getTask,
} from "../tasks.ts";
import { recordEvent, listEventsForProject, recordAuditEntry, listAuditEntries } from "../events.ts";
import {
  recordDecision,
  listDecisionsForProject,
  createArtifact,
  listArtifactsForProject,
  recordTestResult,
  listTestResultsForTask,
  recordFailure,
  resolveFailure,
  listUnresolvedFailures,
  createApproval,
  decideApproval,
  listPendingApprovals,
} from "../project-outputs.ts";
import { getLatestOfficeBudgetRecord, recordAiUsage, listAiUsageForProject, sumAiUsageCostForProject } from "../budget.ts";

// Synthetic, test-only owner credentials so `seedOwnerFromEnv` has
// something to seed — deliberately NOT a real scrypt hash (these tests
// never call verifyOwnerCredentials, only getOwner()) and deliberately
// set here rather than relying on the developer's real `.env.local`,
// which plain `node --test` never loads anyway. Every test DB here is an
// isolated temp file (see lib/ai-office/db/test-helpers.ts) — never the
// owner's real local database.
process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

/** Every test in this file needs an owner + project to hang work off of — a small local fixture, not a shared global. */
function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db);
  assert.ok(owner, "seedOwnerFromEnv should have seeded an owner from the ambient test env vars");
  const { project, idea } = createProjectWithIdea(t.db, {
    title: "Screenshot-to-report tool",
    rawIdeaText: "Manual testers capture screenshots and get a professional report.",
    ownerId: owner!.id,
  });
  return { owner: owner!, project, idea };
}

describe("project + idea atomic creation", () => {
  test("createProjectWithIdea creates both rows together", () => {
    const t = createTestDb();
    const { project, idea } = setupProject(t);
    assert.equal(project.status, "DRAFT");
    assert.equal(project.aiMode, "SIMULATED");
    assert.equal(idea.projectId, project.id);
    assert.equal(getProject(t.db, project.id)?.id, project.id);
    assert.equal(getProjectIdea(t.db, project.id)?.id, idea.id);
    t.close();
  });

  test("a second idea for the same project is rejected (UNIQUE projectId)", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    assert.throws(() => {
      t.db
        .prepare("INSERT INTO project_ideas (id, projectId, rawText, submittedAt, createdAt, updatedAt) VALUES ('x','" + project.id + "','dup',1,1,1)")
        .run();
    });
    t.close();
  });

  test("updateProjectStatus updates status and bumps updatedAt", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const before = project.updatedAt;
    const updated = updateProjectStatus(t.db, project.id, "PLANNING");
    assert.equal(updated.status, "PLANNING");
    assert.ok(updated.updatedAt >= before);
    assert.equal(listProjects(t.db, { status: "PLANNING" }).length, 1);
    t.close();
  });
});

describe("office status persistence", () => {
  test("the seeded singleton starts OPEN and can transition to CLOSED and back", () => {
    const t = createTestDb();
    assert.equal(getOfficeStatus(t.db)?.state, "OPEN");

    const closed = setOfficeStatus(t.db, { state: "CLOSED", changedBy: getOwner(t.db)!.id, reason: "test" });
    assert.equal(closed.state, "CLOSED");
    assert.equal(closed.reason, "test");

    const reopened = setOfficeStatus(t.db, { state: "OPEN", changedBy: null, reason: null });
    assert.equal(reopened.state, "OPEN");
    t.close();
  });
});

describe("task creation, dependencies, attempts", () => {
  test("createTask creates a PENDING task with attemptCount 0 and no lease", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
    assert.equal(task.status, "PENDING");
    assert.equal(task.attemptCount, 0);
    assert.equal(task.leaseOwnerId, null);
    assert.equal(task.leaseExpiresAt, null);
    t.close();
  });

  test("createTaskWithDependencies atomically creates a task and its dependency edges", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const reqTask = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    const { task: archTask, dependencies } = createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "solution-architect",
      title: "Architecture",
      dependsOnTaskIds: [reqTask.id],
    });
    assert.equal(dependencies.length, 1);
    assert.equal(dependencies[0].dependsOnTaskId, reqTask.id);
    assert.deepEqual(
      listTaskDependencies(t.db, archTask.id).map((d) => d.dependsOnTaskId),
      [reqTask.id],
    );
    t.close();
  });

  test("a self-dependency is rejected", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "x" });
    assert.throws(() => {
      t.db
        .prepare("INSERT INTO task_dependencies (id, taskId, dependsOnTaskId, createdAt) VALUES ('d1', ?, ?, 1)")
        .run(task.id, task.id);
    });
    t.close();
  });

  test("createTaskAttempt bumps attemptCount and records the attempt number in one transaction", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Run tests" });

    const attempt1 = createTaskAttempt(t.db, task.id);
    assert.equal(attempt1.attemptNumber, 1);
    assert.equal(getTask(t.db, task.id)?.attemptCount, 1);

    const attempt2 = createTaskAttempt(t.db, task.id);
    assert.equal(attempt2.attemptNumber, 2);
    assert.equal(getTask(t.db, task.id)?.attemptCount, 2);

    assert.equal(listTaskAttempts(t.db, task.id).length, 2);
    t.close();
  });

  test("createTaskAttempt on a non-existent task rolls back and throws (no orphaned attemptCount bump)", () => {
    const t = createTestDb();
    assert.throws(() => createTaskAttempt(t.db, "nonexistent-task"));
    t.close();
  });
});

describe("agent run persistence", () => {
  test("createAgentRunForAttempt links the run back to the attempt (circular FK) atomically", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Run tests" });
    const attempt = createTaskAttempt(t.db, task.id);

    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "qa-agent", provider: "simulated" });
    assert.equal(run.status, "QUEUED");
    assert.equal(run.taskAttemptId, attempt.id);

    const reloadedAttempt = t.db.prepare("SELECT agentRunId FROM task_attempts WHERE id = ?").get(attempt.id) as {
      agentRunId: string;
    };
    assert.equal(reloadedAttempt.agentRunId, run.id);

    const updated = updateAgentRunStatus(t.db, run.id, "SUCCEEDED", Date.now());
    assert.equal(updated.status, "SUCCEEDED");
    assert.ok(updated.finishedAt);
    t.close();
  });
});

describe("execution lease fields (Durable Runner persistence primitives)", () => {
  test("claimTask atomically claims a PENDING task and sets lease fields", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "x" });

    const claimed = claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-a", leaseDurationMs: 5000 });
    assert.equal(claimed, true);

    const reloaded = getTask(t.db, task.id)!;
    assert.equal(reloaded.leaseOwnerId, "runner-a");
    assert.ok(reloaded.leaseExpiresAt && reloaded.leaseExpiresAt > Date.now());
    t.close();
  });

  test("a second claim attempt on an already-leased, unexpired task fails (no double claim)", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "x" });

    assert.equal(claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-a", leaseDurationMs: 60_000 }), true);
    assert.equal(claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-b", leaseDurationMs: 60_000 }), false);

    assert.equal(getTask(t.db, task.id)?.leaseOwnerId, "runner-a", "the original claim must not be overwritten");
    t.close();
  });

  test("a task whose lease already expired can be reclaimed by a different owner", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "x" });

    assert.equal(claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-a", leaseDurationMs: -1 }), true); // already-expired lease
    assert.equal(claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-b", leaseDurationMs: 60_000 }), true);
    assert.equal(getTask(t.db, task.id)?.leaseOwnerId, "runner-b");
    t.close();
  });

  test("releaseLease clears both lease fields without touching status", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "x" });
    claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-a", leaseDurationMs: 60_000 });

    const released = releaseLease(t.db, task.id);
    assert.equal(released.leaseOwnerId, null);
    assert.equal(released.leaseExpiresAt, null);
    assert.equal(released.status, "PENDING");
    t.close();
  });

  test("a task claimed but not PENDING (e.g. already DONE) cannot be claimed", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "x" });
    t.db.prepare("UPDATE tasks SET status = 'DONE' WHERE id = ?").run(task.id);

    assert.equal(claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-a", leaseDurationMs: 60_000 }), false);
    t.close();
  });

  test("findStaleLeasedTasks finds only tasks with an already-expired lease", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const staleTask = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "stale" });
    const freshTask = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "fresh" });

    claimTask(t.db, { taskId: staleTask.id, leaseOwnerId: "runner-a", leaseDurationMs: -1 });
    claimTask(t.db, { taskId: freshTask.id, leaseOwnerId: "runner-a", leaseDurationMs: 60_000 });

    const stale = findStaleLeasedTasks(t.db);
    assert.deepEqual(
      stale.map((r) => r.id),
      [staleTask.id],
    );
    t.close();
  });
});

describe("events + audit log", () => {
  test("recordEvent stores an activity-feed row with a JSON payload", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    recordEvent(t.db, { projectId: project.id, type: "task.status_changed", payload: { from: "PENDING", to: "DONE" }, actor: "system" });
    const events = listEventsForProject(t.db, project.id);
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0].payload), { from: "PENDING", to: "DONE" });
    t.close();
  });

  test("recordAuditEntry stores a curated security/budget-relevant action, separate from messages_events", () => {
    const t = createTestDb();
    recordAuditEntry(t.db, { actor: "owner", action: "login", targetType: "user", targetId: "self" });
    const entries = listAuditEntries(t.db);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "login");
    t.close();
  });

  test("no secret-shaped fields exist in the audit/event payload shape used by tests", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    // Fixture proves the API shape doesn't require or accept a secret field —
    // this is a structural guard, not a runtime scanner.
    const event = recordEvent(t.db, { projectId: project.id, type: "office.opened", payload: { reason: "manual" }, actor: "owner" });
    assert.ok(!("secret" in JSON.parse(event.payload)));
    assert.ok(!("passwordHash" in JSON.parse(event.payload)));
    t.close();
  });
});

describe("decisions, artifacts, test results, failures", () => {
  test("recordDecision stores a decision or assumption", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    recordDecision(t.db, { projectId: project.id, type: "assumption", summary: "Assume web app, not native", madeBy: "product-owner" });
    assert.equal(listDecisionsForProject(t.db, project.id).length, 1);
    t.close();
  });

  test("createArtifact stores versioned content per project/task", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    const artifact = createArtifact(t.db, { projectId: project.id, taskId: task.id, type: "requirements", content: "# Requirements\n..." });
    assert.equal(artifact.version, 1);
    assert.equal(listArtifactsForProject(t.db, project.id).length, 1);
    t.close();
  });

  test("an invalid artifact type is rejected by the CHECK constraint", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    assert.throws(() => {
      createArtifact(t.db, { projectId: project.id, type: "not-a-real-type" as never, content: "x" });
    });
    t.close();
  });

  test("recordTestResult stores PASS/FAIL with an optional JSON details blob (synthetic — no real test runner exists yet)", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Run tests" });
    recordTestResult(t.db, { projectId: project.id, taskId: task.id, status: "FAIL", summary: "2 failures", details: { failedCases: ["a", "b"] } });
    const results = listTestResultsForTask(t.db, task.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "FAIL");
    t.close();
  });

  test("recordFailure / resolveFailure / listUnresolvedFailures round-trip correctly", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Run tests" });
    const failure = recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: "assertion error" });
    assert.equal(failure.resolved, 0);
    assert.equal(listUnresolvedFailures(t.db, project.id).length, 1);

    const resolved = resolveFailure(t.db, failure.id);
    assert.equal(resolved.resolved, 1);
    assert.equal(listUnresolvedFailures(t.db, project.id).length, 0);
    t.close();
  });
});

describe("approvals: pending / approve / reject", () => {
  test("a new approval starts PENDING", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const approval = createApproval(t.db, { projectId: project.id, kind: "budget_increase", requestedBy: "orchestrator", context: { reason: "test" } });
    assert.equal(approval.status, "PENDING");
    assert.equal(approval.decidedAt, null);
    assert.equal(listPendingApprovals(t.db).length, 1);
    t.close();
  });

  test("decideApproval(APPROVED) sets status and decidedAt, and removes it from the pending list", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const approval = createApproval(t.db, { projectId: project.id, kind: "budget_increase", requestedBy: "orchestrator", context: {} });
    const decided = decideApproval(t.db, approval.id, "APPROVED");
    assert.equal(decided.status, "APPROVED");
    assert.ok(decided.decidedAt);
    assert.equal(listPendingApprovals(t.db).length, 0);
    t.close();
  });

  test("decideApproval(REJECTED) sets status to REJECTED", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const approval = createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "orchestrator", context: {} });
    const decided = decideApproval(t.db, approval.id, "REJECTED");
    assert.equal(decided.status, "REJECTED");
    t.close();
  });

  test("an already-decided approval cannot be re-decided (the guard is WHERE status = 'PENDING')", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const approval = createApproval(t.db, { projectId: project.id, kind: "budget_increase", requestedBy: "orchestrator", context: {} });
    decideApproval(t.db, approval.id, "APPROVED");
    const secondAttempt = decideApproval(t.db, approval.id, "REJECTED");
    assert.equal(secondAttempt.status, "APPROVED", "the first decision must stick");
    t.close();
  });

  test("an invalid approval kind is rejected by the CHECK constraint", () => {
    const t = createTestDb();
    assert.throws(() => {
      createApproval(t.db, { kind: "not_a_real_kind" as never, requestedBy: "orchestrator", context: {} });
    });
    t.close();
  });
});

describe("budget records + AI usage (synthetic only — no live provider calls)", () => {
  test("the seeded office budget record defaults to a $30 cap", () => {
    const t = createTestDb();
    const record = getLatestOfficeBudgetRecord(t.db);
    assert.equal(record?.capUsd, 30);
    assert.equal(record?.scope, "office");
    t.close();
  });

  test("recordAiUsage stores synthetic token/cost rows and sums correctly per project", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "x" });
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "qa-agent", provider: "simulated" });

    recordAiUsage(t.db, { agentRunId: run.id, projectId: project.id, provider: "simulated", inputTokens: 100, outputTokens: 50, costUsd: 0 });
    recordAiUsage(t.db, { agentRunId: run.id, projectId: project.id, provider: "simulated", inputTokens: 20, outputTokens: 10, costUsd: 0 });

    assert.equal(listAiUsageForProject(t.db, project.id).length, 2);
    assert.equal(sumAiUsageCostForProject(t.db, project.id), 0, "simulated usage always costs $0");
    t.close();
  });
});

describe("timestamps / state transitions", () => {
  test("createdAt stays fixed while updatedAt advances across a status transition", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "x" });
    const createdAt = task.createdAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    t.db.prepare("UPDATE tasks SET status = 'IN_PROGRESS', updatedAt = ? WHERE id = ?").run(Date.now(), task.id);

    const reloaded = getTask(t.db, task.id)!;
    assert.equal(reloaded.createdAt, createdAt);
    assert.ok(reloaded.updatedAt >= createdAt);
    t.close();
  });
});
