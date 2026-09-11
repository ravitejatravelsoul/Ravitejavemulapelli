import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { createTask, createTaskWithDependencies, getTask, listTaskAttempts, getAgentRun } from "../../domain/tasks.ts";
import { listArtifactsForProject, listDecisionsForProject, listTestResultsForTask, listUnresolvedFailures } from "../../domain/project-outputs.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { listAiUsageForProject } from "../../domain/budget.ts";
import { getProjectMemory } from "../../domain/project-memory.ts";
import { executeTask } from "../agent-runner.ts";

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

/**
 * Lowers an already-seeded, already-fixture-backed role's maxRetries so
 * escalation tests don't need to burn through the real default of 3 —
 * a real role id is reused (rather than inventing a fake one) so the
 * real SimulatedAdapter fixtures still resolve; only this test DB's
 * copy of the row is touched, never the shipped catalog.
 */
function lowerMaxRetries(t: ReturnType<typeof createTestDb>, roleId: string, maxRetries: number) {
  t.db.prepare("UPDATE agent_roles SET maxRetries = ? WHERE id = ?").run(maxRetries, roleId);
}

describe("successful execution", () => {
  test("executeTask persists TaskAttempt, AgentRun, artifact, event, and $0 AI usage, and marks the task DONE", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });

    const result = await executeTask(t.db, task.id, { scenario: "success" });

    assert.equal(result.outcome, "succeeded");
    assert.equal(result.task.status, "DONE");
    assert.equal(result.taskAttempt?.status, "SUCCEEDED");
    assert.equal(result.agentRun?.status, "SUCCEEDED");

    const attempts = listTaskAttempts(t.db, task.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].attemptNumber, 1);

    const agentRun = getAgentRun(t.db, attempts[0].agentRunId!);
    assert.equal(agentRun?.status, "SUCCEEDED");
    assert.equal(agentRun?.provider, "simulated");

    const artifacts = listArtifactsForProject(t.db, project.id);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].type, "requirements");
    assert.equal(artifacts[0].taskId, task.id);

    const decisions = listDecisionsForProject(t.db, project.id);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].type, "assumption");

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "agent_run.succeeded"));

    const usage = listAiUsageForProject(t.db, project.id);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].costUsd, 0);

    t.close();
  });

  test("no duplicate artifact/event writes on a single attempt", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });

    await executeTask(t.db, task.id, { scenario: "success" });

    // product-owner's success fixture produces exactly 1 artifact + 1 decision.
    assert.equal(listArtifactsForProject(t.db, project.id).length, 1);
    assert.equal(listDecisionsForProject(t.db, project.id).length, 1);
    // exactly one "agent_run.succeeded" event, not duplicated
    const succeededEvents = listEventsForProject(t.db, project.id).filter((e) => e.type === "agent_run.succeeded");
    assert.equal(succeededEvents.length, 1);

    t.close();
  });

  test("project-memory is refreshed after a successful run", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });

    assert.equal(getProjectMemory(t.db, project.id), undefined, "no memory cache row before any task runs");
    await executeTask(t.db, task.id, { scenario: "success" });

    const memory = getProjectMemory(t.db, project.id);
    assert.ok(memory);
    assert.match(memory!.summary, /1\/1 tasks complete/);

    t.close();
  });
});

