import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles, readFile } from "../../workspace/workspace-service.ts";
import { listWorkspaceFileRecords, getWorkspace, setDeliveryState } from "../../domain/workspace.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { createTask, createTaskWithDependencies, getTask, listTaskAttempts, getAgentRun, updateTaskStatus } from "../../domain/tasks.ts";
import { listArtifactsForProject, listDecisionsForProject, listTestResultsForTask, listUnresolvedFailures, recordFailure } from "../../domain/project-outputs.ts";
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

/** Isolates a real, temporary workspace root for the duration of `fn` — shared by every describe block that needs a real filesystem-backed workspace. */
async function withWorkspace<T>(fn: () => Promise<T>): Promise<T> {
  const priorRoot = process.env.AI_OFFICE_WORKSPACES_ROOT;
  const workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-agent-runner-workspace-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
  try {
    return await fn();
  } finally {
    if (priorRoot === undefined) delete process.env.AI_OFFICE_WORKSPACES_ROOT;
    else process.env.AI_OFFICE_WORKSPACES_ROOT = priorRoot;
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
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

describe("provider selection — a project's own `provider` column picks the default adapter", () => {
  test("a 'simulated'-provider project (the default) uses SimulatedAdapter when no adapter is injected", async () => {
    const t = createTestDb();
    const { project } = setupProject(t); // provider defaults to "simulated"
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });

    const result = await executeTask(t.db, task.id, { scenario: "success" });

    assert.equal(result.outcome, "succeeded");
    const attempt = listTaskAttempts(t.db, task.id)[0];
    const run = getAgentRun(t.db, attempt.agentRunId!);
    assert.equal(run?.provider, "simulated");

    t.close();
  });

  test("an 'ollama'-provider project uses OllamaAdapter by default — proven by pointing OLLAMA_BASE_URL at an address nothing listens on and observing the resulting failure carries provider 'ollama', never a silent fallback to 'simulated'", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Todo app",
      rawIdeaText: "Build a one-page todo application.",
      ownerId: owner.id,
      provider: "ollama",
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });

    const prevBaseUrl = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1"; // reserved, nothing listens here
    process.env.OLLAMA_TIMEOUT_MS = "500";
    try {
      const result = await executeTask(t.db, task.id, {});
      // No options.provider was passed — executeTask had to pick the
      // adapter itself from project.provider === "ollama".
      assert.equal(result.outcome, "retried", "a connection failure is a normal retryable failure, not a crash");
      assert.equal(getTask(t.db, task.id)?.status, "PENDING", "the task remains retryable — no lost task, no infinite retry loop here");

      const attempt = listTaskAttempts(t.db, task.id)[0];
      const run = getAgentRun(t.db, attempt.agentRunId!);
      assert.equal(run?.provider, "ollama", "the run must be attributed to ollama, never silently recorded as simulated or any other provider");

      const failures = listUnresolvedFailures(t.db, project.id);
      assert.match(failures[0].reason, /Ollama|ECONNREFUSED|reach/i);
    } finally {
      if (prevBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = prevBaseUrl;
      delete process.env.OLLAMA_TIMEOUT_MS;
      t.close();
    }
  });

  test("an explicitly injected options.provider always overrides the project's own provider column (test-injection escape hatch, unchanged from before Ollama existed)", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Todo app",
      rawIdeaText: "Build a one-page todo application.",
      ownerId: owner.id,
      provider: "ollama",
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });

    const { SimulatedAdapter } = await import("../../providers/simulated/simulated-adapter.ts");
    const result = await executeTask(t.db, task.id, { scenario: "success", provider: new SimulatedAdapter() });

    assert.equal(result.outcome, "succeeded");
    const attempt = listTaskAttempts(t.db, task.id)[0];
    const run = getAgentRun(t.db, attempt.agentRunId!);
    assert.equal(run?.provider, "simulated");

    t.close();
  });
});

describe("real file materialization (Phase 8)", () => {
  test("a successful frontend-developer attempt writes real files to disk and records attribution, driven entirely through executeTask() — no test-only file-writing shortcut", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const result = await executeTask(t.db, task.id, { scenario: "success" });
      assert.equal(result.outcome, "succeeded");

      assert.deepEqual((await listFiles(project.id)).sort(), ["index.html", "script.js", "styles.css"]);
      assert.match(await readFile(project.id, "index.html"), /<h1>/i);

      const records = listWorkspaceFileRecords(t.db, project.id);
      assert.equal(records.length, 3);
      const indexRecord = records.find((r) => r.path === "index.html")!;
      assert.equal(indexRecord.lastModifiedByRoleId, "frontend-developer");
      assert.equal(indexRecord.lastModifiedByTaskId, task.id);

      t.close();
    });
  });

  test("a backend-developer attempt succeeds normally and writes no files at all — a static page has no backend", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });

      const result = await executeTask(t.db, task.id, { scenario: "success" });
      assert.equal(result.outcome, "succeeded");
      assert.deepEqual(await listFiles(project.id), []);

      t.close();
    });
  });

  test("attempt-based scenario default: a real second attempt (no explicit scenario override) naturally rewrites script.js with the fix, exactly matching the real bug-then-fix cycle QA/remediation drives", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      // Attempt 1 — no scenario passed at all (this is what the real
      // runner always does outside a test). Must resolve to the buggy
      // "success" fixture by default.
      const first = await executeTask(t.db, task.id);
      assert.equal(first.outcome, "succeeded");
      assert.match(await readFile(project.id, "script.js"), /getElementById\("greeting"\)/);

      // Simulate this task becoming eligible again exactly the way real
      // remediation would (a downstream QA failure reopens it) — without
      // depending on QA's real-browser-verification work (Phase 8's next
      // commit) to exercise this specific mechanism in isolation.
      updateTaskStatus(t.db, task.id, "PENDING");

      // Attempt 2 — again, no scenario passed. attemptCount is already 1
      // from the first real attempt, so this must resolve to
      // "retry-success" purely from that real state, not a test override.
      const second = await executeTask(t.db, task.id);
      assert.equal(second.outcome, "succeeded");
      assert.match(await readFile(project.id, "script.js"), /getElementById\("message"\)/);
      assert.doesNotMatch(await readFile(project.id, "script.js"), /getElementById\("greeting"\)/);

      t.close();
    });
  });

  test("an invalid file operation (a path that escapes the workspace) fails the task cleanly through the existing retry path — no exception escapes executeTask(), and no file is written", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const maliciousAdapter = {
        name: "simulated",
        async runAgentTask() {
          return {
            status: "SUCCEEDED" as const,
            output: {
              summary: "ok",
              artifacts: [],
              decisions: [],
              testResults: [],
              events: [],
              fileOperations: [{ kind: "file-operation" as const, action: "write" as const, path: "../escape.txt", content: "bad" }],
              recommendedNextActions: [],
            },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };

      const result = await executeTask(t.db, task.id, { provider: maliciousAdapter });
      assert.equal(result.outcome, "retried", "an invalid file operation is a normal retryable failure, not a crash");
      assert.equal(getTask(t.db, task.id)?.status, "PENDING");
      assert.deepEqual(await listFiles(project.id), []);

      const failures = listUnresolvedFailures(t.db, project.id);
      assert.match(failures[0]!.reason, /File operation rejected/);

      t.close();
    });
  });

  test("qa-agent's real browser check PASSes against real correct files and marks the workspace VERIFIED", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      // Attempt 1 writes all three files (deliberately buggy script.js);
      // attempt 2's "retry-success" fixture rewrites only script.js with
      // the fix — matching the real two-attempt shape exactly, since
      // "retry-success" alone would never have written index.html/styles.css.
      await executeTask(t.db, devTask.id, { scenario: "success" });
      updateTaskStatus(t.db, devTask.id, "PENDING");
      await executeTask(t.db, devTask.id, { scenario: "retry-success" });

      const { task: qaTask } = createTaskWithDependencies(t.db, {
        projectId: project.id,
        roleId: "qa-agent",
        title: "Test",
        dependsOnTaskIds: [devTask.id],
      });
      const result = await executeTask(t.db, qaTask.id, { scenario: "success" });

      assert.equal(result.outcome, "succeeded");
      const testResults = listTestResultsForTask(t.db, qaTask.id);
      assert.equal(testResults.length, 1);
      assert.equal(testResults[0]!.status, "PASS");
      assert.ok(testResults[0]!.durationMs !== null, "a real verification must record a real duration");
      assert.match(testResults[0]!.targetUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
      assert.equal(getWorkspace(t.db, project.id)?.deliveryState, "VERIFIED");

      t.close();
    });
  });

  test("qa-agent's real browser check FAILs against the real deliberate bug, retries the frontend-developer task, and marks the workspace FAILED", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      await executeTask(t.db, devTask.id, { scenario: "success" }); // attempt 1 — deliberately buggy

      const { task: qaTask } = createTaskWithDependencies(t.db, {
        projectId: project.id,
        roleId: "qa-agent",
        title: "Test",
        dependsOnTaskIds: [devTask.id],
      });
      const result = await executeTask(t.db, qaTask.id, { scenario: "success" });

      assert.equal(result.outcome, "retried", "a real QA failure is a normal retryable failure, exactly like a fixture failure");
      assert.equal(getTask(t.db, devTask.id)?.status, "PENDING", "the real remediation target — the developer task — must be reopened");
      const testResults = listTestResultsForTask(t.db, qaTask.id);
      assert.equal(testResults[0]!.status, "FAIL");
      assert.match(testResults[0]!.summary, /did not change/i);
      assert.equal(getWorkspace(t.db, project.id)?.deliveryState, "FAILED");

      t.close();
    });
  });

  test("legacy/pure-text projects with no workspace are completely unaffected by the real QA override — the adapter's own fixture testResults still stand", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const devTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    await executeTask(t.db, devTask.id, { scenario: "success" });

    const qaTask = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test" });
    const result = await executeTask(t.db, qaTask.id, { scenario: "success" });

    assert.equal(result.outcome, "succeeded");
    const testResults = listTestResultsForTask(t.db, qaTask.id);
    assert.equal(testResults[0]!.durationMs, null, "an ordinary fixture test result carries no real verification evidence");
    assert.equal(getWorkspace(t.db, project.id), undefined, "no workspace row should ever be created for a project that never wrote a real file");

    t.close();
  });
});

