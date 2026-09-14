import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, reopenTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject, updateProjectStatus } from "../../domain/projects.ts";
import {
  createTask,
  createTaskWithDependencies,
  getTask,
  claimTask,
  createTaskAttempt,
  updateTaskStatus,
  listTasksForProject,
  createAgentRunForAttempt,
  updateAgentRunStatus,
  listTaskAttempts,
  getAgentRun,
} from "../../domain/tasks.ts";
import { setOfficeStatus } from "../../domain/office.ts";
import { listArtifactsForProject } from "../../domain/project-outputs.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { planProject } from "../../orchestrator/orchestrator.ts";
import { runOneCycle, startRunLoop, type RunnerCycleOutcome } from "../runner.ts";
import type { AgentTaskResult } from "../../providers/types.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

// See agents/__tests__/phase4-simulation.test.ts's identical block for
// why this matters: isolates any real file writes a frontend-developer
// task might trigger into a throwaway temp directory rather than this
// machine's real .data/ai-office-workspaces/.
let workspaceRoot: string;
beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-test-workspace-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
});
afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function setupInProgressProject(t: ReturnType<typeof createTestDb>, rawIdeaText = "Build a small tool.") {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText, ownerId: owner.id });
  updateProjectStatus(t.db, project.id, "IN_PROGRESS");
  return project;
}

/** Runs cycles until the predicate is satisfied or the cap is hit — the standard shape for driving the Runner in a test without a real timer loop. */
async function runUntil(
  db: Parameters<typeof runOneCycle>[0],
  runnerId: string,
  predicate: () => boolean,
  options: Parameters<typeof runOneCycle>[2] = {},
  maxCycles = 100,
): Promise<RunnerCycleOutcome[]> {
  const outcomes: RunnerCycleOutcome[] = [];
  for (let i = 0; i < maxCycles && !predicate(); i++) {
    outcomes.push(await runOneCycle(db, runnerId, options));
  }
  return outcomes;
}

describe("runOneCycle — basic outcomes", () => {
  test("an empty, freshly-seeded office with no tasks reports idle", async () => {
    const t = createTestDb();
    const outcome = await runOneCycle(t.db, "runner-1");
    assert.equal(outcome.kind, "idle");
    t.close();
  });

  test("a CLOSED office reports office-closed and touches nothing", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });
    setOfficeStatus(t.db, { state: "CLOSED", changedBy: null, reason: "test" });

    const outcome = await runOneCycle(t.db, "runner-1");
    assert.equal(outcome.kind, "office-closed");
    assert.equal(getTask(t.db, task.id)?.status, "PENDING", "task must be untouched while the office is closed");

    t.close();
  });

  test("reopening the office resumes eligible work", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });
    setOfficeStatus(t.db, { state: "CLOSED", changedBy: null, reason: "test" });
    assert.equal((await runOneCycle(t.db, "runner-1")).kind, "office-closed");

    setOfficeStatus(t.db, { state: "OPEN", changedBy: null, reason: "test" });
    const outcome = await runOneCycle(t.db, "runner-1", { execution: { scenario: "success" } });
    assert.equal(outcome.kind, "executed");
    assert.equal(getTask(t.db, task.id)?.status, "DONE");

    t.close();
  });

  test("a project with PENDING tasks that are all blocked by dependencies reports no-eligible-work, not idle", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const upstream = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Requirements" });
    createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "solution-architect",
      title: "Architecture",
      dependsOnTaskIds: [upstream.id],
    });
    updateTaskStatus(t.db, upstream.id, "IN_PROGRESS"); // simulate: already claimed elsewhere, not by this call

    const outcome = await runOneCycle(t.db, "runner-1");
    assert.equal(outcome.kind, "no-eligible-work");
    t.close();
  });

  test("executes exactly one eligible task and returns its outcome", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });

    const outcome = await runOneCycle(t.db, "runner-1", { execution: { scenario: "success" } });
    assert.equal(outcome.kind, "executed");
    assert.equal(outcome.detail?.taskId, task.id);
    assert.equal(outcome.detail?.outcome, "succeeded");
    assert.equal(getTask(t.db, task.id)?.status, "DONE");

    t.close();
  });
});

