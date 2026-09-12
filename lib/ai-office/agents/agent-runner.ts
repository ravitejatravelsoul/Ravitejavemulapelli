import "server-only";
import type { DatabaseSync } from "node:sqlite";
// Relative + extension-explicit imports throughout this file — required
// for plain `node --test` resolution (see lib/ai-office/db/client.ts's
// comment) and, not incidentally, what makes this the *only* module
// that imports a provider adapter (docs/ai-office/09-budget-and-cost-controls.md
// §2's single-entry-point rule, verified by
// lib/ai-office/agents/__tests__/import-boundary.test.ts).
import {
  getTask,
  updateTaskStatus,
  createTaskAttempt,
  updateTaskAttemptStatus,
  createAgentRunForAttempt,
  updateAgentRunStatus,
  listTasksForProject,
  type TaskRow,
  type TaskAttemptRow,
  type AgentRunRow,
} from "../domain/tasks.ts";
import { getProject, updateProjectStatus, type ProjectRow } from "../domain/projects.ts";
import { getAgentRole, type AgentRoleRow } from "../domain/agent-roles.ts";
import {
  createArtifact,
  recordDecision,
  recordTestResult,
  recordFailure,
  listUnresolvedFailures,
  resolveFailure,
} from "../domain/project-outputs.ts";
import { recordEvent } from "../domain/events.ts";
import { recordAiUsage } from "../domain/budget.ts";
import { refreshProjectMemory } from "../domain/project-memory.ts";
import { buildTaskContext } from "./context-builder.ts";
import { authorizeBudget } from "./budget-gate.ts";
import { isReviewRole, findRemediationTargets, findStaleDownstreamReviews } from "./remediation.ts";
import { SimulatedAdapter } from "../providers/simulated/simulated-adapter.ts";
import { OllamaAdapter } from "../providers/ollama/ollama-adapter.ts";
import type { AIProviderAdapter } from "../providers/types.ts";
import { applyFileOperations } from "../workspace/apply-file-operations.ts";

/**
 * AgentRunner — the central execution boundary between a claimed Task
 * and a provider adapter. Phase 4 scope only: `executeTask()` runs
 * exactly one already-PENDING task per call, driven directly by test
 * code (or, later, a test/dev harness) — no dispatch loop, no
 * eligibility-selection policy. See
 * docs/ai-office/04-agent-architecture.md §5 and the Phase 4 status
 * note in docs/ai-office/11-implementation-phases.md.
 */

export type ExecuteTaskOutcome = "not-eligible" | "budget-refused" | "succeeded" | "retried" | "escalated";

export interface ExecuteTaskResult {
  outcome: ExecuteTaskOutcome;
  task: TaskRow;
  taskAttempt?: TaskAttemptRow;
  agentRun?: AgentRunRow;
  reason?: string;
}

/** Per-attempt bound on the adapter call — docs/ai-office/03-system-architecture.md §9.6's "generous default of 5 minutes." SimulatedAdapter never approaches this; it exists so a hung/slow provider (a real one, Phase 7+, or a test double) can never stall the Runner forever. */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

class AdapterTimeoutError extends Error {}

/**
 * Bounds `adapter.runAgentTask()` with `Promise.race` against a timer —
 * the standard, correct way to bound async work in Node (a Promise
 * cannot be forcibly cancelled, only stopped-waiting-for; safe here
 * because neither SimulatedAdapter nor this codebase's own code has any
 * side effect tied to the loser of the race actually completing).
 */