describe("development deliverable contract (local multi-model routing follow-up)", () => {
  function setupOllamaDevProject(t: ReturnType<typeof createTestDb>) {
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Deliverable contract test",
      rawIdeaText: "Create a simple Hello World webpage with a heading, description and a button.",
      ownerId: owner.id,
      provider: "ollama",
    });
    return project;
  }

  const fastFetch = (async () =>
    ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: true, reason: "ok" }) }) }) as unknown as Response) as unknown as typeof fetch;

  /** Reproduces the exact real-acceptance-run failure mode: SUCCEEDED, a real `code` artifact containing correct implementation content, but zero fileOperations. */
  function codeArtifactNoFileOpsAdapter() {
    return {
      name: "ollama",
      async runAgentTask() {
        return {
          status: "SUCCEEDED" as const,
          output: {
            summary: "Implemented the page.",
            artifacts: [{ kind: "artifact" as const, artifactType: "code", content: "<!doctype html><html><body><h1>Hello, World!</h1></body></html>" }],
            decisions: [],
            testResults: [],
            events: [],
            fileOperations: [],
            recommendedNextActions: [],
          },
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        };
      },
      estimateCost() {
        return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
      },
    };
  }

  test("SUCCEEDED + code artifact + zero fileOperations on an implementation task is converted to a semantic FAILED result, never silently marked DONE", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const result = await executeTask(t.db, task.id, { provider: codeArtifactNoFileOpsAdapter(), intentCheckFetch: fastFetch });

      assert.equal(result.outcome, "retried", "a real, bounded retry — not a permanently blocked task, not a silent DONE");
      assert.equal(getTask(t.db, task.id)?.status, "PENDING");
      const failures = listUnresolvedFailures(t.db, project.id);
      assert.ok(failures.some((f) => f.taskId === task.id && /did not provide any file operations/.test(f.reason)));
      assert.deepEqual(await listFiles(project.id), [], "a code artifact alone must never count as a materialized deliverable");
      assert.equal(getWorkspace(t.db, project.id), undefined, "no workspace should ever be created from artifact text alone");

      t.close();
    });
  });

  test("the zero-fileOperations failure is classified SEMANTIC, not operational — it must consume real retry budget, unlike a timeout/malformed-JSON hiccup", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id, { provider: codeArtifactNoFileOpsAdapter(), intentCheckFetch: fastFetch });

      assert.equal(getTask(t.db, task.id)?.attemptCount, 1, "a real semantic failure consumes one real attempt, exactly like any other bad implementation");
      t.close();
    });
  });

  test("zero fileOperations triggers a normal retry that succeeds once real file operations are supplied", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const first = await executeTask(t.db, task.id, { provider: codeArtifactNoFileOpsAdapter(), intentCheckFetch: fastFetch });
      assert.equal(first.outcome, "retried");

      const fixedAdapter = {
        name: "ollama",
        async runAgentTask() {
          return {
            status: "SUCCEEDED" as const,
            output: {
              summary: "Implemented the page.",
              artifacts: [],
              decisions: [],
              testResults: [],
              events: [],
              fileOperations: [{ kind: "file-operation" as const, action: "write" as const, path: "index.html", content: "<h1>Hello, World!</h1>" }],
              recommendedNextActions: [],
            },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };

      const second = await executeTask(t.db, task.id, { provider: fixedAdapter, intentCheckFetch: fastFetch });
      assert.equal(second.outcome, "succeeded");
      assert.deepEqual(await listFiles(project.id), ["index.html"]);

      t.close();
    });
  });

  test("zero fileOperations on a real-routing attempt escalates to a different local model on the semantic retry", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const codeArtifactOnlyFetch = (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            response: JSON.stringify({
              summary: "Implemented the page.",
              artifacts: [{ kind: "artifact", artifactType: "code", content: "<h1>Hello, World!</h1>" }],
              decisions: [],
              testResults: [],
              events: [],
              fileOperations: [],
              recommendedNextActions: [],
            }),
          }),
        }) as unknown as Response) as unknown as typeof fetch;
      const realFileOpFetch = (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            response: JSON.stringify({
              summary: "Implemented the page.",
              artifacts: [],
              decisions: [],
              testResults: [],
              events: [],
              fileOperations: [{ kind: "file-operation", action: "write", path: "index.html", content: "<h1>Hello, World!</h1>" }],
              recommendedNextActions: [],
            }),
          }),
        }) as unknown as Response) as unknown as typeof fetch;

      const first = await executeTask(t.db, task.id, {
        availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
        ollamaFetchImpl: codeArtifactOnlyFetch,
        intentCheckFetch: fastFetch,
      });
      assert.equal(first.outcome, "retried");
      assert.equal(first.agentRun!.model, "gemma4:latest");

      const second = await executeTask(t.db, task.id, {
        availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
        ollamaFetchImpl: realFileOpFetch,
        intentCheckFetch: fastFetch,
      });
      assert.equal(second.outcome, "succeeded");
      assert.equal(second.agentRun!.model, "qwen3.6:latest", "a zero-fileOperations semantic failure must escalate past the model that just produced it");

      t.close();
    });
  });

  test("a legitimate no-write corrective attempt succeeds when the workspace already has real files — not every developer attempt must write a file", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      // Attempt 1: real fileOperations actually create the workspace.
      const firstAdapter = {
        name: "ollama",
        async runAgentTask() {
          return {
            status: "SUCCEEDED" as const,
            output: {
              summary: "Implemented.",
              artifacts: [],
              decisions: [],
              testResults: [],
              events: [],
              fileOperations: [{ kind: "file-operation" as const, action: "write" as const, path: "index.html", content: "<h1>Hello, World!</h1>" }],
              recommendedNextActions: [],
            },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };
      const first = await executeTask(t.db, task.id, { provider: firstAdapter, intentCheckFetch: fastFetch });
      assert.equal(first.outcome, "succeeded");

      // Simulate a later reopening (e.g. a QA/review finding unrelated to
      // the developer's own file) by recording a fresh unresolved failure
      // against this same task and returning it to PENDING, exactly like
      // finishFailure's own remediation-target reopening does.
      recordFailure(t.db, { projectId: project.id, taskId: task.id, agentRunId: first.agentRun!.id, reason: "Unrelated review finding." });
      updateTaskStatus(t.db, task.id, "PENDING");

      // Attempt 2 (corrective): the model determines no further change is
      // needed and returns zero fileOperations — must NOT be blocked,
      // because the workspace already has a real deliverable.
      const noChangeAdapter = {
        name: "ollama",
        async runAgentTask() {
          return {
            status: "SUCCEEDED" as const,
            output: { summary: "No change needed — existing implementation already satisfies the request.", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [] },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };
      const second = await executeTask(t.db, task.id, { provider: noChangeAdapter, intentCheckFetch: fastFetch });
      assert.equal(second.outcome, "succeeded", "a corrective attempt against an already-real deliverable may legitimately need no further write");

      t.close();
    });
  });
});