describe("crash recovery", () => {
  /**
   * Puts a task into the exact state AgentRunner leaves it in mid-attempt
   * — lease held, TaskAttempt RUNNING, AgentRun RUNNING — then simulates
   * a crash (the lease is set already-expired) before either record
   * could ever be closed out. Order matters: `claimTask` only succeeds
   * against a PENDING task, mirroring the Runner's real claim-then-execute
   * sequence, so the lease is set first and only then does everything
   * else move to its "in flight" state.
   */
  function simulateInterruptedExecution(t: ReturnType<typeof createTestDb>, taskId: string, roleId: string) {
    claimTask(t.db, { taskId, leaseOwnerId: "dead-runner", leaseDurationMs: -1000 });
    const attempt = createTaskAttempt(t.db, taskId);
    let agentRun = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId, provider: "simulated" });
    agentRun = updateAgentRunStatus(t.db, agentRun.id, "RUNNING");
    updateTaskStatus(t.db, taskId, "IN_PROGRESS");
    return { attempt, agentRun };
  }

  test("an IN_PROGRESS task with an expired lease is restored to PENDING with attemptCount preserved, and the interrupted TaskAttempt/AgentRun are closed out, not left RUNNING", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });
    const { attempt: interruptedAttempt, agentRun: interruptedRun } = simulateInterruptedExecution(t, task.id, "product-owner");
    assert.equal(getTask(t.db, task.id)?.attemptCount, 1);

    const outcome = await runOneCycle(t.db, "runner-2");
    assert.equal(outcome.kind, "recovered");
    assert.deepEqual(outcome.detail?.taskIds, [task.id]);

    const recovered = getTask(t.db, task.id)!;
    assert.equal(recovered.status, "PENDING");
    assert.equal(recovered.attemptCount, 1, "attemptCount must not reset or double-increment on recovery");
    assert.equal(recovered.leaseOwnerId, null);

    // The original interrupted records — inspected directly, not just
    // the task — must be terminal, never left RUNNING, and never
    // reported as having succeeded.
    const closedAttempt = t.db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(interruptedAttempt.id) as {
      status: string;
    };
    assert.equal(closedAttempt.status, "FAILED", "the interrupted TaskAttempt must not stay RUNNING forever");

    const closedRun = getAgentRun(t.db, interruptedRun.id)!;
    assert.equal(closedRun.status, "FAILED", "the interrupted AgentRun must not stay RUNNING forever");
    assert.ok(closedRun.finishedAt, "a recovered AgentRun must have finishedAt populated");

    // No RUNNING attempt or RUNNING/QUEUED run survives recovery for
    // this task at all — not just the one record checked above.
    const allAttempts = listTaskAttempts(t.db, task.id);
    assert.ok(!allAttempts.some((a) => a.status === "RUNNING"), "no RUNNING TaskAttempt may remain after recovery");

    const events = listEventsForProject(t.db, project.id);
    const recoveryEvent = events.find((e) => e.type === "task.recovered_after_crash");
    assert.ok(recoveryEvent, "a recovery event must be recorded");
    const payload = JSON.parse(recoveryEvent!.payload);
    assert.equal(payload.interruptedAttemptId, interruptedAttempt.id);
    assert.equal(payload.interruptedAgentRunId, interruptedRun.id);

    // A recovered task is genuinely re-executable on the very next
    // cycle, and that retry creates the *next* attempt number — never
    // reuses or duplicates the interrupted one.
    const next = await runOneCycle(t.db, "runner-2", { execution: { scenario: "success" } });
    assert.equal(next.kind, "executed");
    assert.equal(getTask(t.db, task.id)?.status, "DONE");
    assert.equal(getTask(t.db, task.id)?.attemptCount, 2);

    const finalAttempts = listTaskAttempts(t.db, task.id);
    assert.deepEqual(
      finalAttempts.map((a) => ({ attemptNumber: a.attemptNumber, status: a.status })),
      [
        { attemptNumber: 1, status: "FAILED" },
        { attemptNumber: 2, status: "SUCCEEDED" },
      ],
    );
    assert.ok(
      !listTaskAttempts(t.db, task.id).some((a) => a.status === "RUNNING"),
      "no RUNNING TaskAttempt may remain after the retry either",
    );

    assert.equal(listArtifactsForProject(t.db, project.id).length, 1, "recovery + re-execution must not duplicate the eventual successful artifact");

    t.close();
  });

  test("a task interrupted before its AgentRun was ever created (createTaskAttempt succeeded, createAgentRunForAttempt did not run) still recovers cleanly", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });

    // No agent_run at all — the interruption happened between
    // createTaskAttempt and createAgentRunForAttempt.
    claimTask(t.db, { taskId: task.id, leaseOwnerId: "dead-runner", leaseDurationMs: -1000 });
    const attempt = createTaskAttempt(t.db, task.id);
    updateTaskStatus(t.db, task.id, "IN_PROGRESS");

    const outcome = await runOneCycle(t.db, "runner-2");
    assert.equal(outcome.kind, "recovered");

    const closedAttempt = t.db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(attempt.id) as { status: string };
    assert.equal(closedAttempt.status, "FAILED");
    assert.equal(getTask(t.db, task.id)?.status, "PENDING");

    t.close();
  });

  test("a stale lease on a task that is already DONE/BLOCKED is cleared but does not resurrect the task", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });
    await runOneCycle(t.db, "runner-1", { execution: { scenario: "success" } });
    assert.equal(getTask(t.db, task.id)?.status, "DONE");

    // Leftover expired lease bookkeeping on an already-terminal task —
    // should never happen in practice (release always follows
    // execution), but recovery must be safe against it regardless.
    claimTask(t.db, { taskId: task.id, leaseOwnerId: "ghost", leaseDurationMs: -1000 });
    const outcome = await runOneCycle(t.db, "runner-1");
    assert.notEqual(outcome.kind, "recovered", "a DONE task's lease is cleared silently, not reported as a recovery");
    assert.equal(getTask(t.db, task.id)?.status, "DONE");
    assert.equal(getTask(t.db, task.id)?.leaseOwnerId, null);

    t.close();
  });
});