describe("failed execution / retry", () => {
  test("a retryable failure increments attemptCount, persists the failure reason, and returns the task to PENDING", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });

    const result = await executeTask(t.db, task.id, { scenario: "failure" });

    assert.equal(result.outcome, "retried");
    assert.equal(result.task.status, "PENDING");
    assert.equal(getTask(t.db, task.id)?.attemptCount, 1);

    const failures = listUnresolvedFailures(t.db, project.id);
    assert.equal(failures.length, 1);
    assert.match(failures[0].reason, /conflict/);

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "agent_run.failed"));

    t.close();
  });

  test("retrying a task after a failure bumps attemptCount again (retry-success scenario)", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement tool" });

    const first = await executeTask(t.db, task.id, { scenario: "failure" });
    assert.equal(first.outcome, "retried");
    assert.equal(getTask(t.db, task.id)?.status, "PENDING");

    const second = await executeTask(t.db, task.id, { scenario: "retry-success" });
    assert.equal(second.outcome, "succeeded");
    assert.equal(getTask(t.db, task.id)?.attemptCount, 2);
    assert.equal(listTaskAttempts(t.db, task.id).length, 2);

    const artifacts = listArtifactsForProject(t.db, project.id);
    assert.equal(artifacts.length, 1);
    assert.match(artifacts[0].content, /fix/i);

    t.close();
  });

  test("retry ceiling stops further attempts and escalates — task BLOCKED, project BLOCKED, agent run ESCALATED", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    lowerMaxRetries(t, "solution-architect", 1);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Do something risky" });

    // maxRetries=1: attempt 1 fails -> 1 <= 1 -> retry. attempt 2 fails -> 2 <= 1 false -> escalate.
    const first = await executeTask(t.db, task.id, { scenario: "failure" });
    assert.equal(first.outcome, "retried");

    const second = await executeTask(t.db, task.id, { scenario: "failure" });
    assert.equal(second.outcome, "escalated");
    assert.equal(second.task.status, "BLOCKED");
    assert.equal(second.agentRun?.status, "ESCALATED");
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    const events = listEventsForProject(t.db, project.id);
    const escalationEvent = events.find((e) => e.type === "task.escalated");
    assert.ok(escalationEvent);
    assert.deepEqual(JSON.parse(escalationEvent!.payload).escalatesTo, "orchestrator");

    t.close();
  });

  test("no infinite loop: a BLOCKED (escalated) task cannot be executed again", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    lowerMaxRetries(t, "solution-architect", 1);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Do something risky" });

    await executeTask(t.db, task.id, { scenario: "failure" });
    await executeTask(t.db, task.id, { scenario: "failure" }); // escalates
    assert.equal(getTask(t.db, task.id)?.status, "BLOCKED");

    const attemptCountBefore = getTask(t.db, task.id)!.attemptCount;
    const thirdCall = await executeTask(t.db, task.id, { scenario: "success" });
    assert.equal(thirdCall.outcome, "not-eligible");
    assert.equal(getTask(t.db, task.id)?.attemptCount, attemptCountBefore, "a not-eligible call must not create a new attempt");

    t.close();
  });

  test("a DONE task cannot be re-executed", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });
    await executeTask(t.db, task.id, { scenario: "success" });

    const again = await executeTask(t.db, task.id, { scenario: "success" });
    assert.equal(again.outcome, "not-eligible");
    t.close();
  });
});

describe("review-role failure reopens the dependency, not itself (QA -> Developer)", () => {
  test("QA failure creates a failure record against the developer task and reopens the developer task, not QA's own", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const { task: devTask } = createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "backend-developer",
      title: "Implement tool",
    });
    await executeTask(t.db, devTask.id, { scenario: "success" });
    assert.equal(getTask(t.db, devTask.id)?.status, "DONE");

    const { task: qaTask } = createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "qa-agent",
      title: "Run tests",
      dependsOnTaskIds: [devTask.id],
    });

    const result = await executeTask(t.db, qaTask.id, { scenario: "failure" });
    assert.equal(result.outcome, "retried");
    assert.equal(getTask(t.db, qaTask.id)?.status, "PENDING", "QA's own task also becomes eligible to re-run");
    assert.equal(getTask(t.db, devTask.id)?.status, "PENDING", "the developer task is reopened, not left DONE");

    const failures = listUnresolvedFailures(t.db, project.id);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].taskId, devTask.id, "the failure is tracked against the developer's task, not QA's");

    const testResults = listTestResultsForTask(t.db, qaTask.id);
    assert.equal(testResults.length, 1);
    assert.equal(testResults[0].status, "FAIL");

    t.close();
  });
});