describe("workspace integrity gate (deliverable integrity gate follow-up)", () => {
  function setupOllamaDevProject(t: ReturnType<typeof createTestDb>) {
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Integrity gate test",
      rawIdeaText: "Create a simple Hello World webpage with a heading, description and a button.",
      ownerId: owner.id,
      provider: "ollama",
    });
    return project;
  }

  const fastFetch = (async () =>
    ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: true, reason: "ok" }) }) }) as unknown as Response) as unknown as typeof fetch;

  function adapterWritingOnly(files: Array<{ path: string; content: string }>) {
    return {
      name: "ollama",
      async runAgentTask() {
        return {
          status: "SUCCEEDED" as const,
          output: {
            summary: "Implemented.",
            artifacts: [],
            decisions: [],
            testResults: [],
            events: [],
            fileOperations: files.map((f) => ({ kind: "file-operation" as const, action: "write" as const, path: f.path, content: f.content })),
            recommendedNextActions: [],
          },
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        };
      },
      estimateCost() {
        return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
      },
    };
  }

  const BROKEN_INDEX = '<!doctype html><html><body><h1>Hello, World!</h1><button id="btn">Click</button><script src="script.js"></script></body></html>';
  const WORKING_INDEX =
    '<!doctype html><html><body><h1>Hello, World!</h1><p id="msg">Hi</p><button id="btn">Click</button><script src="script.js"></script></body></html>';
  const WORKING_SCRIPT = 'document.getElementById("btn").addEventListener("click", () => { document.getElementById("msg").textContent = "Clicked!"; });';

  test("9. a development result that writes index.html referencing a missing script.js is converted to a semantic failure", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const result = await executeTask(t.db, task.id, {
        provider: adapterWritingOnly([{ path: "index.html", content: BROKEN_INDEX }]),
        intentCheckFetch: fastFetch,
      });

      assert.equal(result.outcome, "retried");
      const failures = listUnresolvedFailures(t.db, project.id);
      assert.ok(failures.some((f) => f.taskId === task.id && /index\.html references script\.js/.test(f.reason)));

      t.close();
    });
  });

  test("the integrity failure is classified SEMANTIC, not operational — it consumes real retry budget", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id, {
        provider: adapterWritingOnly([{ path: "index.html", content: BROKEN_INDEX }]),
        intentCheckFetch: fastFetch,
      });

      assert.equal(getTask(t.db, task.id)?.attemptCount, 1, "a real semantic failure consumes exactly one real attempt");
      t.close();
    });
  });

  test("10. the integrity semantic failure reopens the developer task correctly (not some other role)", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id, {
        provider: adapterWritingOnly([{ path: "index.html", content: BROKEN_INDEX }]),
        intentCheckFetch: fastFetch,
      });

      assert.equal(getTask(t.db, task.id)?.status, "PENDING", "the developer's own task is reopened for a real retry");
      t.close();
    });
  });

  test("11. a corrective attempt receives the exact missing-reference failure via RemediationContext", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id, {
        provider: adapterWritingOnly([{ path: "index.html", content: BROKEN_INDEX }]),
        intentCheckFetch: fastFetch,
      });

      let capturedInstructions: import("../../providers/types.ts").TaskContext | undefined;
      const capturingAdapter = {
        name: "ollama",
        async runAgentTask(input: import("../../providers/types.ts").AgentTaskInput) {
          capturedInstructions = input.task;
          return {
            status: "SUCCEEDED" as const,
            output: {
              summary: "Fixed.",
              artifacts: [],
              decisions: [],
              testResults: [],
              events: [],
              fileOperations: [{ kind: "file-operation" as const, action: "write" as const, path: "script.js", content: "console.log('fixed');" }],
              recommendedNextActions: [],
            },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };
      await executeTask(t.db, task.id, { provider: capturingAdapter, intentCheckFetch: fastFetch });

      assert.ok(capturedInstructions?.remediationContext, "the corrective attempt must carry RemediationContext");
      assert.match(
        capturedInstructions!.remediationContext!.failureReason ?? "",
        /index\.html references script\.js, but script\.js does not exist/,
      );
      assert.ok(
        capturedInstructions!.remediationContext!.currentFiles.some((f) => f.path === "index.html"),
        "the corrective attempt must see the real current workspace files",
      );

      t.close();
    });
  });

  test("12. a corrective attempt that creates the missing file passes integrity and succeeds", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id, {
        provider: adapterWritingOnly([{ path: "index.html", content: BROKEN_INDEX }]),
        intentCheckFetch: fastFetch,
      });

      const second = await executeTask(t.db, task.id, {
        provider: adapterWritingOnly([{ path: "script.js", content: "console.log('fixed');" }]),
        intentCheckFetch: fastFetch,
      });

      assert.equal(second.outcome, "succeeded");
      assert.deepEqual((await listFiles(project.id)).sort(), ["index.html", "script.js"]);

      t.close();
    });
  });

  test("13. the existing zero-fileOperations contract remains intact alongside the new integrity gate", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const result = await executeTask(t.db, task.id, { provider: adapterWritingOnly([]), intentCheckFetch: fastFetch });
      assert.equal(result.outcome, "retried");
      const failures = listUnresolvedFailures(t.db, project.id);
      assert.ok(failures.some((f) => f.taskId === task.id && /did not provide any file operations/.test(f.reason)));

      t.close();
    });
  });

  test("14. real QA still runs, and can still PASS, once workspace integrity has already passed", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const devResult = await executeTask(t.db, devTask.id, {
        provider: adapterWritingOnly([
          { path: "index.html", content: WORKING_INDEX },
          { path: "script.js", content: WORKING_SCRIPT },
        ]),
        intentCheckFetch: fastFetch,
      });
      assert.equal(devResult.outcome, "succeeded");

      const { task: qaTask } = createTaskWithDependencies(t.db, {
        projectId: project.id,
        roleId: "qa-agent",
        title: "Test",
        dependsOnTaskIds: [devTask.id],
      });
      const noopAdapter = {
        name: "ollama",
        async runAgentTask() {
          return {
            status: "SUCCEEDED" as const,
            output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [] },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };
      const qaResult = await executeTask(t.db, qaTask.id, { provider: noopAdapter, intentCheckFetch: fastFetch });

      assert.equal(qaResult.outcome, "succeeded", "real browser QA — not the integrity gate — has the final say once integrity already passed");
      assert.equal(getWorkspace(t.db, project.id)?.deliveryState, "VERIFIED");

      t.close();
    });
  });

  test("15. the integrity gate never bypasses workspace path safety — a project's own workspace stays confined to its own directory", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id, {
        provider: adapterWritingOnly([{ path: "index.html", content: '<html><body><script src="../../outside.js"></script></body></html>' }]),
        intentCheckFetch: fastFetch,
      });

      // A reference escaping the workspace is skipped (never flagged, never resolved against the real filesystem) — proven by the task succeeding rather than failing on a path it has no safe way to check.
      const files = await listFiles(project.id);
      assert.deepEqual(files, ["index.html"]);

      t.close();
    });
  });

  test("16. the integrity gate does not interfere with local model routing — a semantic integrity failure still escalates the model on retry", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaDevProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const brokenFetch = (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            response: JSON.stringify({
              summary: "Implemented.",
              artifacts: [],
              decisions: [],
              testResults: [],
              events: [],
              fileOperations: [{ kind: "file-operation", action: "write", path: "index.html", content: BROKEN_INDEX }],
              recommendedNextActions: [],
            }),
          }),
        }) as unknown as Response) as unknown as typeof fetch;
      const fixedFetch = (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            response: JSON.stringify({
              summary: "Fixed.",
              artifacts: [],
              decisions: [],
              testResults: [],
              events: [],
              fileOperations: [{ kind: "file-operation", action: "write", path: "script.js", content: "console.log('fixed');" }],
              recommendedNextActions: [],
            }),
          }),
        }) as unknown as Response) as unknown as typeof fetch;

      const first = await executeTask(t.db, task.id, {
        availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
        ollamaFetchImpl: brokenFetch,
        intentCheckFetch: fastFetch,
      });
      assert.equal(first.outcome, "retried");
      assert.equal(first.agentRun!.model, "gemma4:latest");

      const second = await executeTask(t.db, task.id, {
        availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
        ollamaFetchImpl: fixedFetch,
        intentCheckFetch: fastFetch,
      });
      assert.equal(second.outcome, "succeeded");
      assert.equal(
        second.agentRun!.model,
        "qwen3.6:latest",
        "a real integrity semantic failure must escalate past the model that just produced it, since this isolated test DB has no benchmark evidence marking qwen3.6 unqualified",
      );

      t.close();
    });
  });
});