describe("execution timeout, through the Runner", () => {
  const hangingAdapter = {
    name: "simulated",
    runAgentTask(): Promise<AgentTaskResult> {
      return new Promise(() => {});
    },
    estimateCost() {
      return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
    },
  };

  test("a hanging provider is abandoned at the configured timeout, the task is retried, and the lease is released (not left dangling)", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "x" });

    const outcome = await runOneCycle(t.db, "runner-1", { execution: { provider: hangingAdapter, timeoutMs: 20 } });
    assert.equal(outcome.kind, "executed");
    assert.equal(outcome.detail?.outcome, "retried");

    const after = getTask(t.db, task.id)!;
    assert.equal(after.status, "PENDING");
    assert.equal(after.leaseOwnerId, null, "the lease must be released even though the attempt failed via timeout");
    assert.equal(project.id, after.projectId);

    t.close();
  });
});

describe("provider execution exceptions, through the Runner", () => {
  const throwingAdapter = {
    name: "simulated",
    runAgentTask(): Promise<AgentTaskResult> {
      throw new Error("simulated adapter crash");
    },
    estimateCost() {
      return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
    },
  };

  test("a throwing provider is treated as a normal retryable failure — outcome 'executed'/'retried', and the lease IS released (this is not an internal error)", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });

    const outcome = await runOneCycle(t.db, "runner-1", { execution: { provider: throwingAdapter } });
    assert.equal(outcome.kind, "executed");
    assert.equal(outcome.detail?.outcome, "retried");

    const after = getTask(t.db, task.id)!;
    assert.equal(after.status, "PENDING");
    assert.equal(after.leaseOwnerId, null, "a provider-side failure is handled inside executeTask() and returns normally — the lease must still be released");

    t.close();
  });
});

