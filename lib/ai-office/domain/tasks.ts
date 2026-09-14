import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * tasks + task_dependencies + task_attempts + agent_runs repositories —
 * grouped in one file because they form a single tightly-coupled
 * execution chain (a task has attempts, an attempt has at most one
 * agent run). Persistence primitives only: no dispatch loop, no
 * eligibility-selection policy, no retry/escalation *decisions* — those
 * belong to the Orchestrator (Phase 5) and AgentRunner (Phase 4/5). This
 * file only stores and atomically claims state.
 */

export type TaskStatus = "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "FAILED" | "BLOCKED";
export type TaskAttemptStatus = "RUNNING" | "SUCCEEDED" | "FAILED";
export type AgentRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ESCALATED";

export interface TaskRow {
  id: string;
  projectId: string;
  roleId: string;
  title: string;
  status: TaskStatus;
  attemptCount: number;
  leaseOwnerId: string | null;
  leaseExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Set by `retryEscalatedTask` (lib/ai-office/control/task-transitions.ts)
   * to `attemptCount` at the moment of retry — never by anything else.
   * `attemptCount` itself is never reset (it drives the next
   * `task_attempts.attemptNumber`, which is UNIQUE per task and must
   * never collide with already-existing history), so a retry's "fresh
   * ceiling window" instead comes from comparing an attempt's number
   * against this baseline — see agent-runner.ts's `ceilingExceeded`
   * check.
   */
  retryBaselineAttemptCount: number | null;
}

export interface TaskDependencyRow {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  createdAt: number;
}