describe("Release Agent's real deliverable readiness gate (Phase 8 Part K)", () => {
  function releaseSpy() {
    let called = false;
    return {
      called: () => called,
      adapter: {
        name: "simulated",
        async runAgentTask(input: import("../../providers/types.ts").AgentTaskInput) {
          called = true;
          const { SimulatedAdapter } = await import("../../providers/simulated/simulated-adapter.ts");
          return new SimulatedAdapter().runAgentTask(input);
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      },
    };
  }

  test("a legacy project with no workspace at all is unaffected — the gate does not apply and the adapter runs normally", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const releaseTask = createTask(t.db, { projectId: project.id, roleId: "release-agent", title: "Prepare release" });
    const spy = releaseSpy();

    const result = await executeTask(t.db, releaseTask.id, { scenario: "success", provider: spy.adapter });

    assert.equal(spy.called(), true, "no workspace exists — the real-deliverable gate must not block a legacy project");
    assert.equal(result.outcome, "succeeded");

    t.close();
  });

  test("a real-development project whose deliverable is not yet VERIFIED is blocked before the adapter is ever called", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    // getOrCreateWorkspace-via-setDeliveryState simulates "files exist, but
    // QA hasn't verified them yet" without needing a real filesystem write.
    setDeliveryState(t.db, project.id, "BUILDING");
    t.db
      .prepare("INSERT INTO workspace_files (id, projectId, path, sizeBytes, createdAt, updatedAt) VALUES ('f1', ?, 'index.html', 10, ?, ?)")
      .run(project.id, Date.now(), Date.now());

    const releaseTask = createTask(t.db, { projectId: project.id, roleId: "release-agent", title: "Prepare release" });
    const spy = releaseSpy();
    const result = await executeTask(t.db, releaseTask.id, { scenario: "success", provider: spy.adapter });

    assert.equal(spy.called(), false, "the adapter must never be called for an unverified real deliverable");
    assert.equal(result.outcome, "retried");
    assert.match(result.reason ?? "", /not VERIFIED/);

    t.close();
  });

  test("a VERIFIED deliverable with an unresolved failure elsewhere in the project is still blocked", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    setDeliveryState(t.db, project.id, "VERIFIED");
    t.db
      .prepare("INSERT INTO workspace_files (id, projectId, path, sizeBytes, createdAt, updatedAt) VALUES ('f1', ?, 'index.html', 10, ?, ?)")
      .run(project.id, Date.now(), Date.now());
    const otherTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Some other task" });
    const { recordFailure } = await import("../../domain/project-outputs.ts");
    recordFailure(t.db, { projectId: project.id, taskId: otherTask.id, reason: "unrelated unresolved failure" });

    const releaseTask = createTask(t.db, { projectId: project.id, roleId: "release-agent", title: "Prepare release" });
    const spy = releaseSpy();
    const result = await executeTask(t.db, releaseTask.id, { scenario: "success", provider: spy.adapter });

    assert.equal(spy.called(), false);
    assert.equal(result.outcome, "retried");
    assert.match(result.reason ?? "", /unresolved failure/i);

    t.close();
  });

  test("a VERIFIED deliverable with no unresolved failures and at least one real file lets release proceed normally", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    setDeliveryState(t.db, project.id, "VERIFIED");
    t.db
      .prepare("INSERT INTO workspace_files (id, projectId, path, sizeBytes, createdAt, updatedAt) VALUES ('f1', ?, 'index.html', 10, ?, ?)")
      .run(project.id, Date.now(), Date.now());

    const releaseTask = createTask(t.db, { projectId: project.id, roleId: "release-agent", title: "Prepare release" });
    const spy = releaseSpy();
    const result = await executeTask(t.db, releaseTask.id, { scenario: "success", provider: spy.adapter });

    assert.equal(spy.called(), true);
    assert.equal(result.outcome, "succeeded");

    t.close();
  });
});

describe("scoped real-file context for code-consuming roles (Phase 8 Part J)", () => {
  async function captureRelevantFiles(t: ReturnType<typeof createTestDb>, taskId: string) {
    let captured: Array<{ path: string; content: string }> | undefined;
    const spyAdapter = {
      name: "simulated",
      async runAgentTask(input: import("../../providers/types.ts").AgentTaskInput) {
        captured = input.task.relevantFiles;
        const { SimulatedAdapter } = await import("../../providers/simulated/simulated-adapter.ts");
        return new SimulatedAdapter().runAgentTask(input);
      },
      estimateCost() {
        return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
      },
    };
    await executeTask(t.db, taskId, { scenario: "success", provider: spyAdapter });
    return captured;
  }

  test("qa-agent, security-reviewer, and code-reviewer all receive real file content once a workspace has files", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      await executeTask(t.db, devTask.id, { scenario: "success" });

      for (const roleId of ["qa-agent", "security-reviewer", "code-reviewer"]) {
        const task = createTask(t.db, { projectId: project.id, roleId, title: `Review (${roleId})` });
        const files = await captureRelevantFiles(t, task.id);
        assert.ok(files && files.length > 0, `${roleId} must receive real file content`);
        assert.ok(files!.some((f) => f.path === "index.html"));
      }

      t.close();
    });
  });

  test("a role whose allowedInputs does not include \"code\" (product-owner) never receives relevantFiles, even when a workspace has files", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      await executeTask(t.db, devTask.id, { scenario: "success" });

      const poTask = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
      const files = await captureRelevantFiles(t, poTask.id);
      assert.deepEqual(files, []);

      t.close();
    });
  });
});