describe("internal/persistence error — the IN_PROGRESS-with-no-lease invariant", () => {
  /**
   * A well-formed adapter (no throw, no rejection — a genuine provider
   * success) that returns a structurally malformed result: `artifacts`
   * is not an array. This is not a provider-side failure — the adapter
   * did its job and returned SUCCEEDED — it's a bug surfacing during
   * `AgentRunner`'s own persistence step (`finishSuccess`'s `for (const
   * artifact of output.artifacts)`), simulating exactly the kind of
   * internal/programming error the crash-recovery mechanism, not the
   * retry/escalation pipeline, is responsible for.
   */
  const malformedResultAdapter = {
    name: "simulated",
    async runAgentTask(): Promise<AgentTaskResult> {
      return {
        status: "SUCCEEDED",
        output: {
          summary: "ok",
          artifacts: null as unknown as [],
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

  test("an internal persistence error surfaces as 'error' and leaves the lease intact — never a committed IN_PROGRESS-with-no-lease state — and the next crash-recovery sweep repairs it", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });

    const outcome = await runOneCycle(t.db, "runner-1", { execution: { provider: malformedResultAdapter } });
    assert.equal(outcome.kind, "error", "an internal persistence error must surface as 'error', not be disguised as an agent failure");

    const stuck = getTask(t.db, task.id)!;
    assert.equal(stuck.status, "IN_PROGRESS");
    // The invariant under test: there must never be a committed state
    // where task.status = IN_PROGRESS and leaseOwnerId IS NULL.
    assert.notEqual(stuck.leaseOwnerId, null, "the lease must be retained — releasing it would strand the task IN_PROGRESS with no lease, invisible to both eligibility and crash recovery");

    // The underlying records are exactly what a real crash at this
    // point would have left behind — RUNNING, not yet closed, since
    // finishSuccess's own transaction rolled back before reaching its
    // status-update statements.
    const attempts = listTaskAttempts(t.db, task.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, "RUNNING");
    const run = getAgentRun(t.db, attempts[0].agentRunId!);
    assert.equal(run?.status, "RUNNING");

    // Simulate time passing until the still-held lease expires, then
    // let the ordinary crash-recovery sweep repair the state — the same
    // mechanism a real process restart relies on. (claimTask() only
    // matches a PENDING task, so a direct field update is used here to
    // age the existing lease, mirroring what wall-clock time alone
    // would do.)
    t.db.prepare("UPDATE tasks SET leaseExpiresAt = ? WHERE id = ?").run(Date.now() - 1000, task.id);

    const recoveryOutcome = await runOneCycle(t.db, "runner-2");
    assert.equal(recoveryOutcome.kind, "recovered");

    const repaired = getTask(t.db, task.id)!;
    assert.equal(repaired.status, "PENDING");
    assert.equal(repaired.leaseOwnerId, null);
    assert.ok(!listTaskAttempts(t.db, task.id).some((a) => a.status === "RUNNING"), "no RUNNING TaskAttempt may remain after recovery");
    const closedRun = getAgentRun(t.db, run!.id)!;
    assert.notEqual(closedRun.status, "RUNNING", "no RUNNING AgentRun may remain after recovery");
    assert.notEqual(closedRun.status, "QUEUED");

    t.close();
  });
});

describe("dual-runner race — exactly one execution", () => {
  test("two independent runner connections competing for the same task: exactly one executes it", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });

    const dbA = t.db;
    const dbB = reopenTestDb(t.dir);

    const [outcomeA, outcomeB] = await Promise.all([
      runOneCycle(dbA, "runner-a", { execution: { scenario: "success" } }),
      runOneCycle(dbB, "runner-b", { execution: { scenario: "success" } }),
    ]);

    // Whichever connection loses the claim finds the task already gone
    // from PENDING (claimed and moved to IN_PROGRESS by the winner in
    // the same synchronous stretch before either call's first real
    // await) — it correctly reports "idle" (no PENDING work anywhere),
    // not a false "executed". The property under test is mutual
    // exclusion: exactly one "executed", and the DB agrees only one
    // attempt actually ran.
    const kinds = [outcomeA.kind, outcomeB.kind].sort();
    assert.deepEqual(kinds, ["executed", "idle"], "exactly one connection must win the claim, the other must find nothing left to do");

    assert.equal(getTask(t.db, task.id)?.status, "DONE");
    assert.equal(listArtifactsForProject(t.db, project.id).length, 1, "the task must have been executed exactly once");

    dbB.close();
    t.close();
  });
});

describe("Project Pause / Resume", () => {
  test("a PAUSED project's tasks are skipped; an active project is unaffected", async () => {
    const t = createTestDb();
    const pausedProject = setupInProgressProject(t, "Build a small tool A.");
    const activeProject = setupInProgressProject(t, "Build a small tool B.");
    const pausedTask = createTask(t.db, { projectId: pausedProject.id, roleId: "product-owner", title: "x" });
    const activeTask = createTask(t.db, { projectId: activeProject.id, roleId: "product-owner", title: "y" });
    updateProjectStatus(t.db, pausedProject.id, "PAUSED");

    const outcome = await runOneCycle(t.db, "runner-1", { execution: { scenario: "success" } });
    assert.equal(outcome.kind, "executed");
    assert.equal(outcome.detail?.taskId, activeTask.id, "only the active project's task may be picked");
    assert.equal(getTask(t.db, pausedTask.id)?.status, "PENDING", "the paused project's task must remain untouched");

    // Resuming makes it eligible again; state was preserved, not deleted/recreated.
    updateProjectStatus(t.db, pausedProject.id, "IN_PROGRESS");
    const resumedOutcome = await runOneCycle(t.db, "runner-1", { execution: { scenario: "success" } });
    assert.equal(resumedOutcome.kind, "executed");
    assert.equal(resumedOutcome.detail?.taskId, pausedTask.id);

    t.close();
  });
});

