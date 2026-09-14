import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getOfficeStatus } from "../domain/office.ts";
import { getProject, updateProjectStatus } from "../domain/projects.ts";
import {
  updateTaskStatus,
  releaseLease,
  claimTask,
  findStaleLeasedTasks,
  listTasksByLeaseOwner,
  listTaskAttempts,
  updateTaskAttemptStatus,
  getAgentRun,
  updateAgentRunStatus,
  type TaskRow,
} from "../domain/tasks.ts";
import { recordEvent } from "../domain/events.ts";
import { executeTask, type ExecuteTaskOptions } from "../agents/agent-runner.ts";
import { findEligibleTasks, hasAnyPendingTask } from "./eligibility.ts";
import { runOfficeEngineerCycle } from "../engineer/office-engineer.ts";
import { upsertRunnerHeartbeat } from "../domain/workspace.ts";

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
 * 5. Otherwise, execute through AgentRunner and release the lease once
 *    `executeTask()` returns — a retried task must be immediately
 *    eligible again next cycle, not stuck waiting for its lease to
 *    expire naturally. If `executeTask()` *throws* instead of
 *    returning (a genuine internal/persistence error, never a
 *    provider-side one — AgentRunner converts those to a normal FAILED
 *    result internally), the lease is deliberately **not** released:
 *    doing so would strand the task `IN_PROGRESS` with no lease, which
 *    is invisible to both eligibility and the stale-lease
 *    crash-recovery sweep below. Left alone, the lease simply expires
 *    and that same sweep recovers it correctly.
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

    // Office Engineer's own health-check + safe auto-repair pass (Parts
    // 9-11) — deterministic, free (never an AI call), and cheap enough
    // to run every cycle: a handful of indexed SELECTs when nothing is
    // wrong (the common case), at most one write per genuinely new
    // incident. Run here, before `findEligibleTasks`, so a task it just
    // auto-repaired can become eligible again in this very same cycle
    // rather than waiting for the next poll tick.
    runOfficeEngineerCycle(db, runnerId);

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

    // Real defect found in the second AI Office pilot: the heartbeat was
    // previously only ever touched by the caller's `onCycle` callback
    // *after* this whole function resolves — meaning it went untouched
    // for the full duration of whatever `executeTask` below does. Every
    // real Claude call in that pilot took 47-62 seconds; the dashboard's
    // staleness threshold is 20 seconds. The runner and task were both
    // completely healthy the whole time, but the dashboard showed
    // "RUNNER OFFLINE" for the full duration of every single paid call,
    // because the only heartbeat write was scheduled to happen *after*
    // the slow part was already over. Marking WORKING here, immediately
    // after a real claim and before the (possibly slow) execution starts,
    // means the heartbeat is never more than a few milliseconds stale
    // while a real attempt is genuinely in flight — the caller's own
    // post-cycle `onCycle` heartbeat write still runs afterward too, for
    // the idle/no-eligible-work cycles that never reach this line at all.
    upsertRunnerHeartbeat(db, { runnerId, status: "WORKING" });

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

    // Deliberately no try/finally around this await. AgentRunner
    // already converts every provider-side failure — including a
    // timeout, a thrown exception, or a rejected promise — into a
    // normal FAILED result internally (see agent-runner.ts); it never
    // throws for a provider-caused reason. If executeTask() throws
    // here, it is therefore a genuine internal/persistence/programming
    // error, and the task may be left IN_PROGRESS with a torn
    // attempt/run state (exactly as if the process had crashed at this
    // point). Releasing the lease in that case would strand the task:
    // an IN_PROGRESS task with no lease is invisible to both
    // findEligibleTasks() (requires PENDING) and the stale-lease
    // crash-recovery sweep (requires a non-null, expired lease) — an
    // unrecoverable orphan. Leaving the lease in place instead lets it
    // expire naturally and be picked up by that same crash-recovery
    // path, which already knows how to safely close out an interrupted
    // TaskAttempt/AgentRun and return the task to PENDING.
    const result = await executeTask(db, candidate.id, executionOptions);
    releaseLease(db, candidate.id);

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
 * the process that held it died (or threw an internal error — see
 * runOneCycle's execution step) mid-attempt. Recovery does two things,
 * not one: it returns the task to `PENDING` (so it's eligible again),
 * *and* it closes out whatever `TaskAttempt`/`AgentRun` that interrupted
 * execution left `RUNNING`/`QUEUED` — otherwise those rows would stay
 * `RUNNING` forever, producing false history (e.g. "Attempt 1 =
 * RUNNING forever, Attempt 2 = SUCCEEDED"). Both are terminated into the
 * existing `FAILED` status — already valid for both tables per
 * `001-init.sql`, no schema change needed — never left `RUNNING`, and
 * never silently treated as if they'd succeeded. `attemptCount` is left
 * exactly as it was (already incremented when that interrupted attempt
 * began), so the existing `role.maxRetries` ceiling in AgentRunner still
 * applies to crash-interrupted attempts — recovery cannot become an
 * unbounded retry loop. No artifacts are touched: the interrupted
 * attempt never reached AgentRunner's terminal transaction (or that
 * transaction itself rolled back on crash), so there is nothing to
 * duplicate.
 */
/**
 * The one safe transaction every recovery path shares, regardless of
 * *why* a task is being reclaimed (lease expiry vs. a runner confirmed
 * dead by the supervisor) — extracted so both callers can never drift
 * into two slightly-different, independently-risky implementations of
 * "close out an interrupted attempt without losing history." Closes out
 * whatever `TaskAttempt`/`AgentRun` the interrupted execution left
 * `RUNNING`/`QUEUED` into the existing `FAILED` status (never left
 * `RUNNING` forever, never silently treated as succeeded), releases the
 * lease, returns the task to `PENDING`, and records a
 * `task.recovered_after_crash` event — all in one transaction, so a
 * crash mid-recovery leaves the task exactly as it was (still leased,
 * still IN_PROGRESS), safely retried by the next sweep rather than left
 * half-recovered. `attemptCount` is left exactly as it was (already
 * incremented when the interrupted attempt began), so `role.maxRetries`
 * still applies — recovery can never become an unbounded retry loop.
 */
function recoverInterruptedTask(db: DatabaseSync, task: TaskRow, reason: string): void {
  db.exec("BEGIN");
  let interruptedAttemptId: string | null = null;
  let interruptedAgentRunId: string | null = null;
  try {
    const attempts = listTaskAttempts(db, task.id);
    const latestAttempt = attempts[attempts.length - 1];

    if (latestAttempt && latestAttempt.status === "RUNNING") {
      interruptedAttemptId = latestAttempt.id;
      if (latestAttempt.agentRunId) {
        const run = getAgentRun(db, latestAttempt.agentRunId);
        if (run && (run.status === "RUNNING" || run.status === "QUEUED")) {
          updateAgentRunStatus(db, run.id, "FAILED", Date.now());
          interruptedAgentRunId = run.id;
        }
      }
      updateTaskAttemptStatus(db, latestAttempt.id, "FAILED");
    }

    releaseLease(db, task.id);
    updateTaskStatus(db, task.id, "PENDING");
    recordEvent(db, {
      projectId: task.projectId,
      type: "task.recovered_after_crash",
      payload: { taskId: task.id, attemptCount: task.attemptCount, interruptedAttemptId, interruptedAgentRunId, reason },
      actor: "system",
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Startup / per-cycle crash recovery — docs/ai-office/03-system-architecture.md
 * §9.6. A task left `IN_PROGRESS` with an already-expired lease means
 * the process that held it died (or threw an internal error — see
 * runOneCycle's execution step) mid-attempt.
 */
function recoverStaleLeases(db: DatabaseSync): string[] {
  const stale = findStaleLeasedTasks(db);
  const recoveredIds: string[] = [];

  for (const task of stale) {
    if (task.status !== "IN_PROGRESS") {
      // Leftover lease bookkeeping on an already-terminal/PENDING task
      // — never an interrupted execution to restore, just clear it.
      releaseLease(db, task.id);
      continue;
    }

    recoverInterruptedTask(
      db,
      task,
      "Lease expired while the task was IN_PROGRESS — the process that held it stopped responding before completing the attempt.",
    );
    recoveredIds.push(task.id);
  }

  return recoveredIds;
}

/**
 * Runner-reliability follow-up (second AI Office pilot) — reclaims every
 * task a *confirmed-dead* runner still holds, regardless of whether its
 * lease has technically expired yet. Waiting for a lease to expire
 * naturally (`DEFAULT_LEASE_DURATION_MS`, 5 minutes) is far too slow to
 * call "self-healing" once a runner's OS process and heartbeat have
 * already independently proven it's gone — this is the *only* thing
 * that changes the trigger condition; the actual per-task recovery is
 * the exact same safe, history-preserving transaction
 * `recoverStaleLeases` already uses. Exported for the supervisor to call
 * once it has confirmed (never assumed) a runner is dead — see
 * `lib/ai-office/supervisor/supervisor.ts`.
 */
export function recoverTasksOwnedByDeadRunner(db: DatabaseSync, deadRunnerId: string): string[] {
  const owned = listTasksByLeaseOwner(db, deadRunnerId).filter((t) => t.status === "IN_PROGRESS");
  for (const task of owned) {
    recoverInterruptedTask(db, task, `Runner "${deadRunnerId}" was confirmed dead (heartbeat stale and/or OS process gone) while this task was IN_PROGRESS.`);
  }
  return owned.map((t) => t.id);
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