export interface TaskAttemptRow {
  id: string;
  taskId: string;
  attemptNumber: number;
  status: TaskAttemptStatus;
  agentRunId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRunRow {
  id: string;
  taskAttemptId: string;
  roleId: string;
  provider: string;
  /** The actual model that produced this run (e.g. "gemma4:latest") — null for SimulatedAdapter runs and any row from before migration 005. */
  model: string | null;
  status: AgentRunStatus;
  startedAt: number;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// ---- tasks ----------------------------------------------------------

export function createTask(db: DatabaseSync, input: { projectId: string; roleId: string; title: string }): TaskRow {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tasks (id, projectId, roleId, title, status, attemptCount, leaseOwnerId, leaseExpiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, NULL, ?, ?)`,
  ).run(id, input.projectId, input.roleId, input.title, now, now);
  return getTask(db, id) as unknown as TaskRow;
}

/** Creates a task and its dependency edges atomically — per the brief's "task + dependency creation" transaction example. */
export function createTaskWithDependencies(
  db: DatabaseSync,
  input: { projectId: string; roleId: string; title: string; dependsOnTaskIds?: string[] },
): { task: TaskRow; dependencies: TaskDependencyRow[] } {
  const now = Date.now();
  const taskId = randomUUID();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO tasks (id, projectId, roleId, title, status, attemptCount, leaseOwnerId, leaseExpiresAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, NULL, ?, ?)`,
    ).run(taskId, input.projectId, input.roleId, input.title, now, now);

    for (const dependsOnTaskId of input.dependsOnTaskIds ?? []) {
      db.prepare(
        `INSERT INTO task_dependencies (id, taskId, dependsOnTaskId, createdAt) VALUES (?, ?, ?, ?)`,
      ).run(randomUUID(), taskId, dependsOnTaskId, now);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { task: getTask(db, taskId) as unknown as TaskRow, dependencies: listTaskDependencies(db, taskId) };
}

/**
 * Low-level, non-transactional primitives — no BEGIN/COMMIT of their
 * own, unlike every other write function in this file. SQLite doesn't
 * support nested transactions, so a caller that needs to insert many
 * tasks/edges as *one* atomic plan (the Orchestrator's `planProject()`,
 * see lib/ai-office/orchestrator/orchestrator.ts) wraps its own
 * `BEGIN`/`COMMIT` around calls to these instead of the transactional
 * `createTask`/`createTaskWithDependencies` above. Both take a
 * caller-supplied `id` so a whole plan's task IDs can be computed and
 * validated (see lib/ai-office/orchestrator/graph.ts) before any row is
 * written.
 */
export function insertTaskRow(db: DatabaseSync, input: { id: string; projectId: string; roleId: string; title: string }): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO tasks (id, projectId, roleId, title, status, attemptCount, leaseOwnerId, leaseExpiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, NULL, ?, ?)`,
  ).run(input.id, input.projectId, input.roleId, input.title, now, now);
}

export function insertTaskDependencyRow(db: DatabaseSync, input: { id: string; taskId: string; dependsOnTaskId: string }): void {
  db.prepare("INSERT INTO task_dependencies (id, taskId, dependsOnTaskId, createdAt) VALUES (?, ?, ?, ?)").run(
    input.id,
    input.taskId,
    input.dependsOnTaskId,
    Date.now(),
  );
}

export function getTask(db: DatabaseSync, id: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as TaskRow | undefined;
}

export function listTasksForProject(db: DatabaseSync, projectId: string): TaskRow[] {
  return db.prepare("SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt").all(projectId) as unknown as TaskRow[];
}

export function updateTaskStatus(db: DatabaseSync, id: string, status: TaskStatus): TaskRow {
  db.prepare("UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?").run(status, Date.now(), id);
  return getTask(db, id) as unknown as TaskRow;
}

export function addTaskDependency(db: DatabaseSync, taskId: string, dependsOnTaskId: string): TaskDependencyRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO task_dependencies (id, taskId, dependsOnTaskId, createdAt) VALUES (?, ?, ?, ?)").run(
    id,
    taskId,
    dependsOnTaskId,
    now,
  );
  return db.prepare("SELECT * FROM task_dependencies WHERE id = ?").get(id) as unknown as TaskDependencyRow;
}

export function listTaskDependencies(db: DatabaseSync, taskId: string): TaskDependencyRow[] {
  return db.prepare("SELECT * FROM task_dependencies WHERE taskId = ?").all(taskId) as unknown as TaskDependencyRow[];
}

// ---- execution leases (Durable Runner persistence primitives only —
// no dispatch loop; see docs/ai-office/03-system-architecture.md §9) ---

/**
 * Atomic compare-and-swap claim, per
 * docs/ai-office/03-system-architecture.md §9.3's exact statement shape.
 * Returns true if this call won the claim, false if the task wasn't
 * eligible (already claimed with an unexpired lease, or not PENDING).
 * Deciding *which* task id to attempt is the caller's job (Phase 5's
 * Durable Runner) — this function only ever acts on the one task id
 * it's given.
 */
export function claimTask(
  db: DatabaseSync,
  input: { taskId: string; leaseOwnerId: string; leaseDurationMs: number },
): boolean {
  const now = Date.now();
  const result = db
    .prepare(
      `UPDATE tasks
       SET leaseOwnerId = ?, leaseExpiresAt = ?, updatedAt = ?
       WHERE id = ?
         AND status = 'PENDING'
         AND (leaseExpiresAt IS NULL OR leaseExpiresAt < ?)`,
    )
    .run(input.leaseOwnerId, now + input.leaseDurationMs, now, input.taskId, now);
  return result.changes > 0;
}

/** Clears a task's lease fields — after a run finishes, or as part of the crash-recovery sweep reclaiming a stale lease. Never touches `status` or `attemptCount`. */
export function releaseLease(db: DatabaseSync, taskId: string): TaskRow {
  db.prepare("UPDATE tasks SET leaseOwnerId = NULL, leaseExpiresAt = NULL, updatedAt = ? WHERE id = ?").run(
    Date.now(),
    taskId,
  );
  return getTask(db, taskId) as unknown as TaskRow;
}

/** Read-only candidate list for the crash-recovery sweep (docs/ai-office/03-system-architecture.md §9.6) — tasks holding an already-expired lease. Selection/recovery policy is the Durable Runner's job (Phase 5); this just finds candidates. */
export function findStaleLeasedTasks(db: DatabaseSync, asOf: number = Date.now()): TaskRow[] {
  return db
    .prepare("SELECT * FROM tasks WHERE leaseExpiresAt IS NOT NULL AND leaseExpiresAt < ?")
    .all(asOf) as unknown as TaskRow[];
}

/**
 * Every task currently leased to a specific runner, regardless of
 * whether that lease has technically expired yet — used by the
 * supervisor's dead-runner recovery (platform-hardening phase, runner
 * reliability follow-up) to reclaim work the instant a runner is
 * confirmed dead (via heartbeat + OS process check), rather than
 * waiting up to `DEFAULT_LEASE_DURATION_MS` (5 minutes) for the lease to
 * expire naturally — a genuinely dead runner never has a "graceful"
 * remaining lease window worth honoring.
 */
export function listTasksByLeaseOwner(db: DatabaseSync, leaseOwnerId: string): TaskRow[] {
  return db.prepare("SELECT * FROM tasks WHERE leaseOwnerId = ?").all(leaseOwnerId) as unknown as TaskRow[];
}

// ---- task_attempts + agent_runs --------------------------------------

/** Creates the next task_attempt for a task and bumps tasks.attemptCount together, atomically — per the brief's "task-attempt creation" transaction example. */
export function createTaskAttempt(db: DatabaseSync, taskId: string): TaskAttemptRow {
  const now = Date.now();
  const attemptId = randomUUID();

  db.exec("BEGIN");
  try {
    const task = db.prepare("SELECT attemptCount FROM tasks WHERE id = ?").get(taskId) as
      | { attemptCount: number }
      | undefined;
    if (!task) throw new Error(`Cannot create a task attempt: task ${taskId} does not exist.`);

    const attemptNumber = task.attemptCount + 1;

    db.prepare(
      `INSERT INTO task_attempts (id, taskId, attemptNumber, status, agentRunId, createdAt, updatedAt)
       VALUES (?, ?, ?, 'RUNNING', NULL, ?, ?)`,
    ).run(attemptId, taskId, attemptNumber, now, now);

    db.prepare("UPDATE tasks SET attemptCount = ?, updatedAt = ? WHERE id = ?").run(attemptNumber, now, taskId);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getTaskAttempt(db, attemptId) as unknown as TaskAttemptRow;
}

export function getTaskAttempt(db: DatabaseSync, id: string): TaskAttemptRow | undefined {
  return db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(id) as unknown as TaskAttemptRow | undefined;
}

export function listTaskAttempts(db: DatabaseSync, taskId: string): TaskAttemptRow[] {
  return db
    .prepare("SELECT * FROM task_attempts WHERE taskId = ? ORDER BY attemptNumber")
    .all(taskId) as unknown as TaskAttemptRow[];
}

export function updateTaskAttemptStatus(db: DatabaseSync, id: string, status: TaskAttemptStatus): TaskAttemptRow {
  db.prepare("UPDATE task_attempts SET status = ?, updatedAt = ? WHERE id = ?").run(status, Date.now(), id);
  return getTaskAttempt(db, id) as unknown as TaskAttemptRow;
}

/**
 * Creates an agent_runs row for an existing task_attempt, then links the
 * attempt back to it — handles the deliberate circular reference between
 * the two tables (see the schema comment in
 * lib/ai-office/db/migrations/001-init.sql) atomically, in insertion
 * order: the attempt must already exist before an agent_runs row can
 * reference it.
 */
export function createAgentRunForAttempt(
  db: DatabaseSync,
  input: { taskAttemptId: string; roleId: string; provider: string; model?: string | null },
): AgentRunRow {
  const now = Date.now();
  const runId = randomUUID();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO agent_runs (id, taskAttemptId, roleId, provider, model, status, startedAt, finishedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, NULL, ?, ?)`,
    ).run(runId, input.taskAttemptId, input.roleId, input.provider, input.model ?? null, now, now, now);