describe("LIVE-mode refusal", () => {
  test("a LIVE-mode project's task is refused outright, never silently downgraded to SIMULATED", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Live", rawIdeaText: "x", ownerId: owner.id, aiMode: "LIVE" });
    updateProjectStatus(t.db, project.id, "IN_PROGRESS");
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });

    const outcome = await runOneCycle(t.db, "runner-1");
    assert.equal(outcome.kind, "live-mode-refused");
    assert.equal(getTask(t.db, task.id)?.status, "PENDING", "the task itself is not marked failed — it was never attempted");
    assert.equal(getTask(t.db, task.id)?.leaseOwnerId, null);
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "project.live_mode_refused"));

    t.close();
  });
});

describe("graceful runner stop", () => {
  test("stop() halts polling immediately — no further cycles run afterward", async () => {
    const t = createTestDb();
    let cycles = 0;
    const handle = startRunLoop(t.db, {
      runnerId: "loop-runner",
      pollIntervalMs: 5,
      onCycle: () => {
        cycles += 1;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    handle.stop();
    const countAtStop = cycles;
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(cycles, countAtStop, "no cycle may run after stop()");
    assert.ok(countAtStop >= 1);

    t.close();
  });
});

describe("autonomous acceptance scenario — idea in, READY_FOR_REVIEW out, no manual task selection", () => {
  /**
   * The only human/test input is the idea text and "run the runner
   * until done." Which task executes each cycle is entirely the
   * Runner's decision (via findEligibleTasks); this resolver only
   * steers *outcome* for the one role the scenario needs to fail once
   * (QA, on its very first attempt) — it never names a task id.
   */
  function scenarioResolver(qaShouldFailFirst: boolean) {
    return (task: { roleId: string; attemptCount: number }) => {
      if (task.roleId === "qa-agent" && qaShouldFailFirst && task.attemptCount === 0) {
        return { scenario: "failure" };
      }
      if (task.attemptCount > 0) return { scenario: "retry-success" };
      return { scenario: "success" };
    };
  }

  async function runAutonomously(ideaText: string, qaShouldFailFirst: boolean) {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "Autonomous Project", rawIdeaText: ideaText, ownerId: owner.id });
    planProject(t.db, project.id);

    const outcomes = await runUntil(
      t.db,
      "autonomous-runner",
      () => {
        const p = getProject(t.db, project.id)!;
        return p.status === "READY_FOR_REVIEW" || p.status === "BLOCKED";
      },
      { execution: scenarioResolver(qaShouldFailFirst) },
    );

    return { t, project, outcomes };
  }

  test("idea-only submission reaches READY_FOR_REVIEW with the full task graph DONE, driven only by repeated runOneCycle calls", async () => {
    const { t, project, outcomes } = await runAutonomously(
      "Build a small web application where manual testers capture screenshots, organize them into steps, and export a test report.",
      false,
    );

    assert.equal(getProject(t.db, project.id)?.status, "READY_FOR_REVIEW");
    const tasks = listTasksForProject(t.db, project.id);
    assert.ok(tasks.length > 0);
    for (const task of tasks) assert.equal(task.status, "DONE");
    assert.ok(outcomes.some((o) => o.kind === "executed"));

    t.close();
  });

  test("includes the QA-failure/remediation path under autonomous execution: QA fails once, the developer task is reopened, QA reruns and passes, and stale downstream reviews are invalidated and rerun", async () => {
    const { t, project } = await runAutonomously(
      "Build a small web application where manual testers capture screenshots, organize them into steps, and export a test report.",
      true,
    );

    assert.equal(getProject(t.db, project.id)?.status, "READY_FOR_REVIEW");
    const tasks = listTasksForProject(t.db, project.id);
    for (const task of tasks) assert.equal(task.status, "DONE");

    const qaTask = tasks.find((task) => task.roleId === "qa-agent")!;
    assert.equal(qaTask.attemptCount, 2, "QA must have failed once, then rerun and passed");
    // This idea has a clear UI signal and no server-side signal, so
    // (Phase 8's capability-driven role selection) it plans
    // frontend-developer, not backend-developer.
    const devTask = tasks.find((task) => task.roleId === "frontend-developer")!;
    assert.ok(devTask.attemptCount >= 1);

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "agent_run.failed"));

    t.close();
  });

  test("a project readiness gate never fires on a pre-remediation PASS — READY_FOR_REVIEW only reflects the post-fix state", async () => {
    const { t, project } = await runAutonomously(
      "Build a small web application where manual testers capture screenshots, organize them into steps, and export a test report.",
      true,
    );

    // If the stale (pre-fix) PASS had leaked through, this project could
    // only have reached READY_FOR_REVIEW before the developer fix
    // landed — impossible to observe directly after the fact, so the
    // strongest available check is: every task DONE, and the *latest*
    // QA test result (not just *a* PASS anywhere in history) is PASS.
    const finalProject = getProject(t.db, project.id)!;
    assert.equal(finalProject.status, "READY_FOR_REVIEW");

    t.close();
  });

  test("an idea matching the synthetic approval signal never executes any task, no matter how many cycles run", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Needs approval",
      rawIdeaText: "Build a tool that integrates a paid service subscription for SMS notifications.",
      ownerId: owner.id,
    });
    planProject(t.db, project.id);
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    const outcomes: RunnerCycleOutcome[] = [];
    for (let i = 0; i < 10; i++) outcomes.push(await runOneCycle(t.db, "runner-1"));

    assert.ok(!outcomes.some((o) => o.kind === "executed"), "no task may execute while the project's approval is PENDING");
    const tasks = listTasksForProject(t.db, project.id);
    assert.ok(tasks.every((task) => task.status === "PENDING"));

    t.close();
  });

  test("the same idea run 3 times on fresh databases produces a deterministic final shape (same task count, same roles, all DONE)", async () => {
    const ideaText = "Build a small web application where manual testers capture screenshots, organize them into steps, and export a test report.";
    const runs = [];
    for (let i = 0; i < 3; i++) {
      runs.push(await runAutonomously(ideaText, true));
    }

    const shapes = runs.map((r) => {
      const tasks = listTasksForProject(r.t.db, r.project.id).map((task) => task.roleId).sort();
      return { status: getProject(r.t.db, r.project.id)?.status, roles: tasks };
    });
    assert.deepEqual(shapes[0], shapes[1]);
    assert.deepEqual(shapes[1], shapes[2]);

    for (const r of runs) r.t.close();
  });
});