describe("intent-consistency gates — real-provider only, never triggered by SimulatedAdapter (Phase 8 follow-up)", () => {
  function setupOllamaProject(t: ReturnType<typeof createTestDb>, rawIdeaText: string) {
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Ollama Hello World Build", rawIdeaText, ownerId: owner.id, provider: "ollama" });
    return project;
  }

  function fetchReturning(consistent: boolean, reason: string): typeof fetch {
    return (async () =>
      ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent, reason }) }) }) as unknown as Response) as unknown as typeof fetch;
  }

  const architectAdapter = {
    name: "ollama",
    async runAgentTask() {
      return {
        status: "SUCCEEDED" as const,
        output: {
          summary: "Proposed an architecture.",
          artifacts: [{ kind: "artifact" as const, artifactType: "architecture", content: "A Python CLI client for calling a local LLM server." }],
          decisions: [],
          testResults: [],
          events: [],
          fileOperations: [],
          recommendedNextActions: [],
        },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      };
    },
    estimateCost() {
      return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
    },
  };

  test("Gate 1: an inconsistent architecture blocks the developer, reopens the architecture task, and never calls the developer's own adapter", async () => {
    const t = createTestDb();
    const project = setupOllamaProject(t, "Create a simple webpage with a heading, description and button.");
    const archTask = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    await executeTask(t.db, archTask.id, { provider: architectAdapter });
    assert.equal(getTask(t.db, archTask.id)?.status, "DONE");

    const { task: devTask } = createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "frontend-developer",
      title: "Implement frontend",
      dependsOnTaskIds: [archTask.id],
    });

    let developerAdapterCalled = false;
    const developerAdapter = {
      name: "ollama",
      async runAgentTask() {
        developerAdapterCalled = true;
        throw new Error("must never be reached — the plan-consistency gate should have blocked this call");
      },
      estimateCost() {
        return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
      },
    };

    const result = await executeTask(t.db, devTask.id, {
      provider: developerAdapter,
      intentCheckFetch: fetchReturning(false, "The architecture describes an API client, not a webpage."),
    });

    assert.equal(developerAdapterCalled, false, "the developer's own adapter must never be called once the plan check fails");
    assert.equal(result.outcome, "retried");
    assert.match(result.reason ?? "", /Intent-consistency check failed/);
    assert.equal(getTask(t.db, archTask.id)?.status, "PENDING", "the real source of the problem — the architecture task — must be reopened");
    const failures = listUnresolvedFailures(t.db, project.id);
    assert.ok(failures.some((f) => f.taskId === archTask.id && /architecture describes an API client/.test(f.reason)));

    t.close();
  });

  test("Gate 1: a consistent architecture lets the developer's adapter run normally", async () => {
    const t = createTestDb();
    const project = setupOllamaProject(t, "Create a simple webpage with a heading, description and button.");
    const archTask = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    await executeTask(t.db, archTask.id, { provider: architectAdapter });

    const { task: devTask } = createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "frontend-developer",
      title: "Implement frontend",
      dependsOnTaskIds: [archTask.id],
    });

    let developerAdapterCalled = false;
    const developerAdapter = {
      name: "ollama",
      async runAgentTask() {
        developerAdapterCalled = true;
        return {
          status: "SUCCEEDED" as const,
          output: {
            summary: "ok",
            artifacts: [],
            decisions: [],
            testResults: [],
            events: [],
            fileOperations: [{ kind: "file-operation" as const, action: "write" as const, path: "index.html", content: "<html></html>" }],
            recommendedNextActions: [],
          },
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        };
      },
      estimateCost() {
        return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
      },
    };

    const result = await withWorkspace(() =>
      executeTask(t.db, devTask.id, {
        provider: developerAdapter,
        intentCheckFetch: fetchReturning(true, "The architecture describes a webpage as requested."),
      }),
    );

    assert.equal(developerAdapterCalled, true);
    assert.equal(result.outcome, "succeeded");

    t.close();
  });

  test("Gate 1 never runs for a SIMULATED project — SimulatedAdapter's idea-independent fixtures are never subjected to an intent check", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id, provider: "simulated" });
    const archTask = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    await executeTask(t.db, archTask.id, { scenario: "success" });

    const { task: devTask } = createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "frontend-developer",
      title: "Implement frontend",
      dependsOnTaskIds: [archTask.id],
    });

    let intentCheckCalled = false;
    const result = await executeTask(t.db, devTask.id, {
      scenario: "success",
      intentCheckFetch: (async () => {
        intentCheckCalled = true;
        return { ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: true, reason: "x" }) }) } as unknown as Response;
      }) as unknown as typeof fetch,
    });

    assert.equal(intentCheckCalled, false, "a SIMULATED project must never invoke the intent-consistency Ollama call");
    assert.equal(result.outcome, "succeeded");

    t.close();
  });

  test("Gate 2: a structurally-passing but off-request deliverable is downgraded to FAIL and reopens the developer", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const project = setupOllamaProject(t, "Create a very small Hello World webpage.");
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      // Seed a real, fully-correct static page cheaply and deterministically
      // via the real SimulatedAdapter fixture, injected explicitly to
      // override this project's own "ollama" provider — the mechanism
      // under test here is Gate 2 (qa-agent's deliverable-consistency
      // check), not file generation itself.
      // Both seeding calls explicitly mock intentCheckFetch — attempt 2
      // (attemptNumber > 1) is exactly the shape Gate 3 (retry-drift)
      // now inspects, and this suite must never depend on a real,
      // non-deterministic local Ollama server actually being reachable.
      const { SimulatedAdapter } = await import("../../providers/simulated/simulated-adapter.ts");
      await executeTask(t.db, devTask.id, {
        provider: new SimulatedAdapter(),
        scenario: "success",
        intentCheckFetch: fetchReturning(true, "consistent with the request"),
      });
      updateTaskStatus(t.db, devTask.id, "PENDING");
      await executeTask(t.db, devTask.id, {
        provider: new SimulatedAdapter(),
        scenario: "retry-success",
        intentCheckFetch: fetchReturning(true, "the fix preserves the existing page"),
      });
      assert.equal(getTask(t.db, devTask.id)?.status, "DONE");

      const { task: qaTask } = createTaskWithDependencies(t.db, {
        projectId: project.id,
        roleId: "qa-agent",
        title: "Test",
        dependsOnTaskIds: [devTask.id],
      });

      const result = await executeTask(t.db, qaTask.id, {
        provider: architectAdapter, // any SUCCEEDED adapter — its own output is replaced by the real QA override regardless
        intentCheckFetch: fetchReturning(false, "This is a generic placeholder page, not the requested Hello World greeting experience."),
      });

      assert.equal(result.outcome, "retried", "a real structural PASS must still be downgraded when the deliverable doesn't match the request");
      assert.equal(getTask(t.db, devTask.id)?.status, "PENDING", "the developer must be reopened, exactly like a real QA structural failure");
      const testResults = listTestResultsForTask(t.db, qaTask.id);
      assert.equal(testResults[0]!.status, "FAIL");
      assert.match(testResults[0]!.summary, /does not match the requested product/);
      assert.equal(getWorkspace(t.db, project.id)?.deliveryState, "FAILED");

      t.close();
    });
  });

  test("Gate 2 never runs for a SIMULATED project", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id, provider: "simulated" });
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      await executeTask(t.db, devTask.id, { scenario: "success" });
      updateTaskStatus(t.db, devTask.id, "PENDING");
      await executeTask(t.db, devTask.id, { scenario: "retry-success" });

      const { task: qaTask } = createTaskWithDependencies(t.db, {
        projectId: project.id,
        roleId: "qa-agent",
        title: "Test",
        dependsOnTaskIds: [devTask.id],
      });

      let intentCheckCalled = false;
      const result = await executeTask(t.db, qaTask.id, {
        scenario: "success",
        intentCheckFetch: (async () => {
          intentCheckCalled = true;
          return { ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: false, reason: "x" }) }) } as unknown as Response;
        }) as unknown as typeof fetch,
      });

      assert.equal(intentCheckCalled, false, "a SIMULATED project must never invoke the deliverable-consistency Ollama call");
      assert.equal(result.outcome, "succeeded", "a real structural PASS for a SIMULATED project is unaffected");

      t.close();
    });
  });
});