function callAdapterWithTimeout(
  adapter: AIProviderAdapter,
  input: Parameters<AIProviderAdapter["runAgentTask"]>[0],
  timeoutMs: number,
): Promise<import("../providers/types.ts").AgentTaskResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AdapterTimeoutError(`Execution timed out after ${timeoutMs}ms.`)), timeoutMs);

    // A malformed/misbehaving adapter can throw *synchronously* —
    // before ever returning a Promise — rather than rejecting one.
    // `adapter.runAgentTask(input).then(...)` would never reach
    // `.then()` in that case, leaving `timer` uncleared for its full
    // duration (up to the real 5-minute default) even though the
    // Promise below still settles correctly via the executor's
    // implicit catch. Caught explicitly so a synchronous throw clears
    // the timer exactly like an asynchronous rejection does.
    let pending: Promise<import("../providers/types.ts").AgentTaskResult>;
    try {
      pending = adapter.runAgentTask(input);
    } catch (syncError) {
      clearTimeout(timer);
      reject(syncError);
      return;
    }

    pending.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface ExecuteTaskOptions {
  /** Explicit, deterministic scenario selector — "success" (default), "failure", "retry-success". Never random. */
  scenario?: string;
  /** Defaults to the project's own `provider` column (SimulatedAdapter or OllamaAdapter) — this parameter exists for test injection (including a deliberately slow/hanging test double, to prove timeout behavior), not for overriding a real project's configured provider. */
  provider?: AIProviderAdapter;
  /** Overrides DEFAULT_TASK_TIMEOUT_MS — tests use a short value so timeout tests run fast. */
  timeoutMs?: number;
}

