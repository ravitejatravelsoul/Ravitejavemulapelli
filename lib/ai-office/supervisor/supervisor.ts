import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getMostRecentRunnerHeartbeat, upsertRunnerHeartbeat } from "../domain/workspace.ts";
import { recoverTasksOwnedByDeadRunner } from "../runner/runner.ts";
import { createIncident, updateIncident, findOpenIncidentFor, type OfficeIncidentRow } from "../domain/office-incidents.ts";
import { recordEvent, recordAuditEntry } from "../domain/events.ts";

/**
 * Runner-reliability follow-up (second AI Office pilot) — the piece
 * Office Engineer could never provide on its own, because
 * `runOfficeEngineerCycle` only ever runs *from inside* the runner's own
 * poll loop: if the runner process is genuinely dead, the code that
 * would detect that is dead right along with it. This module is
 * deliberately OUTSIDE the runner — meant to be driven by a supervisor
 * process (see `scripts/ai-office-dev.ts`) that spawns the runner as a
 * child and can therefore observe it from the outside (a real OS
 * `exit` event, never guessed).
 *
 * Every function here is pure DB logic, no process spawning — kept
 * fully unit-testable (see `__tests__/supervisor.test.ts`) by never
 * itself deciding *how* to restart anything; the caller (the real
 * supervisor script) owns the actual `child_process.spawn` call and
 * tells this module the new runner's id once it exists.
 */

export const SYMPTOM_RUNNER_OFFLINE = "runner-offline";

/**
 * A runner is "fresh" once its heartbeat is more recent than
 * `thresholdMs` ago. Deliberately configurable per caller rather than
 * reusing the dashboard's own `HEARTBEAT_STALE_MS` (20s) — that value is
 * a UI display threshold tuned for "does this look concerning to an
 * owner glancing at a badge," not a supervisor's much higher-stakes
 * "should I kill and replace a process" decision, which needs a more
 * generous margin against a normal one-off scheduling jitter even after
 * the per-claim heartbeat fix.
 */
export const DEFAULT_SUPERVISOR_STALE_MS = 45_000;

/**
 * Before ever spawning a runner child, verify one is not already
 * healthy — the brief's own explicit "avoid duplicate runners" and
 * "verify one is not already healthy" requirements. A fresh heartbeat
 * from ANY runner id (not just one this supervisor instance previously
 * started) is treated as "already healthy" — this correctly refuses to
 * spawn a second runner even when an operator started one manually
 * outside the supervisor entirely.
 *
 * `excludeRunnerId`: real bug found during live testing — recovering
 * from a runner CONFIRMED dead (a real OS `exit` event) still saw that
 * exact runner's own last-written heartbeat row, which was only a few
 * seconds old (time-elapsed alone can't distinguish "a different runner
 * is healthy" from "the one I just watched die wrote this shortly
 * before it happened") and refused to spawn a replacement — even though
 * the caller has *certain*, first-hand knowledge that specific runner
 * is gone. Pass the confirmed-dead runner's own id here to correctly
 * exclude only that one row from the freshness check, while still
 * refusing to spawn if some OTHER, genuinely different runner is
 * healthy.
 */
export function shouldSpawnRunner(
  db: DatabaseSync,
  thresholdMs = DEFAULT_SUPERVISOR_STALE_MS,
  now = Date.now(),
  excludeRunnerId?: string,
): { spawn: boolean; reason: string; existingRunnerId?: string } {
  const heartbeat = getMostRecentRunnerHeartbeat(db);
  if (heartbeat && heartbeat.runnerId !== excludeRunnerId && now - heartbeat.lastSeenAt < thresholdMs) {
    return { spawn: false, reason: `A runner ("${heartbeat.runnerId}") already has a fresh heartbeat (${now - heartbeat.lastSeenAt}ms old) — refusing to start a duplicate.`, existingRunnerId: heartbeat.runnerId };
  }
  return { spawn: true, reason: heartbeat ? `Most recent heartbeat ("${heartbeat.runnerId}") is stale or confirmed dead.` : "No runner has ever reported a heartbeat." };
}