    db.prepare("UPDATE task_attempts SET agentRunId = ?, updatedAt = ? WHERE id = ?").run(
      runId,
      now,
      input.taskAttemptId,
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getAgentRun(db, runId) as unknown as AgentRunRow;
}

export function getAgentRun(db: DatabaseSync, id: string): AgentRunRow | undefined {
  return db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as unknown as AgentRunRow | undefined;
}

/**
 * Walks the forward chain `agent_runs.taskAttemptId -> task_attempts.taskId
 * -> tasks.projectId` in one query — the authoritative way to answer
 * "which project does this AgentRun actually belong to," used by
 * `lib/ai-office/budget/budget-service.ts`'s reconciliation to verify a
 * caller-supplied `agentRunId` genuinely belongs to the project a budget
 * reservation was authorized for, rather than trusting a caller-supplied
 * projectId directly. Every column in this chain is `NOT NULL` with FK
 * enforcement on, so a `undefined` result means only one thing: no
 * `agent_runs` row exists with this id at all — there is no way for the
 * chain itself to be "broken" for a row that does exist.
 */
export function resolveProjectIdForAgentRun(db: DatabaseSync, agentRunId: string): string | undefined {
  const row = db
    .prepare(
      `SELECT t.projectId as projectId
       FROM agent_runs ar
       JOIN task_attempts ta ON ta.id = ar.taskAttemptId
       JOIN tasks t ON t.id = ta.taskId
       WHERE ar.id = ?`,
    )
    .get(agentRunId) as { projectId: string } | undefined;
  return row?.projectId;
}

/**
 * Revoke-approval safety check (Section 2) — true if *any* task in this
 * project has ever had a real `agent_runs` row for the given provider,
 * regardless of that run's outcome (SUCCEEDED/FAILED/etc. all mean a
 * real paid attempt genuinely started). Walks the same forward chain as
 * `resolveProjectIdForAgentRun`, in the opposite direction.
 */
export function hasAgentRunWithProviderForProject(db: DatabaseSync, projectId: string, provider: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c
       FROM agent_runs ar
       JOIN task_attempts ta ON ta.id = ar.taskAttemptId
       JOIN tasks t ON t.id = ta.taskId
       WHERE t.projectId = ? AND ar.provider = ?`,
    )
    .get(projectId, provider) as { c: number };
  return row.c > 0;
}

/** Same check, scoped to one task — used when the approval being revoked is task-scoped rather than project-wide. */
export function hasAgentRunWithProviderForTask(db: DatabaseSync, taskId: string, provider: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c
       FROM agent_runs ar
       JOIN task_attempts ta ON ta.id = ar.taskAttemptId
       WHERE ta.taskId = ? AND ar.provider = ?`,
    )
    .get(taskId, provider) as { c: number };
  return row.c > 0;
}

export function updateAgentRunStatus(
  db: DatabaseSync,
  id: string,
  status: AgentRunStatus,
  finishedAt: number | null = null,
): AgentRunRow {
  db.prepare("UPDATE agent_runs SET status = ?, finishedAt = ?, updatedAt = ? WHERE id = ?").run(
    status,
    finishedAt,
    Date.now(),
    id,
  );
  return getAgentRun(db, id) as unknown as AgentRunRow;
}