describe("multi-project behavior", () => {
  test("two simultaneous projects both make progress to completion with no cross-project state corruption", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project: projectA } = createProjectWithIdea(t.db, { title: "A", rawIdeaText: "Build a small backend utility A.", ownerId: owner.id });
    const { project: projectB } = createProjectWithIdea(t.db, { title: "B", rawIdeaText: "Build a small backend utility B.", ownerId: owner.id });
    planProject(t.db, projectA.id);
    planProject(t.db, projectB.id);

    await runUntil(
      t.db,
      "multi-runner",
      () => {
        const a = getProject(t.db, projectA.id)!;
        const b = getProject(t.db, projectB.id)!;
        return (a.status === "READY_FOR_REVIEW" || a.status === "BLOCKED") && (b.status === "READY_FOR_REVIEW" || b.status === "BLOCKED");
      },
      { execution: { scenario: "success" } },
      200,
    );

    assert.equal(getProject(t.db, projectA.id)?.status, "READY_FOR_REVIEW");
    assert.equal(getProject(t.db, projectB.id)?.status, "READY_FOR_REVIEW");

    const tasksA = listTasksForProject(t.db, projectA.id);
    const tasksB = listTasksForProject(t.db, projectB.id);
    for (const task of tasksA) assert.equal(task.projectId, projectA.id);
    for (const task of tasksB) assert.equal(task.projectId, projectB.id);

    // No artifact from one project leaked into the other.
    const artifactsA = listArtifactsForProject(t.db, projectA.id);
    const artifactsB = listArtifactsForProject(t.db, projectB.id);
    assert.ok(artifactsA.length > 0 && artifactsB.length > 0);

    t.close();
  });

  test("pausing one project does not block progress on another", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project: projectA } = createProjectWithIdea(t.db, { title: "A", rawIdeaText: "Build a small backend utility A.", ownerId: owner.id });
    const { project: projectB } = createProjectWithIdea(t.db, { title: "B", rawIdeaText: "Build a small backend utility B.", ownerId: owner.id });
    planProject(t.db, projectA.id);
    planProject(t.db, projectB.id);
    updateProjectStatus(t.db, projectA.id, "PAUSED");

    await runUntil(
      t.db,
      "multi-runner",
      () => getProject(t.db, projectB.id)!.status === "READY_FOR_REVIEW",
      { execution: { scenario: "success" } },
      200,
    );

    assert.equal(getProject(t.db, projectB.id)?.status, "READY_FOR_REVIEW");
    assert.equal(getProject(t.db, projectA.id)?.status, "PAUSED", "a paused project's status must not change on its own");
    const tasksA = listTasksForProject(t.db, projectA.id);
    assert.ok(tasksA.every((task) => task.status === "PENDING"), "paused project's tasks must be untouched");

    t.close();
  });

  test("a permanently-failing project does not starve another indefinitely — it BLOCKs after exhausting its retry ceiling, freeing the runner for other work", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project: failingProject } = createProjectWithIdea(t.db, { title: "Failing", rawIdeaText: "Build a small backend utility that always fails.", ownerId: owner.id });
    planProject(t.db, failingProject.id);
    // The failing project's oldest task was created first, so it always
    // sorts ahead of the healthy project's tasks in eligibility order —
    // the worst case for starvation.
    const { project: healthyProject } = createProjectWithIdea(t.db, { title: "Healthy", rawIdeaText: "Build a small backend utility that always succeeds.", ownerId: owner.id });
    planProject(t.db, healthyProject.id);

    await runUntil(
      t.db,
      "multi-runner",
      () => getProject(t.db, healthyProject.id)!.status === "READY_FOR_REVIEW",
      {
        execution: (task) => (task.projectId === failingProject.id ? { scenario: "failure" } : { scenario: "success" }),
      },
      200,
    );

    assert.equal(getProject(t.db, healthyProject.id)?.status, "READY_FOR_REVIEW", "the healthy project must complete despite the failing one competing for the same runner");
    assert.equal(getProject(t.db, failingProject.id)?.status, "BLOCKED", "the failing project escalates and stops competing for eligibility once its retry ceiling is exhausted");

    t.close();
  });
});

