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
  listTaskDependencies,
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
import { SimulatedAdapter } from "../providers/simulated/simulated-adapter.ts";
import type { AIProviderAdapter } from "../providers/types.ts";

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

export interface ExecuteTaskOptions {
  /** Explicit, deterministic scenario selector — "success" (default), "failure", "retry-success". Never random. */
  scenario?: string;
  /** Defaults to SimulatedAdapter. Only ever SimulatedAdapter exists in Phase 4 — this parameter exists for test injection, not for selecting a live provider. */
  provider?: AIProviderAdapter;
}

/**
 * Review-type roles test/audit someone else's artifact rather than
 * producing their own — on failure, the task that gets reopened is the
 * dependency that produced the artifact under review, never the
 * reviewing task itself. See
 * docs/ai-office/05-orchestration-workflow.md §4 ("QA failure re-opens
 * the developer task... not the QA task itself") — generalized here to
 * every review-type role for consistency.
 */
const REVIEW_ROLES = new Set(["qa-agent", "security-reviewer", "code-reviewer"]);

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
  const context = buildTaskContext(db, task, role, { scenario: options.scenario });
  const adapter = options.provider ?? new SimulatedAdapter();

  let agentRun = createAgentRunForAttempt(db, { taskAttemptId: attempt.id, roleId: role.id, provider: adapter.name });
  agentRun = updateAgentRunStatus(db, agentRun.id, "RUNNING");

  const result = await adapter.runAgentTask({
    role: role.id,
    task: context,
    instructions: `Execute ${role.name} task: ${task.title}`,
  });

  recordAiUsage(db, {
    agentRunId: agentRun.id,
    projectId: project.id,
    provider: adapter.name,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
  });

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
  const finishedRun = updateAgentRunStatus(db, agentRun.id, "SUCCEEDED", Date.now());
  const updatedTask = updateTaskStatus(db, task.id, "DONE");

  // A success closes out whatever earlier failure(s) sent this task back
  // for a retry — e.g. the developer task's unresolved failure from a
  // prior QA rejection is resolved once the developer's fix succeeds.
  for (const failure of listUnresolvedFailures(db, project.id)) {
    if (failure.taskId === task.id) resolveFailure(db, failure.id);
  }

  // Advance project status first so the memory summary reflects the
  // final state of this run (e.g. READY_FOR_REVIEW), not the
  // momentarily-stale status from before this task's completion.
  advanceProjectStatus(db, project.id);
  refreshProjectMemory(db, project.id);

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

  // A review-type role (QA, Security, Code Review) can still produce a
  // test result even while "failing" its own task — QA's failure fixture
  // is exactly this: the run succeeded at testing, the tests it ran did
  // not pass. Persisted regardless of outcome so the evidence exists.
  for (const testResult of output.testResults) {
    recordTestResult(db, {
      projectId: project.id,
      taskId: task.id,
      status: testResult.status,
      summary: testResult.summary,
      details: testResult.details,
    });
  }

  const failureReason = output.failure?.reason ?? "Unspecified failure.";
  updateTaskAttemptStatus(db, attempt.id, "FAILED");

  const retryTargetTaskIds = REVIEW_ROLES.has(role.id)
    ? listTaskDependencies(db, task.id).map((d) => d.dependsOnTaskId)
    : [task.id];
  const failureTaskId = retryTargetTaskIds[0] ?? task.id;

  recordFailure(db, { projectId: project.id, taskId: failureTaskId, agentRunId: agentRun.id, reason: failureReason });
  recordEvent(db, {
    projectId: project.id,
    type: "agent_run.failed",
    payload: { taskId: task.id, roleId: role.id, attemptNumber: attempt.attemptNumber, reason: failureReason },
    actor: role.id,
  });

  // Per docs/ai-office/04-agent-architecture.md §3's lifecycle diagram:
  // "FAILED --> QUEUED: retries remain (attempt++ ≤ maxRetries)" /
  // "FAILED --> ESCALATED: retries exhausted". attempt.attemptNumber is
  // already the post-increment count for this attempt.
  const ceilingExceeded = attempt.attemptNumber > role.maxRetries;

  if (!ceilingExceeded) {
    const finishedRun = updateAgentRunStatus(db, agentRun.id, "FAILED", Date.now());
    const updatedTask = updateTaskStatus(db, task.id, "PENDING");
    for (const targetId of retryTargetTaskIds) {
      if (targetId !== task.id) updateTaskStatus(db, targetId, "PENDING");
    }
    refreshProjectMemory(db, project.id);
    return {
      outcome: "retried",
      task: updatedTask,
      taskAttempt: { ...attempt, status: "FAILED" },
      agentRun: finishedRun,
      reason: failureReason,
    };
  }

  const finishedRun = updateAgentRunStatus(db, agentRun.id, "ESCALATED", Date.now());
  const updatedTask = updateTaskStatus(db, task.id, "BLOCKED");
  updateProjectStatus(db, project.id, "BLOCKED");
  recordEvent(db, {
    projectId: project.id,
    type: "task.escalated",
    payload: { taskId: task.id, roleId: role.id, escalatesTo: role.escalatesTo, attemptCount: attempt.attemptNumber },
    actor: role.id,
  });
  refreshProjectMemory(db, project.id);

  return {
    outcome: "escalated",
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

  const latestTest = db
    .prepare("SELECT status FROM test_results WHERE projectId = ? ORDER BY createdAt DESC LIMIT 1")
    .get(projectId) as unknown as { status: string } | undefined;
  const qaPassed = latestTest?.status === "PASS";

  if (qaPassed) {
    updateProjectStatus(db, projectId, "READY_FOR_REVIEW");
  }
}