describe("retry drift prevention (Phase 8 second follow-up)", () => {
  function setupOllamaProject(t: ReturnType<typeof createTestDb>, rawIdeaText: string) {
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Simple Web Page Acceptance", rawIdeaText, ownerId: owner.id, provider: "ollama" });
    return project;
  }

  function fetchReturning(consistent: boolean, reason: string): typeof fetch {
    return (async () =>
      ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent, reason }) }) }) as unknown as Response) as unknown as typeof fetch;
  }

  function fetchThrowing(message: string): typeof fetch {
    return (async () => {
      throw new Error(message);
    }) as unknown as typeof fetch;
  }

  function writingAdapter(paths: Record<string, string>) {
    return {
      name: "ollama",
      async runAgentTask() {
        return {
          status: "SUCCEEDED" as const,
          output: {
            summary: "ok",
            artifacts: [],
            decisions: [],
            testResults: [],
            events: [],
            fileOperations: Object.entries(paths).map(([path, content]) => ({ kind: "file-operation" as const, action: "write" as const, path, content })),
            recommendedNextActions: [],
          },
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        };
      },
      estimateCost() {
        return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
      },
    };
  }

  describe("RemediationContext population (context-builder.ts)", () => {
    async function captureContext(t: ReturnType<typeof createTestDb>, taskId: string, extraOptions: Record<string, unknown> = {}) {
      let captured: import("../../providers/types.ts").TaskContext | undefined;
      const spyAdapter = {
        name: "ollama",
        async runAgentTask(input: import("../../providers/types.ts").AgentTaskInput) {
          captured = input.task;
          return {
            status: "SUCCEEDED" as const,
            output: { summary: "ok", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [] },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };
      await executeTask(t.db, taskId, { provider: spyAdapter, intentCheckFetch: fetchReturning(true, "ok"), ...extraOptions });
      return captured;
    }

    test("a first attempt (attemptNumber 1) never carries remediationContext", async () => {
      const t = createTestDb();
      const project = setupOllamaProject(t, "Create a webpage.");
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      const context = await captureContext(t, devTask.id);
      assert.equal(context?.remediationContext, undefined);
      t.close();
    });

    test("a genuine retry (attemptNumber > 1) for a development role carries the exact failure reason, all unresolved failing checks, and the real current files", async () => {
      await withWorkspace(async () => {
        const t = createTestDb();
        const project = setupOllamaProject(t, "Create a webpage.");
        const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

        // Attempt 1: write a real file, then fail it for real via a
        // downstream QA-shaped failure so a real Failure row exists
        // against devTask (exactly how a real retry gets triggered).
        await executeTask(t.db, devTask.id, {
          provider: writingAdapter({ "index.html": "<h1>Hello</h1>" }),
          intentCheckFetch: fetchReturning(true, "ok"),
        });
        const { recordFailure } = await import("../../domain/project-outputs.ts");
        recordFailure(t.db, { projectId: project.id, taskId: devTask.id, reason: "Clicking the button did not change any visible text on the page." });
        updateTaskStatus(t.db, devTask.id, "PENDING");

        const context = await captureContext(t, devTask.id);
        assert.ok(context?.remediationContext);
        assert.equal(context!.remediationContext!.attemptNumber, 2);
        assert.equal(context!.remediationContext!.failureReason, "Clicking the button did not change any visible text on the page.");
        assert.deepEqual(context!.remediationContext!.failingChecks, ["Clicking the button did not change any visible text on the page."]);
        assert.ok(context!.remediationContext!.currentFiles.some((f) => f.path === "index.html" && f.content === "<h1>Hello</h1>"));
        assert.match(context!.remediationContext!.preserveRequirements, /not a redesign/i);

        t.close();
      });
    });

    test("a retry for a NON-development role (e.g. qa-agent) never carries remediationContext — the mechanism is development-role-specific", async () => {
      const t = createTestDb();
      const project = setupOllamaProject(t, "Create a webpage.");
      const qaTask = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test" });

      let captured: import("../../providers/types.ts").TaskContext | undefined;
      const spyAdapter = {
        name: "ollama",
        async runAgentTask(input: import("../../providers/types.ts").AgentTaskInput) {
          captured = input.task;
          return { status: "FAILED" as const, output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason: "x" } }, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };
      await executeTask(t.db, qaTask.id, { provider: spyAdapter });
      updateTaskStatus(t.db, qaTask.id, "PENDING");
      await executeTask(t.db, qaTask.id, { provider: spyAdapter });
      assert.equal(captured?.remediationContext, undefined);

      t.close();
    });
  });

  describe("OllamaAdapter renders the corrective-attempt section", () => {
    test("the prompt includes the attempt number, exact failure reason, preserve guidance, and current file contents", async () => {
      const { OllamaAdapter } = await import("../../providers/ollama/ollama-adapter.ts");
      let capturedPrompt = "";
      const fetchImpl = async (_url: string, init: RequestInit) => {
        capturedPrompt = (JSON.parse(init.body as string) as { prompt: string }).prompt;
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: JSON.stringify({ summary: "ok", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [] }) }),
        } as unknown as Response;
      };
      const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
      await adapter.runAgentTask({
        role: "frontend-developer",
        instructions: "x",
        task: {
          projectId: "p1",
          taskId: "t1",
          roleId: "frontend-developer",
          taskTitle: "Implement frontend",
          projectSummary: "",
          authoritativeUserRequest: "Create a Hello World webpage with a button.",
          projectTitle: "Simple Web Page Acceptance",
          relevantArtifacts: [],
          relevantDecisions: [],
          remediationContext: {
            attemptNumber: 2,
            failureReason: "Clicking the button did not change any visible text on the page.",
            failingChecks: ["Clicking the button did not change any visible text on the page."],
            currentFiles: [{ path: "index.html", content: "<h1>Hello, World!</h1>" }],
            preserveRequirements: "This is a corrective attempt, not a redesign.",
          },
        },
      });

      assert.match(capturedPrompt, /CORRECTIVE ATTEMPT/);
      assert.match(capturedPrompt, /Attempt: 2/);
      assert.match(capturedPrompt, /Clicking the button did not change any visible text on the page\./);
      assert.match(capturedPrompt, /This is a corrective attempt, not a redesign\./);
      assert.match(capturedPrompt, /<h1>Hello, World!<\/h1>/, "the real current file content must be shown, not just its path");
    });
  });

  describe("Gate 3: a proposed corrective write is checked before it's ever applied", () => {
    test("a drifted corrective candidate is rejected before materialization — no file is written, the task retries for real", async () => {
      await withWorkspace(async () => {
        const t = createTestDb();
        const project = setupOllamaProject(t, "Create a Hello World webpage with a button.");
        const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

        await executeTask(t.db, devTask.id, {
          provider: writingAdapter({ "index.html": "<h1>Hello, World!</h1><button>Say hello</button>" }),
          intentCheckFetch: fetchReturning(true, "ok"),
        });
        const { recordFailure } = await import("../../domain/project-outputs.ts");
        recordFailure(t.db, { projectId: project.id, taskId: devTask.id, reason: "Clicking the button did not change any visible text." });
        updateTaskStatus(t.db, devTask.id, "PENDING");

        const result = await executeTask(t.db, devTask.id, {
          provider: writingAdapter({ "index.html": "<h1>System Health Check</h1><p>Edge Layer (CDN) verification complete.</p>" }),
          intentCheckFetch: fetchReturning(false, "The proposed page is an unrelated System Health Check dashboard, not the requested Hello World page."),
        });

        assert.equal(result.outcome, "retried", "a real drift is a genuine implementation problem — it consumes real retry budget, same as any other bad fix");
        assert.match(result.reason ?? "", /would have changed the product's identity/);
        assert.equal(await readFile(project.id, "index.html"), "<h1>Hello, World!</h1><button>Say hello</button>", "the drifted content must never have been written");

        t.close();
      });
    });

    test("a valid, minimal, non-drifting corrective fix is accepted and applied normally", async () => {
      await withWorkspace(async () => {
        const t = createTestDb();
        const project = setupOllamaProject(t, "Create a Hello World webpage with a button.");
        const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

        await executeTask(t.db, devTask.id, {
          provider: writingAdapter({ "index.html": "<h1>Hello, World!</h1><button onclick=\"bad()\">Say hello</button>" }),
          intentCheckFetch: fetchReturning(true, "ok"),
        });
        const { recordFailure } = await import("../../domain/project-outputs.ts");
        recordFailure(t.db, { projectId: project.id, taskId: devTask.id, reason: "Clicking the button did not change any visible text." });
        updateTaskStatus(t.db, devTask.id, "PENDING");

        const result = await executeTask(t.db, devTask.id, {
          provider: writingAdapter({ "index.html": "<h1>Hello, World!</h1><button onclick=\"greet()\">Say hello</button>" }),
          intentCheckFetch: fetchReturning(true, "The fix preserves the Hello World heading and button, only correcting the click handler."),
        });

        assert.equal(result.outcome, "succeeded");
        assert.equal(await readFile(project.id, "index.html"), "<h1>Hello, World!</h1><button onclick=\"greet()\">Say hello</button>");

        t.close();
      });
    });

    test("Gate 3 does not apply to a first attempt — nothing 'previous' to drift away from yet", async () => {
      await withWorkspace(async () => {
        const t = createTestDb();
        const project = setupOllamaProject(t, "Create any webpage.");
        const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

        let intentCheckCalled = false;
        const result = await executeTask(t.db, devTask.id, {
          provider: writingAdapter({ "index.html": "<h1>Anything</h1>" }),
          intentCheckFetch: (async () => {
            intentCheckCalled = true;
            return { ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: true, reason: "x" }) }) } as unknown as Response;
          }) as unknown as typeof fetch,
        });

        assert.equal(result.outcome, "succeeded");
        assert.equal(intentCheckCalled, false, "no intent check should run at all on a first attempt with no prior planning artifacts and no prior files");

        t.close();
      });
    });
  });

  describe("Gate 2 is fail-CLOSED on 'unavailable' — the final VERIFIED gate never silently passes when it cannot actually verify", () => {
    test("when the deliverable-consistency check cannot run at all, the deliverable is NOT marked VERIFIED, and the developer is NOT reopened", async () => {
      await withWorkspace(async () => {
        const t = createTestDb();
        const project = setupOllamaProject(t, "Create a very small Hello World webpage.");
        const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

        const { SimulatedAdapter } = await import("../../providers/simulated/simulated-adapter.ts");
        await executeTask(t.db, devTask.id, { provider: new SimulatedAdapter(), scenario: "success", intentCheckFetch: fetchReturning(true, "ok") });
        updateTaskStatus(t.db, devTask.id, "PENDING");
        await executeTask(t.db, devTask.id, { provider: new SimulatedAdapter(), scenario: "retry-success", intentCheckFetch: fetchReturning(true, "ok") });

        const { task: qaTask } = createTaskWithDependencies(t.db, {
          projectId: project.id,
          roleId: "qa-agent",
          title: "Test",
          dependsOnTaskIds: [devTask.id],
        });

        const result = await executeTask(t.db, qaTask.id, {
          provider: new SimulatedAdapter(),
          intentCheckFetch: fetchThrowing("connect ECONNREFUSED"),
        });

        assert.equal(result.outcome, "retried", "an operational check failure is a normal retryable failure — never a silent success");
        assert.match(result.reason ?? "", /Operational:.*could not run/);
        assert.equal(getWorkspace(t.db, project.id)?.deliveryState, "VERIFYING", "never VERIFIED, and never a false FAILED claim about the build itself");
        assert.equal(getTask(t.db, devTask.id)?.status, "DONE", "an operational check failure must never blame/reopen the developer");

        t.close();
      });
    });
  });

  describe("operational vs semantic retry budget", () => {
    test("a transient operational failure (one malformed-JSON response, then a real success) never consumes the task's real retry budget", async () => {
      const t = createTestDb();
      const project = setupOllamaProject(t, "Create a webpage.");
      const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

      let calls = 0;
      const flakyAdapter = {
        name: "ollama",
        async runAgentTask() {
          calls += 1;
          if (calls === 1) {
            // Mirrors OllamaAdapter's own malformedResult() reason text exactly.
            return {
              status: "FAILED" as const,
              output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason: "Ollama's model output was not valid JSON." } },
              usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
            };
          }
          return {
            status: "SUCCEEDED" as const,
            output: { summary: "ok", artifacts: [{ kind: "artifact" as const, artifactType: "requirements", content: "# Requirements" }], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [] },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };

      const result = await executeTask(t.db, task.id, { provider: flakyAdapter });
      assert.equal(result.outcome, "succeeded");
      assert.equal(calls, 2, "the malformed-JSON response was retried in-process, within this single logical execution");
      assert.equal(listTaskAttempts(t.db, task.id).length, 1, "only ONE real TaskAttempt was ever created — the transient blip cost nothing");

      t.close();
    });

    test("a persistent operational failure is bounded (not infinite) and eventually consumes exactly one real attempt, flowing through the normal retry path", async () => {
      const t = createTestDb();
      const project = setupOllamaProject(t, "Create a webpage.");
      const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

      let calls = 0;
      const alwaysFlakyAdapter = {
        name: "ollama",
        async runAgentTask() {
          calls += 1;
          return {
            status: "FAILED" as const,
            output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason: "Ollama's model output was not valid JSON." } },
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          };
        },
        estimateCost() {
          return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
        },
      };

      const result = await executeTask(t.db, task.id, { provider: alwaysFlakyAdapter });
      assert.equal(result.outcome, "retried", "still bounded — this eventually gives up and flows through the normal failure path");
      assert.equal(calls, 3, "1 initial call + 2 bounded operational retries, never unbounded");
      assert.equal(listTaskAttempts(t.db, task.id).length, 1, "all 3 real HTTP calls happened within ONE logical TaskAttempt");
      assert.equal(getTask(t.db, task.id)?.attemptCount, 1, "a persistent operational failure still only consumes one unit of the real retry ceiling per real execution, exactly like any other failure");

      t.close();
    });
  });
});