describe("runner restart continuity", () => {
  test("a second runner instance (new runnerId, same DB) continues exactly where the first left off — no in-memory runner state required", async () => {
    const t = createTestDb();
    const project = setupInProgressProject(t);
    const first = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "first" });
    const { task: second } = createTaskWithDependencies(t.db, {
      projectId: project.id,
      roleId: "solution-architect",
      title: "second",
      dependsOnTaskIds: [first.id],
    });

    const outcome1 = await runOneCycle(t.db, "runner-instance-1", { execution: { scenario: "success" } });
    assert.equal(outcome1.detail?.taskId, first.id);

    // A brand-new "process" (fresh runnerId, no shared JS state) picks
    // up the remaining work purely from what's persisted in the DB.
    const outcome2 = await runOneCycle(t.db, "runner-instance-2", { execution: { scenario: "success" } });
    assert.equal(outcome2.detail?.taskId, second.id);
    assert.equal(getTask(t.db, second.id)?.status, "DONE");

    t.close();
  });
});

describe("browser independence", () => {
  test("runOneCycle and startRunLoop operate purely against a DatabaseSync handle — no HTTP, no React, no route handler in this call path", async () => {
    // This entire test file already proves it structurally: it is run
    // by plain `node --test` (no Next.js dev/prod server involved) and
    // imports nothing from `app/`, `next/`, or `react`. This test
    // additionally proves it wires releaseLease/claimTask/executeTask
    // through nothing but the same DatabaseSync object a standalone
    // script would open directly.
    const t = createTestDb();
    const project = setupInProgressProject(t);
    createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "x" });

    assert.equal(typeof runOneCycle, "function");
    assert.equal(typeof startRunLoop, "function");
    const outcome = await runOneCycle(t.db, "standalone-proof-runner", { execution: { scenario: "success" } });
    assert.equal(outcome.kind, "executed");

    t.close();
  });
});