describe("budget gate (SIMULATED always authorized, LIVE refused — no adapter exists yet)", () => {
  test("a SIMULATED-mode project's task executes normally", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    assert.equal(project.aiMode, "SIMULATED");
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });
    const result = await executeTask(t.db, task.id, { scenario: "success" });
    assert.equal(result.outcome, "succeeded");
    t.close();
  });

  test("a LIVE-mode project's task is refused before any attempt/run is created", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Live mode project",
      rawIdeaText: "x",
      ownerId: owner.id,
      aiMode: "LIVE",
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });

    const result = await executeTask(t.db, task.id, { scenario: "success" });
    assert.equal(result.outcome, "budget-refused");
    assert.equal(getTask(t.db, task.id)?.attemptCount, 0, "no attempt should be created for a refused run");
    assert.equal(listTaskAttempts(t.db, task.id).length, 0);

    t.close();
  });
});

describe("execution timeout — a hung provider call cannot stall the office forever", () => {
  /** Never resolves — the standard shape of a hung/misbehaving provider call. */
  const hangingAdapter = {
    name: "simulated",
    runAgentTask(): Promise<import("../../providers/types.ts").AgentTaskResult> {
      return new Promise(() => {});
    },
    estimateCost() {
      return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
    },
  };

  test("a hanging adapter call is abandoned at the configured timeout and treated as a retryable failure", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "x" });

    const result = await executeTask(t.db, task.id, { provider: hangingAdapter, timeoutMs: 20 });

    assert.equal(result.outcome, "retried");
    assert.equal(result.task.status, "PENDING");
    assert.match(result.reason ?? "", /timed out/i);

    // No dangling RUNNING agent run — the timeout is treated as a
    // normal terminal failure, going through the exact same
    // transaction as any other failed attempt.
    const attempts = listTaskAttempts(t.db, task.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, "FAILED");
    const agentRun = getAgentRun(t.db, attempts[0].agentRunId!);
    assert.equal(agentRun?.status, "FAILED");

    t.close();
  });

  test("repeated timeouts exhaust the retry ceiling and escalate, exactly like any other repeated failure", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    lowerMaxRetries(t, "solution-architect", 1);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "x" });

    const first = await executeTask(t.db, task.id, { provider: hangingAdapter, timeoutMs: 20 });
    assert.equal(first.outcome, "retried");

    const second = await executeTask(t.db, task.id, { provider: hangingAdapter, timeoutMs: 20 });
    assert.equal(second.outcome, "escalated");
    assert.equal(second.task.status, "BLOCKED");
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    t.close();
  });

  test("$0 usage is still recorded for a timed-out attempt — no cost for work that never returned", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "x" });

    await executeTask(t.db, task.id, { provider: hangingAdapter, timeoutMs: 20 });

    const usage = listAiUsageForProject(t.db, project.id);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].costUsd, 0);

    t.close();
  });
});