/** A fake `fetch` for OllamaAdapter's own HTTP call (distinct from the intent-consistency check's `intentCheckFetch`) — returns a well-formed Ollama /api/generate response with a valid StructuredAgentOutput JSON body, so the real OllamaAdapter code path runs with no real network call. */
function fakeOllamaGenerateFetch(): typeof fetch {
  const structuredOutput = {
    summary: "Done.",
    artifacts: [],
    decisions: [],
    testResults: [],
    events: [],
    fileOperations: [],
    recommendedNextActions: [],
  };
  return (async () =>
    ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify(structuredOutput) }) }) as unknown as Response) as unknown as typeof fetch;
}

describe("model identity persistence (local multi-model routing follow-up)", () => {
  test("a real OllamaAdapter instance's bound model is persisted on the agent_runs row", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Model identity test",
      rawIdeaText: "Build a small tool.",
      ownerId: owner.id,
      provider: "ollama",
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const { OllamaAdapter } = await import("../../providers/ollama/ollama-adapter.ts");
    const modelBoundAdapter = new OllamaAdapter({ model: "qwen3.6:latest", fetchImpl: fakeOllamaGenerateFetch() });

    const result = await executeTask(t.db, task.id, {
      scenario: "success",
      provider: modelBoundAdapter,
      intentCheckFetch: (async () =>
        ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: true, reason: "ok" }) }) }) as unknown as Response) as unknown as typeof fetch,
    });
    assert.equal(result.outcome, "succeeded");
    assert.ok(result.agentRun);
    assert.equal(result.agentRun!.model, "qwen3.6:latest");
    assert.equal(getAgentRun(t.db, result.agentRun!.id)?.model, "qwen3.6:latest");

    t.close();
  });

  test("a SimulatedAdapter run persists a null model — honest absence, not a fabricated value", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const result = await executeTask(t.db, task.id, { scenario: "success" });
    assert.equal(result.outcome, "succeeded");
    assert.equal(result.agentRun!.model, null);

    t.close();
  });

  test("two attempts using different OllamaAdapter model instances each persist their own model on their own agent_runs row", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Model identity per-attempt test",
      rawIdeaText: "Build a small tool.",
      ownerId: owner.id,
      provider: "ollama",
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const { OllamaAdapter } = await import("../../providers/ollama/ollama-adapter.ts");
    const fastFetch = (async () =>
      ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: true, reason: "ok" }) }) }) as unknown as Response) as unknown as typeof fetch;
    // A real (non-Simulated) adapter ignores `scenario` entirely — it
    // only reflects whatever its own fetch response says. To force a
    // real FAILED attempt 1 (so a real attempt 2 is eligible on the
    // same task), the first fetch's structured output carries a
    // `failure` field, exactly like ollama-adapter.ts's own status
    // derivation (`output.failure ? "FAILED" : "SUCCEEDED"`).
    const failingFetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            summary: "",
            artifacts: [],
            decisions: [],
            testResults: [],
            events: [],
            fileOperations: [],
            recommendedNextActions: [],
            failure: { reason: "Deliberate test failure to allow a second real attempt." },
          }),
        }),
      }) as unknown as Response) as unknown as typeof fetch;

    const first = await executeTask(t.db, task.id, {
      provider: new OllamaAdapter({ model: "gemma4:latest", fetchImpl: failingFetch }),
      intentCheckFetch: fastFetch,
    });
    assert.equal(first.outcome, "retried");
    assert.equal(first.agentRun!.model, "gemma4:latest");

    const second = await executeTask(t.db, task.id, {
      provider: new OllamaAdapter({ model: "qwen3.6:latest", fetchImpl: fakeOllamaGenerateFetch() }),
      intentCheckFetch: fastFetch,
    });
    assert.equal(second.outcome, "succeeded");
    assert.equal(second.agentRun!.model, "qwen3.6:latest");
    assert.notEqual(first.agentRun!.id, second.agentRun!.id, "each attempt gets its own agent_runs row, so each keeps its own model identity");

    t.close();
  });
});