export async function executeTask(
  db: DatabaseSync,
  taskId: string,
  options: ExecuteTaskOptions = {},
): Promise<ExecuteTaskResult> {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`Task ${taskId} does not exist.`);

  // Guards against ever re-running a terminal/claimed task — the
  // concrete "no infinite loop" boundary for this phase: there is no
  // automatic retry anywhere in this file, only what the caller
  // explicitly asks for, and only while the task is actually eligible.
  if (task.status !== "PENDING") {
    return { outcome: "not-eligible", task, reason: `Task status is ${task.status}; only PENDING tasks can be executed.` };
  }

  const role = getAgentRole(db, task.roleId);
  if (!role) throw new Error(`Agent role "${task.roleId}" does not exist.`);

  const project = getProject(db, task.projectId);
  if (!project) throw new Error(`Project ${task.projectId} does not exist.`);

  const budgetDecision = authorizeBudget({ aiMode: project.aiMode });
  if (!budgetDecision.authorized) {
    recordEvent(db, {
      projectId: project.id,
      type: "task.budget_refused",
      payload: { taskId: task.id, reason: budgetDecision.reason },
      actor: "system",
    });
    return { outcome: "budget-refused", task, reason: budgetDecision.reason };
  }

  updateTaskStatus(db, task.id, "IN_PROGRESS");
  const attempt = createTaskAttempt(db, task.id);
  const context = buildTaskContext(db, task, role, { scenario: options.scenario, attemptNumber: attempt.attemptNumber });
  const adapter = options.provider ?? (project.provider === "ollama" ? new OllamaAdapter() : new SimulatedAdapter());

  let agentRun = createAgentRunForAttempt(db, { taskAttemptId: attempt.id, roleId: role.id, provider: adapter.name });
  agentRun = updateAgentRunStatus(db, agentRun.id, "RUNNING");

  let result: import("../providers/types.ts").AgentTaskResult;
  try {
    result = await callAdapterWithTimeout(
      adapter,
      { role: role.id, task: context, instructions: `Execute ${role.name} task: ${task.title}` },
      options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
    );
  } catch (error) {
    // Every provider-side failure — a timeout, a thrown exception, a
    // rejected promise, a malformed adapter — is a normal, expected
    // *operational* failure, not a reason to let an exception escape
    // executeTask(). All three collapse to the same synthesized FAILED
    // result so they flow through the exact same retry/escalation path
    // as a fixture-driven failure, with no separate "timeout" or
    // "adapter threw" code path to keep in sync. This is the boundary
    // that matters: nothing past this point in executeTask() may throw
    // for a provider-caused reason — only a genuine internal/persistence
    // error (below) may still propagate, and the Runner treats that
    // differently (see runner.ts's crash-recovery note).
    const timedOut = error instanceof AdapterTimeoutError;
    const reason = error instanceof Error ? error.message : String(error);
    result = {
      status: "FAILED",
      output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason } },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      raw: { timedOut, threw: !timedOut },
    };
  }

  recordAiUsage(db, {
    agentRunId: agentRun.id,
    projectId: project.id,
    provider: adapter.name,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
  });

  // A reported success that also requested real file changes gets those
  // applied *before* finishSuccess ever commits anything. An invalid
  // batch (bad path, oversized write, etc.) is treated exactly like any
  // other provider-side failure — never a partial workspace write, never
  // an exception escaping this function, just a normal FAILED result
  // routed through the same retry/escalation path finishFailure already
  // handles for every other kind of failure.
  if (result.status === "SUCCEEDED" && result.output.fileOperations.length > 0) {
    try {
      await applyFileOperations(db, {
        projectId: project.id,
        taskId: task.id,
        roleId: role.id,
        operations: result.output.fileOperations,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result = {
        status: "FAILED",
        output: {
          summary: "",
          artifacts: [],
          decisions: [],
          testResults: [],
          events: [],
          fileOperations: [],
          recommendedNextActions: [],
          failure: { reason: `File operation rejected: ${reason}` },
        },
        usage: result.usage,
        raw: { fileOperationRejected: true },
      };
    }
  }

  if (result.status === "SUCCEEDED") {
    return finishSuccess(db, { project, role, task, attempt, agentRun, output: result.output });
  }
  return finishFailure(db, { project, role, task, attempt, agentRun, output: result.output });
}

function finishSuccess(
  db: DatabaseSync,
  ctx: {
    project: ProjectRow;
    role: AgentRoleRow;
    task: TaskRow;
    attempt: TaskAttemptRow;
    agentRun: AgentRunRow;
    output: import("../providers/types.ts").StructuredAgentOutput;
  },
): ExecuteTaskResult {
  const { project, role, task, attempt, agentRun, output } = ctx;

  // Everything below is one terminal transition — the artifacts/
  // decisions/test-results/events this run produced, together with the
  // attempt/run/task status all moving to their success state, and the
  // project-status/memory bookkeeping that depends on that final state.
  // Wrapped in a transaction so a crash partway through can never leave
  // a torn state (e.g. an artifact written but the task still
  // IN_PROGRESS, which the crash-recovery sweep would then re-execute —
  // producing a *duplicate* artifact for the same attempt). If this
  // throws, nothing here is persisted; the task is recovered by the
  // Runner's crash-recovery sweep exactly as if the process had died
  // before the adapter call ever returned.
  db.exec("BEGIN");
  let updatedTask: TaskRow;
  let finishedRun: AgentRunRow;
  try {
    for (const artifact of output.artifacts) {
      createArtifact(db, {
        projectId: project.id,
        taskId: task.id,
        type: artifact.artifactType as never,
        content: artifact.content,
        version: artifact.version,
      });
    }
    for (const decision of output.decisions) {
      recordDecision(db, {
        projectId: project.id,
        type: decision.type,
        summary: decision.summary,
        rationale: decision.rationale,
        madeBy: role.id,
      });
    }
    for (const testResult of output.testResults) {
      recordTestResult(db, {
        projectId: project.id,
        taskId: task.id,
        status: testResult.status,
        summary: testResult.summary,
        details: testResult.details,
      });
    }
    for (const event of output.events) {
      recordEvent(db, { projectId: project.id, type: event.type, payload: event.payload, actor: role.id });
    }
    recordEvent(db, {
      projectId: project.id,
      type: "agent_run.succeeded",
      payload: { taskId: task.id, roleId: role.id, attemptNumber: attempt.attemptNumber, summary: output.summary },
      actor: role.id,
    });

    updateTaskAttemptStatus(db, attempt.id, "SUCCEEDED");
    finishedRun = updateAgentRunStatus(db, agentRun.id, "SUCCEEDED", Date.now());
    updatedTask = updateTaskStatus(db, task.id, "DONE");

    // A success closes out whatever earlier failure(s) sent this task
    // back for a retry — e.g. the developer task's unresolved failure
    // from a prior QA rejection is resolved once the fix succeeds.
    for (const failure of listUnresolvedFailures(db, project.id)) {
      if (failure.taskId === task.id) resolveFailure(db, failure.id);
    }

    // Advance project status first so the memory summary reflects the
    // final state of this run (e.g. READY_FOR_REVIEW), not the
    // momentarily-stale status from before this task's completion.
    advanceProjectStatus(db, project.id);
    refreshProjectMemory(db, project.id);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    outcome: "succeeded",
    task: updatedTask,
    taskAttempt: { ...attempt, status: "SUCCEEDED" },
    agentRun: finishedRun,
  };
}

function finishFailure(
  db: DatabaseSync,
  ctx: {
    project: ProjectRow;
    role: AgentRoleRow;
    task: TaskRow;
    attempt: TaskAttemptRow;
    agentRun: AgentRunRow;
    output: import("../providers/types.ts").StructuredAgentOutput;
  },
): ExecuteTaskResult {
  const { project, role, task, attempt, agentRun, output } = ctx;
  const failureReason = output.failure?.reason ?? "Unspecified failure.";

  // Same atomicity reasoning as finishSuccess — one terminal transition,
  // one transaction. Retry-vs-escalate, remediation-target reopening,
  // and stale-downstream-review invalidation are all part of *this*
  // task's failure outcome and must land together or not at all.
  db.exec("BEGIN");
  let outcome: ExecuteTaskOutcome;
  let updatedTask: TaskRow;
  let finishedRun: AgentRunRow;
  try {
    // A review-type role (QA, Security, Code Review) can still produce a
    // test result even while "failing" its own task — QA's failure
    // fixture is exactly this: the run succeeded at testing, the tests
    // it ran did not pass. Persisted regardless of outcome so the
    // evidence exists.
    for (const testResult of output.testResults) {
      recordTestResult(db, {
        projectId: project.id,
        taskId: task.id,
        status: testResult.status,
        summary: testResult.summary,
        details: testResult.details,
      });
    }

    updateTaskAttemptStatus(db, attempt.id, "FAILED");

    // Remediation targets: for a review role (QA, Security, Code Review
    // — derived semantically from allowedInputs/allowedOutputs, see
    // remediation.ts, not a hardcoded role-id list or graph position),
    // walk the dependency ancestry back to the development task(s) that
    // actually need a code change — however many review hops away that
    // is, not just the direct dependency. Every other role retries
    // itself.
    const isReview = isReviewRole(role);
    const remediationTargets = isReview ? findRemediationTargets(db, task.id) : [task];

    for (const target of remediationTargets) {
      recordFailure(db, { projectId: project.id, taskId: target.id, agentRunId: agentRun.id, reason: failureReason });
    }
    recordEvent(db, {
      projectId: project.id,
      type: "agent_run.failed",
      payload: {
        taskId: task.id,
        roleId: role.id,
        attemptNumber: attempt.attemptNumber,
        reason: failureReason,
        remediationTargetTaskIds: remediationTargets.map((t) => t.id),
      },
      actor: role.id,
    });

    // Per docs/ai-office/04-agent-architecture.md §3's lifecycle
    // diagram: "FAILED --> QUEUED: retries remain (attempt++ ≤
    // maxRetries)" / "FAILED --> ESCALATED: retries exhausted".
    // attempt.attemptNumber is already the post-increment count for
    // this attempt.
    const ceilingExceeded = attempt.attemptNumber > role.maxRetries;

    if (!ceilingExceeded) {
      finishedRun = updateAgentRunStatus(db, agentRun.id, "FAILED", Date.now());
      updatedTask = updateTaskStatus(db, task.id, "PENDING");
      for (const target of remediationTargets) {
        if (target.id !== task.id) updateTaskStatus(db, target.id, "PENDING");
      }

      // Any already-DONE review task that transitively depends on a
      // reopened development task is now stale — the code it validated
      // is changing again — and must rerun too. Covers both a review
      // step strictly between the development task and the one that
      // just failed (QA, when Security fails) and an already-passed
      // sibling branch validating the same code (Security, when Code
      // Review fails after Security already passed).
      if (isReview) {
        const staleReviews = findStaleDownstreamReviews(
          db,
          project.id,
          remediationTargets.map((t) => t.id),
        ).filter((t) => t.id !== task.id);
        for (const stale of staleReviews) {
          updateTaskStatus(db, stale.id, "PENDING");
          recordEvent(db, {
            projectId: project.id,
            type: "task.invalidated_by_upstream_change",
            payload: { taskId: stale.id, causedByTaskId: task.id, causedByRoleId: role.id },
            actor: "system",
          });
        }
      }

      refreshProjectMemory(db, project.id);
      outcome = "retried";
    } else {
      finishedRun = updateAgentRunStatus(db, agentRun.id, "ESCALATED", Date.now());
      updatedTask = updateTaskStatus(db, task.id, "BLOCKED");
      updateProjectStatus(db, project.id, "BLOCKED");
      recordEvent(db, {
        projectId: project.id,
        type: "task.escalated",
        payload: { taskId: task.id, roleId: role.id, escalatesTo: role.escalatesTo, attemptCount: attempt.attemptNumber },
        actor: role.id,
      });
      refreshProjectMemory(db, project.id);
      outcome = "escalated";
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    outcome,
    task: updatedTask,
    taskAttempt: { ...attempt, status: "FAILED" },
    agentRun: finishedRun,
    reason: failureReason,
  };
}

/**
 * Deterministic bookkeeping, not Orchestrator intelligence: derives
 * project.status purely from already-persisted task/test-result state
 * against the five fixed quality gates in
 * docs/ai-office/05-orchestration-workflow.md §5. Never decides *what*
 * tasks exist or *which* roles are needed — that remains Phase 5's job.
 */
function advanceProjectStatus(db: DatabaseSync, projectId: string): void {
  const project = getProject(db, projectId);
  if (!project) return;
  if (["READY_FOR_REVIEW", "APPROVED", "BLOCKED", "FAILED", "ARCHIVED", "PAUSED"].includes(project.status)) return;

  const tasks = listTasksForProject(db, projectId);
  if (tasks.length === 0) return;

  const allDone = tasks.every((t) => t.status === "DONE");
  if (!allDone) {
    if (project.status === "DRAFT" || project.status === "PLANNING") {
      updateProjectStatus(db, projectId, "IN_PROGRESS");
    }
    return;
  }

  // Joined against tasks and scoped to task.status = 'DONE' deliberately
  // — a test_results row from a QA attempt that has since been
  // invalidated (Phase 4's remediation fix, docs/ai-office/11-implementation-phases.md's
  // Phase 4 status note) still exists in history, but its owning task is
  // back to PENDING, not DONE, at that point. Since `allDone` above
  // already requires literally every task in the plan to be DONE, this
  // join is redundant *given that check already passed* — kept anyway
  // as defense-in-depth so this query alone, read in isolation, can
  // never be satisfied by stale pre-remediation evidence.
  const latestTest = db
    .prepare(
      `SELECT tr.status FROM test_results tr
       JOIN tasks t ON t.id = tr.taskId
       WHERE tr.projectId = ? AND t.status = 'DONE'
       ORDER BY tr.createdAt DESC LIMIT 1`,
    )
    .get(projectId) as unknown as { status: string } | undefined;
  const qaPassed = latestTest?.status === "PASS";

  if (qaPassed) {
    updateProjectStatus(db, projectId, "READY_FOR_REVIEW");
  }
}