/**
 * The heartbeat-staleness backstop check — the primary dead-runner
 * signal is the supervisor's own child-process `exit` event (immediate,
 * certain), this exists to also catch a runner that's hung rather than
 * exited (still technically alive at the OS level, but no longer
 * ticking) — a rarer case, but a real one this module still needs to
 * cover per the brief's "repeated crash/reclaim loop" and "task claimed
 * by dead runner" requirements.
 */
export function detectStaleHeartbeat(db: DatabaseSync, thresholdMs = DEFAULT_SUPERVISOR_STALE_MS, now = Date.now()): { stale: boolean; runnerId: string | null; ageMs: number | null } {
  const heartbeat = getMostRecentRunnerHeartbeat(db);
  if (!heartbeat) return { stale: false, runnerId: null, ageMs: null };
  const ageMs = now - heartbeat.lastSeenAt;
  return { stale: ageMs >= thresholdMs, runnerId: heartbeat.runnerId, ageMs };
}

/**
 * The full, safe dead-runner recovery sequence — called once the
 * supervisor has independently CONFIRMED a runner is dead (its spawned
 * child process actually exited, or the heartbeat backstop above fired).
 * Never called speculatively. Records a real, deduplicated incident,
 * reclaims every task that runner still held via the exact same
 * history-preserving transaction normal lease-expiry recovery uses
 * (`recoverTasksOwnedByDeadRunner`), and returns the open incident so
 * the caller can mark it RESOLVED once it has verified a replacement
 * runner is genuinely healthy (see `completeRunnerRecovery`).
 */
export function beginDeadRunnerRecovery(db: DatabaseSync, deadRunnerId: string, actorId = "office-supervisor"): { incident: OfficeIncidentRow; tasksRecovered: string[] } {
  const existing = findOpenIncidentFor(db, { projectId: null, taskId: null, symptom: SYMPTOM_RUNNER_OFFLINE });
  const incident =
    existing ??
    createIncident(db, {
      symptom: SYMPTOM_RUNNER_OFFLINE,
      status: "REPAIRING",
      diagnosis: `Runner "${deadRunnerId}" was confirmed dead (process exited or heartbeat went stale beyond ${DEFAULT_SUPERVISOR_STALE_MS}ms).`,
    });
  recordEvent(db, { projectId: null, type: "office_engineer.repairing", payload: { symptom: SYMPTOM_RUNNER_OFFLINE, deadRunnerId, incidentId: incident.id }, actor: actorId });

  const tasksRecovered = recoverTasksOwnedByDeadRunner(db, deadRunnerId);

  updateIncident(db, incident.id, {
    status: "VERIFYING",
    repairAction: `Reclaimed ${tasksRecovered.length} task(s) held by the dead runner; restarting a replacement runner.`,
  });

  return { incident, tasksRecovered };
}

/**
 * Called once the supervisor has spawned a replacement runner AND
 * confirmed (never assumed) a fresh heartbeat from it — the explicit
 * "verify heartbeat after restart" / "verify the project begins
 * progressing again" requirement. `newRunnerId` is optional: a caller
 * that could not safely restart (e.g. `shouldSpawnRunner` itself
 * refused, or the replacement never reported a heartbeat within a
 * reasonable window) passes `null`, which correctly leaves the incident
 * ESCALATED rather than falsely marking it resolved.
 */
export function completeRunnerRecovery(db: DatabaseSync, incidentId: string, newRunnerId: string | null, actorId = "office-supervisor"): OfficeIncidentRow {
  if (newRunnerId) {
    recordAuditEntry(db, { actor: actorId, action: "office_supervisor.runner_restarted", targetType: "runner", targetId: newRunnerId });
    return updateIncident(db, incidentId, {
      status: "RESOLVED",
      retryResult: `Replacement runner "${newRunnerId}" reported a fresh heartbeat; recovered task(s) are eligible for a fresh attempt.`,
      resolvedAt: Date.now(),
    });
  }
  return updateIncident(db, incidentId, {
    status: "ESCALATED",
    retryResult: "Could not safely confirm a replacement runner's heartbeat — owner attention needed.",
  });
}

/** Thin convenience wrapper so a caller that just restarted a runner can immediately publish its first heartbeat without duplicating `upsertRunnerHeartbeat`'s import elsewhere. */
export function announceRunnerStarted(db: DatabaseSync, runnerId: string): void {
  upsertRunnerHeartbeat(db, { runnerId, status: "IDLE" });
}
