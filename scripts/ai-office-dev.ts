import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { getAppDatabase } from "../lib/ai-office/db/client.ts";
import {
  shouldSpawnRunner,
  beginDeadRunnerRecovery,
  completeRunnerRecovery,
  detectStaleHeartbeat,
  isActionableRunnerExit,
  shouldBackstopAct,
  DEFAULT_SUPERVISOR_STALE_MS,
} from "../lib/ai-office/supervisor/supervisor.ts";

/**
 * `npm run office:dev` (the single owner-friendly command the runner-
 * reliability follow-up asked for; `ai-office:dev` is kept as an alias
 * for anything already scripted against the old name) — starts the
 * Next.js app and the standalone runner together, AND now actually
 * supervises the runner: if it dies unexpectedly, this script detects
 * that (a real OS `exit` event, never a guess), safely reclaims whatever
 * task it was holding via the exact same history-preserving recovery
 * path lease-expiry already used, restarts a fresh runner, and verifies
 * its heartbeat before declaring the incident resolved.
 *
 * Runs as a real `.ts` file (via `--conditions=react-server`, the same
 * flag every other server-only AI Office module already requires)
 * rather than the previous plain `.mjs` — supervising the runner means
 * reading/writing real DB state (heartbeats, incidents), which this
 * script needs direct access to rather than shelling out to a second
 * throwaway process just to check on the first one.
 *
 * Duplicate-runner safety: before ever spawning a runner child, checks
 * `shouldSpawnRunner()` — if a healthy runner already exists (started
 * manually, or by another instance of this same script), this refuses
 * to spawn a second one. The Next.js app still starts normally either
 * way; only the runner spawn is skipped.
 *
 * Recovery mutex (added after a real, live-tested failure): the exit-event
 * listener and the heartbeat-staleness backstop are two INDEPENDENT
 * triggers that can each decide "the runner is dead." Without a mutex,
 * both can fire within the same window and each spawn a replacement,
 * producing two live runners that both claim and pay for the same task
 * concurrently — this actually happened during live testing and wasted
 * real Claude spend (two attempts for the same task created 725ms apart).
 * `recoveryInFlight` + `isActionableRunnerExit`/`shouldBackstopAct` (pure,
 * unit-tested in supervisor.ts) serialize the two triggers so only one
 * recovery ever runs at a time. A stray, delayed OS exit event for a
 * runner this script already superseded (e.g. one it deliberately killed
 * while recovering a different dead runner) is also ignored, by comparing
 * against the specific child each exit listener was attached to rather
 * than a shared mutable "current runner" variable.
 */

const repoRoot = join(import.meta.dirname, "..");
const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
const runnerScript = join(repoRoot, "lib", "ai-office", "runner", "start.ts");
const envFileArg = "--env-file-if-exists=" + join(repoRoot, ".env.local");

const db = getAppDatabase();

let shuttingDown = false;
let nextChild: ChildProcess | null = null;
let runnerChild: ChildProcess | null = null;
let runnerId: string | null = null;
let staleCheckTimer: ReturnType<typeof setInterval> | null = null;
let recoveryInFlight = false;

function log(message: string): void {
  console.log(`[office:dev] ${message}`);
}

function spawnNext(): void {
  nextChild = spawn(process.execPath, [nextBin, "dev"], { stdio: "inherit", shell: false, cwd: repoRoot });
  nextChild.on("exit", (code, signal) => {
    log(`Next.js app exited (code=${code ?? "null"} signal=${signal ?? "null"}) — shutting everything down.`);
    shutdown();
  });
}

/**
 * Spawns a fresh runner child, but only after `shouldSpawnRunner()`
 * confirms no other runner is already healthy — the brief's explicit
 * "before starting a runner: verify one is not already healthy" and
 * "do not create duplicate runner processes" requirements. Returns the
 * new runner's id, or `null` if it refused to spawn (an existing healthy
 * runner already owns work).
 */
function spawnRunnerIfSafe(confirmedDeadRunnerId?: string): string | null {
  const check = shouldSpawnRunner(db, DEFAULT_SUPERVISOR_STALE_MS, Date.now(), confirmedDeadRunnerId);
  if (!check.spawn) {
    log(`Not starting a runner — ${check.reason}`);
    return null;
  }

  const id = `runner-${process.pid}-${Date.now().toString(36)}`;
  runnerId = id;
  const child = spawn(process.execPath, [envFileArg, "--conditions=react-server", runnerScript], {
    stdio: "inherit",
    shell: false,
    cwd: repoRoot,
    env: { ...process.env, AI_OFFICE_RUNNER_ID_HINT: id },
  });
  runnerChild = child;
  // Capture `child` itself (not the shared mutable `runnerChild`/`runnerId`
  // globals) so that a delayed OS exit event for THIS specific process is
  // never misattributed to whatever runner happens to be "current" by the
  // time the event finally fires — see `isActionableRunnerExit`.
  child.on("exit", (code, signal) => handleRunnerExit(id, child, code, signal));
  log(`Started runner (pid ${child.pid}).`);
  return id;
}