describe("local model routing integration — real routing path (no options.provider)", () => {
  const fastFetch = (async () =>
    ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: true, reason: "ok" }) }) }) as unknown as Response) as unknown as typeof fetch;

  function semanticFailureFetch(reason: string): typeof fetch {
    return (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            summary: "",
            artifacts: [],
            decisions: [],
            testResults: [],
            events: [],
            fileOperations: [],
            recommendedNextActions: [],
            failure: { reason },
          }),
        }),
      }) as unknown as Response) as unknown as typeof fetch;
  }

  function malformedJsonFetch(): typeof fetch {
    return (async () => ({ ok: true, status: 200, json: async () => ({ response: "not valid json" }) }) as unknown as Response) as unknown as typeof fetch;
  }

  test("executeTask's own real routing (LocalModelRouter, no injected adapter) picks a model from the detected available models and persists it", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Routing integration", rawIdeaText: "Build a small tool.", ownerId: owner.id, provider: "ollama" });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const result = await executeTask(t.db, task.id, {
      availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
      ollamaFetchImpl: fakeOllamaGenerateFetch(),
      intentCheckFetch: fastFetch,
    });
    assert.equal(result.outcome, "succeeded");
    assert.equal(result.agentRun!.model, "gemma4:latest", "the default GENERAL chain prefers gemma4:latest pre-benchmark");

    t.close();
  });

  test("a real semantic failure on attempt 1 causes real routing to escalate the model on attempt 2 — same task, same authoritative request", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Escalation integration",
      rawIdeaText: "Build a small tool that does exactly one thing well.",
      ownerId: owner.id,
      provider: "ollama",
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const first = await executeTask(t.db, task.id, {
      availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
      ollamaFetchImpl: semanticFailureFetch("The requirements did not match the requested product."),
      intentCheckFetch: fastFetch,
    });
    assert.equal(first.outcome, "retried");
    assert.equal(first.agentRun!.model, "gemma4:latest");

    const second = await executeTask(t.db, task.id, {
      availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
      ollamaFetchImpl: fakeOllamaGenerateFetch(),
      intentCheckFetch: fastFetch,
    });
    assert.equal(second.outcome, "succeeded");
    assert.equal(second.agentRun!.model, "qwen3.6:latest", "a real semantic failure must escalate past the model that just failed");

    t.close();
  });

  test("a real operational failure (malformed JSON, exhausting bounded in-process retries) does NOT escalate — attempt 2 real routing picks the same model again", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "No-escalation-on-operational integration",
      rawIdeaText: "Build a small tool.",
      ownerId: owner.id,
      provider: "ollama",
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const first = await executeTask(t.db, task.id, {
      availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
      ollamaFetchImpl: malformedJsonFetch(),
      intentCheckFetch: fastFetch,
    });
    assert.equal(first.outcome, "retried");
    assert.equal(first.agentRun!.model, "gemma4:latest");

    const second = await executeTask(t.db, task.id, {
      availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"],
      ollamaFetchImpl: fakeOllamaGenerateFetch(),
      intentCheckFetch: fastFetch,
    });
    assert.equal(second.outcome, "succeeded");
    assert.equal(second.agentRun!.model, "gemma4:latest", "a purely operational failure must never trigger model escalation");

    t.close();
  });

  test("switching models across attempts never changes the authoritative user request the developer/product-owner sees", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const rawIdeaText = "Build a small tool that tracks reading progress across books.";
    const { project } = createProjectWithIdea(t.db, { title: "Authoritative request stability", rawIdeaText, ownerId: owner.id, provider: "ollama" });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });

    const capturedRequests: string[] = [];
    const capturingFailureFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { prompt: string };
      capturedRequests.push(body.prompt);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            summary: "",
            artifacts: [],
            decisions: [],
            testResults: [],
            events: [],
            fileOperations: [],
            recommendedNextActions: [],
            failure: { reason: "Deliberate semantic failure to force a second, model-escalated attempt." },
          }),
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const capturingSuccessFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { prompt: string };
      capturedRequests.push(body.prompt);
      return { ok: true, status: 200, json: async () => ({ response: JSON.stringify({ summary: "Done.", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [] }) }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await executeTask(t.db, task.id, { availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"], ollamaFetchImpl: capturingFailureFetch, intentCheckFetch: fastFetch });
    await executeTask(t.db, task.id, { availableModelsOverride: ["gemma4:latest", "qwen3.6:latest"], ollamaFetchImpl: capturingSuccessFetch, intentCheckFetch: fastFetch });

    assert.equal(capturedRequests.length, 2);
    for (const prompt of capturedRequests) {
      assert.ok(prompt.includes(rawIdeaText), "every routed model must receive the identical authoritative user request, regardless of which model was selected");
    }

    t.close();
  });
});