describe("provider execution exceptions — converted to a controlled failure, never escape executeTask()", () => {
  const throwingAdapter = {
    name: "simulated",
    runAgentTask(): Promise<import("../../providers/types.ts").AgentTaskResult> {
      throw new Error("simulated adapter crash — synchronous throw");
    },
    estimateCost() {
      return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
    },
  };

  const rejectingAdapter = {
    name: "simulated",
    runAgentTask(): Promise<import("../../providers/types.ts").AgentTaskResult> {
      return Promise.reject(new Error("simulated network error — rejected promise"));
    },
    estimateCost() {
      return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
    },
  };

  test("a synchronously-throwing adapter does not escape executeTask() — it is treated as a retryable failure, same as any other", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "x" });

    const result = await executeTask(t.db, task.id, { provider: throwingAdapter });

    assert.equal(result.outcome, "retried");
    assert.equal(result.task.status, "PENDING");
    assert.match(result.reason ?? "", /simulated adapter crash/);

    const attempts = listTaskAttempts(t.db, task.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, "FAILED", "no dangling RUNNING attempt from an adapter that threw");
    const agentRun = getAgentRun(t.db, attempts[0].agentRunId!);
    assert.equal(agentRun?.status, "FAILED");

    t.close();
  });

  test("a rejecting-promise adapter (network/SDK-style error) is treated identically", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "x" });

    const result = await executeTask(t.db, task.id, { provider: rejectingAdapter });

    assert.equal(result.outcome, "retried");
    assert.match(result.reason ?? "", /simulated network error/);

    t.close();
  });

  test("repeated provider exceptions exhaust the retry ceiling and escalate, exactly like any other repeated failure", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    lowerMaxRetries(t, "solution-architect", 1);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "x" });

    const first = await executeTask(t.db, task.id, { provider: throwingAdapter });
    assert.equal(first.outcome, "retried");

    const second = await executeTask(t.db, task.id, { provider: throwingAdapter });
    assert.equal(second.outcome, "escalated");
    assert.equal(second.task.status, "BLOCKED");
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    t.close();
  });

  test("$0 usage is still recorded when the provider throws — no cost for work that never returned a result", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "x" });

    await executeTask(t.db, task.id, { provider: throwingAdapter });

    const usage = listAiUsageForProject(t.db, project.id);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].costUsd, 0);

    t.close();
  });
});

describe("context scoping", () => {
  test("QA's context includes requirements + code artifacts but not architecture (not in qa-agent's allowedInputs)", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);

    const poTask = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    await executeTask(t.db, poTask.id, { scenario: "success" });
    const archTask = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Architecture" });
    await executeTask(t.db, archTask.id, { scenario: "success" });
    const devTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement" });
    await executeTask(t.db, devTask.id, { scenario: "success" });

    const qaTask = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test" });

    // Capture the context actually built for QA via a scenario-aware adapter spy.
    let capturedTypes: string[] = [];
    const spyAdapter = {
      name: "simulated",
      async runAgentTask(input: import("../../providers/types.ts").AgentTaskInput) {
        capturedTypes = input.task.relevantArtifacts.map((a) => a.type);
        const { SimulatedAdapter } = await import("../../providers/simulated/simulated-adapter.ts");
        return new SimulatedAdapter().runAgentTask(input);
      },
      estimateCost() {
        return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
      },
    };

    await executeTask(t.db, qaTask.id, { scenario: "success", provider: spyAdapter });

    assert.ok(capturedTypes.includes("requirements"));
    assert.ok(capturedTypes.includes("code"));
    assert.ok(!capturedTypes.includes("architecture"), "QA is not allowed architecture per its allowedInputs");

    t.close();
  });

  test("Research Agent's context never includes code artifacts, and the context object has no budget/credential-shaped fields", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const devTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement" });
    await executeTask(t.db, devTask.id, { scenario: "success" });

    const researchTask = createTask(t.db, { projectId: project.id, roleId: "research-agent", title: "Research" });

    let capturedContext: import("../../providers/types.ts").TaskContext | undefined;
    const spyAdapter = {
      name: "simulated",
      async runAgentTask(input: import("../../providers/types.ts").AgentTaskInput) {
        capturedContext = input.task;
        const { SimulatedAdapter } = await import("../../providers/simulated/simulated-adapter.ts");
        return new SimulatedAdapter().runAgentTask(input);
      },
      estimateCost() {
        return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
      },
    };
    await executeTask(t.db, researchTask.id, { scenario: "success", provider: spyAdapter });

    assert.ok(capturedContext);
    assert.ok(!capturedContext!.relevantArtifacts.some((a) => a.type === "code"));
    assert.ok(!("budgetRecords" in capturedContext!));
    assert.ok(!("passwordHash" in capturedContext!));
    assert.ok(!("users" in capturedContext!));

    t.close();
  });
});