/**
 * The primary dead-runner signal: a real, immediate OS `exit` event on
 * the child THIS script itself spawned — far more reliable than polling
 * a heartbeat, and available the instant the process actually dies.
 * Guarded by `isActionableRunnerExit` (pure, unit-tested): ignores a
 * stray/delayed exit from a runner already superseded, and never starts a
 * second, overlapping recovery while one is already in flight.
 */
function handleRunnerExit(exitedRunnerId: string, exitedChild: ChildProcess, code: number | null, signal: string | null): void {
  const actionable = isActionableRunnerExit({ shuttingDown, recoveryInFlight, exitedIsCurrentlyTracked: exitedChild === runnerChild });
  if (!actionable) {
    if (!shuttingDown) {
      log(`Ignoring exit of runner "${exitedRunnerId}" (code=${code ?? "null"} signal=${signal ?? "null"}) — ${recoveryInFlight ? "a recovery is already in flight" : "it was already superseded by a newer runner"}.`);
    }
    return;
  }
  log(`Runner exited unexpectedly (code=${code ?? "null"} signal=${signal ?? "null"}) — beginning recovery.`);
  recoverAndRestartRunner(exitedRunnerId);
}

function recoverAndRestartRunner(deadRunnerId: string): void {
  recoveryInFlight = true;
  const { incident, tasksRecovered } = beginDeadRunnerRecovery(db, deadRunnerId);
  log(`Recorded incident ${incident.id} — reclaimed ${tasksRecovered.length} task(s) held by the dead runner.`);

  const newRunnerId = spawnRunnerIfSafe(deadRunnerId);
  if (!newRunnerId) {
    completeRunnerRecovery(db, incident.id, null);
    log(`Could not safely restart a runner — incident ${incident.id} escalated for owner attention.`);
    recoveryInFlight = false;
    return;
  }

  // Verify the replacement actually reports a fresh heartbeat before
  // declaring victory — never assume a spawn succeeded just because the
  // OS accepted it.
  const deadline = Date.now() + 15_000;
  const verify = () => {
    const stale = detectStaleHeartbeat(db, DEFAULT_SUPERVISOR_STALE_MS);
    if (stale.runnerId === newRunnerId && !stale.stale) {
      completeRunnerRecovery(db, incident.id, newRunnerId);
      log(`Verified fresh heartbeat from "${newRunnerId}" — incident ${incident.id} resolved.`);
      recoveryInFlight = false;
      return;
    }
    if (Date.now() > deadline) {
      completeRunnerRecovery(db, incident.id, null);
      log(`Replacement runner never reported a fresh heartbeat within 15s — incident ${incident.id} escalated.`);
      recoveryInFlight = false;
      return;
    }
    setTimeout(verify, 1000);
  };
  setTimeout(verify, 1000);
}

/**
 * Backstop for a runner that's hung rather than exited (still alive at
 * the OS level, but no longer ticking) — the `exit` event above can
 * never fire for this case, since the process never actually dies. Also
 * the ONLY signal available at all when this supervisor deferred to an
 * already-healthy runner it never spawned itself (`spawnRunnerIfSafe`
 * returned `null`) — that runner has no `exit` event this process can
 * ever observe, so this general "is the most recent heartbeat, from
 * *whoever* currently owns it, still fresh" check is what keeps such a
 * runner supervised too, not just ones this script started. A generous
 * interval and threshold (`DEFAULT_SUPERVISOR_STALE_MS`, well above any
 * real single task's duration now that the runner itself updates its
 * heartbeat on every task claim, not only after a full cycle) keeps
 * this from ever firing on a merely slow, healthy runner.
 */
function startStaleHeartbeatBackstop(): void {
  staleCheckTimer = setInterval(() => {
    const stale = detectStaleHeartbeat(db, DEFAULT_SUPERVISOR_STALE_MS);
    if (!shouldBackstopAct({ shuttingDown, recoveryInFlight, stale: stale.stale })) return;
    if (stale.runnerId) {
      runnerId = stale.runnerId;
      log(`Heartbeat backstop: runner "${stale.runnerId}" has gone stale (${stale.ageMs}ms) — treating as dead/hung and recovering.`);
      if (runnerChild && !runnerChild.killed) runnerChild.kill();
      recoverAndRestartRunner(runnerId);
    }
  }, 15_000);
}

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (staleCheckTimer) clearInterval(staleCheckTimer);
  for (const [label, child] of [
    ["next dev", nextChild],
    ["ai-office runner", runnerChild],
  ] as const) {
    if (child && !child.killed && child.exitCode === null) {
      log(`Stopping ${label}.`);
      child.kill();
    }
  }
}

spawnNext();
spawnRunnerIfSafe();
startStaleHeartbeatBackstop();

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
process.on("exit", shutdown);
