import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { TaskRow } from "../domain/tasks.ts";

/**
 * The one place task-execution eligibility is decided — per the Phase 5
 * brief's explicit "implement this in one clear location, do not
 * scatter it throughout the application." A PENDING task is executable
 * only when:
 * - the Office is OPEN (checked by the caller, `runOneCycle`, before
 *   this is ever called — kept separate since it's an office-wide gate,
 *   not a per-task one)
 * - its project is IN_PROGRESS (not PAUSED, BLOCKED, DRAFT, PLANNING,
 *   READY_FOR_REVIEW, APPROVED, FAILED, or ARCHIVED)
 * - its project is SIMULATED mode (LIVE-mode tasks are structurally
 *   *eligible* here — deliberately — so the Runner can claim one and
 *   have AgentRunner's existing budget gate refuse it with a proper
 *   event, per "do not silently fall back," rather than this function
 *   silently hiding them)
 * - its project has no unresolved (PENDING) approval blocking it
 * - it has no unexpired lease (someone else — or a not-yet-expired
 *   earlier claim — already has it)
 * - every task it depends on is DONE
 *
 * Deliberately does **not** check retry ceilings — that's enforced at
 * failure time by AgentRunner (docs/ai-office/04-agent-architecture.md
 * §3's lifecycle diagram), which is also where a task stops being
 * PENDING once its ceiling is exceeded (it becomes BLOCKED). By the
 * time a task is eligible here, its ceiling — if it has one to worry
 * about — has already been checked on its most recent failed attempt.
 */
export function findEligibleTasks(db: DatabaseSync, asOf: number = Date.now()): TaskRow[] {
  const candidates = db
    .prepare(
      `SELECT t.* FROM tasks t
       JOIN projects p ON p.id = t.projectId
       WHERE t.status = 'PENDING'
         AND p.status = 'IN_PROGRESS'
         AND (t.leaseExpiresAt IS NULL OR t.leaseExpiresAt < ?)
         AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.projectId = p.id AND a.status = 'PENDING')
       ORDER BY t.createdAt ASC`,
    )
    .all(asOf) as unknown as TaskRow[];

  if (candidates.length === 0) return [];

  // Dependency check done in JS, not SQL — the dependency graph is
  // small per project (single-digit task counts) and this keeps the
  // "all dependencies DONE" rule readable as actual code rather than a
  // correlated subquery.
  const doneCache = new Map<string, boolean>();
  function isDone(taskId: string): boolean {
    if (doneCache.has(taskId)) return doneCache.get(taskId)!;
    const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as unknown as { status: string } | undefined;
    const done = row?.status === "DONE";
    doneCache.set(taskId, done);
    return done;
  }

  return candidates.filter((task) => {
    const deps = db.prepare("SELECT dependsOnTaskId FROM task_dependencies WHERE taskId = ?").all(task.id) as unknown as Array<{
      dependsOnTaskId: string;
    }>;
    return deps.every((d) => isDone(d.dependsOnTaskId));
  });
}

export function hasAnyPendingTask(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'PENDING'").get() as unknown as {
    count: number;
  };
  return row.count > 0;
}
