import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getOfficeStatus } from "../domain/office.ts";
import { getProject, updateProjectStatus } from "../domain/projects.ts";
import { updateTaskStatus, releaseLease, claimTask, findStaleLeasedTasks, type TaskRow } from "../domain/tasks.ts";
import { recordEvent } from "../domain/events.ts";
import { executeTask, type ExecuteTaskResult, type ExecuteTaskOptions } from "../agents/agent-runner.ts";
import { findEligibleTasks, hasAnyPendingTask } from "./eligibility.ts";

/**
 * The Durable Local Execution Runner —
 * docs/ai-office/03-system-architecture.md §9. `runOneCycle()` is the
 * entire mechanism: read state -> at most one claim/execution unit ->
 * persist -> return. No hidden loop, no timers, no browser dependency —
 * a plain `async` function any caller (a test, the continuous loop
 * below, a future UI action, a standalone script) can invoke directly.
 */

export const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000; // matches AgentRunner's own default execution timeout
export const DEFAULT_POLL_INTERVAL_MS = 5000;

export type RunnerCycleKind =
  | "executed"
  | "idle"
  | "office-closed"
  | "no-eligible-work"
  | "live-mode-refused"
  | "recovered"
  | "error";

export interface RunnerCycleOutcome {
  kind: RunnerCycleKind;
  detail?: Record<string, unknown>;
}

/**
 * One claim/execution unit, and nothing more:
 * 1. Office must be OPEN, or stop immediately ("office-closed").
 * 2. Sweep for stale (crash-interrupted) leases first — cheap, bounded,
 *    and must happen before considering new work so a task doesn't sit
 *    permanently orphaned behind its own expired lease. If this cycle
 *    recovered anything, that *is* this cycle's unit of work
 *    ("recovered") — new execution waits for the next cycle.
 * 3. Find eligible tasks (lib/ai-office/runner/eligibility.ts) and
 *    attempt to atomically claim the oldest one. Losing the race to
 *    another runner instance is not an error — just nothing to do this
 *    cycle.
 * 4. A claimed LIVE-mode task is refused outright (never silently
 *    downgraded to SIMULATED) and its project is BLOCKED with a clear
 *    event — Phase 7's real provider work has nothing to change here,
 *    since AgentRunner's own budget gate already refuses LIVE mode at a
 *    lower layer too (belt-and-suspenders, not the only check).
 * 5. Otherwise, execute through AgentRunner and always release the
 *    lease afterward, regardless of outcome — a retried task must be
 *    immediately eligible again next cycle, not stuck waiting for its
 *    lease to expire naturally.
 *
 * Genuinely `async` (not a sync function wearing a Promise) — it
 * `await`s `executeTask` directly rather than assuming anything about
 * how the provider adapter settles internally. That assumption would
 * be fragile: true of `SimulatedAdapter` today only because it happens
 * not to use a real timer, and exactly the kind of thing that breaks
 * silently later.
 */
export interface RunOneCycleOptions {
  /** Overrides the lease duration a claim uses — production always uses DEFAULT_LEASE_DURATION_MS; tests use a short value to prove expiry/recovery quickly. */
  leaseDurationMs?: number;
  /**
   * Test-only injection point, forwarded to AgentRunner.executeTask —
   * lets a test prove the Runner itself never hangs on a slow/hanging
   * provider, without waiting out the real 5-minute default, and lets
   * an autonomous-run test steer a specific role's outcome (e.g. QA
   * failing on its first attempt) without ever calling `executeTask`
   * directly. Since the Runner — not the caller — decides which task
   * gets claimed this cycle, a resolver function receives the actual
   * claimed task so it can answer "what should happen for *this*
   * task," rather than the caller guessing in advance.
   */
  execution?: ExecuteTaskOptions | ((task: TaskRow) => ExecuteTaskOptions | undefined);
}

export async function runOneCycle(
  db: DatabaseSync,
  runnerId: string,
  options: RunOneCycleOptions = {},
): Promise<RunnerCycleOutcome> {
  try {
    const office = getOfficeStatus(db);
    if (!office || office.state !== "OPEN") {
      return { kind: "office-closed" };
    }

    const recovered = recoverStaleLeases(db);
    if (recovered.length > 0) {
      return { kind: "recovered", detail: { taskIds: recovered } };
    }

    const eligible = findEligibleTasks(db);
    if (eligible.length === 0) {
      return { kind: hasAnyPendingTask(db) ? "no-eligible-work" : "idle" };
    }

    const candidate = eligible[0];
    const claimed = claimTask(db, {
      taskId: candidate.id,
      leaseOwnerId: runnerId,
      leaseDurationMs: options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
    });
    if (!claimed) {
      // Another runner instance won the race this cycle.
      return { kind: "no-eligible-work" };
    }

    recordEvent(db, { projectId: candidate.projectId, type: "task.claimed", payload: { taskId: candidate.id, runnerId }, actor: "system" });

    const project = getProject(db, candidate.projectId);
    if (project && project.aiMode === "LIVE") {
      releaseLease(db, candidate.id);
      updateProjectStatus(db, project.id, "BLOCKED");
      recordEvent(db, {
        projectId: project.id,
        type: "project.live_mode_refused",
        payload: { taskId: candidate.id },
        actor: "system",
      });
      return { kind: "live-mode-refused", detail: { taskId: candidate.id, projectId: project.id } };
    }

    const executionOptions = typeof options.execution === "function" ? options.execution(candidate) : options.execution;

    let result: ExecuteTaskResult;
    try {
      result = await executeTask(db, candidate.id, executionOptions);
    } finally {
      // Always released — a task that comes back PENDING (retry) or
      // BLOCKED (escalated) must never remain artificially leased.
      releaseLease(db, candidate.id);
    }

    recordEvent(db, {
      projectId: candidate.projectId,
      type: "task.executed",
      payload: { taskId: candidate.id, outcome: result.outcome },
      actor: "system",
    });

    return { kind: "executed", detail: { taskId: candidate.id, outcome: result.outcome } };
  } catch (error) {
    return { kind: "error", detail: { message: (error as Error).message } };
  }
}

/**
 * Startup / per-cycle crash recovery — docs/ai-office/03-system-architecture.md
 * §9.6. A task left `IN_PROGRESS` with an already-expired lease means
 * the process that held it died mid-attempt. Reset to `PENDING` so it's
 * eligible again; `attemptCount` is left exactly as it was (already
 * incremented when that interrupted attempt began), so the existing
 * `role.maxRetries` ceiling in AgentRunner still applies to
 * crash-interrupted attempts — recovery cannot become an unbounded
 * retry loop. No artifacts are touched: the interrupted attempt never
 * reached AgentRunner's terminal transaction (or that transaction
 * itself rolled back on crash), so there is nothing to duplicate.
 */
function recoverStaleLeases(db: DatabaseSync): string[] {
  const stale = findStaleLeasedTasks(db);
  const recoveredIds: string[] = [];

  for (const task of stale) {
    releaseLease(db, task.id);
    if (task.status === "IN_PROGRESS") {
      updateTaskStatus(db, task.id, "PENDING");
      recordEvent(db, {
        projectId: task.projectId,
        type: "task.recovered_after_crash",
        payload: { taskId: task.id, attemptCount: task.attemptCount },
        actor: "system",
      });
      recoveredIds.push(task.id);
    }
    // A stale lease on a task in any other status (DONE/BLOCKED/PENDING)
    // is just leftover bookkeeping from a prior cycle — cleared above,
    // nothing else to do; it was never "interrupted work" to restore.
  }

  return recoveredIds;
}

export interface RunLoopHandle {
  stop: () => void;
}

export interface RunLoopOptions extends RunOneCycleOptions {
  runnerId: string;
  pollIntervalMs?: number;
  onCycle?: (outcome: RunnerCycleOutcome) => void;
}

/**
 * The thin timer wrapper around `runOneCycle` — all the actual logic
 * lives in that function; this just calls it repeatedly. `stop()` is
 * synchronous and immediate: it clears the pending timer and lets the
 * process exit normally (no `unref()` — a real runner process is
 * supposed to stay alive; tests call `stop()` explicitly instead of
 * relying on the process exiting on its own).
 */
export function startRunLoop(db: DatabaseSync, options: RunLoopOptions): RunLoopHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (stopped) return;
    const outcome = await runOneCycle(db, options.runnerId, { leaseDurationMs: options.leaseDurationMs, execution: options.execution });
    options.onCycle?.(outcome);
    if (!stopped) {
      timer = setTimeout(() => void tick(), options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    }
  }

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
