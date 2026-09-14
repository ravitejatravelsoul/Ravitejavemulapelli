import "server-only";
import { randomUUID } from "node:crypto";
import { getAppDatabase } from "../db/client.ts";
import { startRunLoop, DEFAULT_POLL_INTERVAL_MS } from "./runner.ts";
import { upsertRunnerHeartbeat } from "../domain/workspace.ts";

/**
 * Standalone companion process for the Durable Local Execution Runner —
 * `npm run ai-office:runner`. See docs/ai-office/11-implementation-phases.md's
 * Phase 5 status note for the full startup-strategy write-up; summary:
 * a standalone script was chosen over a Next.js `instrumentation.ts`
 * singleton because `next dev`'s hot-reload restarts the Next.js
 * module graph on every server-file save, which would either kill and
 * restart an in-process singleton mid-cycle or (worse) silently spawn
 * duplicate loop instances across reloads — exactly the failure mode
 * the brief's "closing /office must not stop the workflow" and "no two
 * runners execute the same task" requirements rule out. A separate
 * `node` process has no such lifecycle coupling: it starts once, runs
 * until explicitly stopped, and talks to the same `.data/office.db`
 * file (via the identical `getAppDatabase()` the Next.js app itself
 * uses) as any number of `next dev` restarts happening alongside it.
 *
 * Run directly with plain `node` (not through Next's bundler) — the
 * same `--conditions=react-server` flag the test suite uses is required
 * so the `server-only`-guarded imports throughout `lib/ai-office/**`
 * resolve; see the `ai-office:runner` script in package.json.
 *
 * Real defect found and fixed during the first genuine Claude LIVE pilot
 * run: `next dev`/`next build`/`next start` all load `.env.local`
 * automatically, but a plain `node` process does not — this process
 * would otherwise never see `ANTHROPIC_API_KEY`/the pricing env vars,
 * silently blocking every Claude-approved task forever (even after real
 * owner approval) with "no ANTHROPIC_API_KEY/pricing configuration is
 * set on the server." The `ai-office:runner` script now passes
 * `--env-file-if-exists=.env.local` for exactly this reason.
 */

function log(message: string, detail?: Record<string, unknown>) {
  const line = `[ai-office-runner] ${new Date().toISOString()} ${message}`;
  if (detail) console.log(line, detail);
  else console.log(line);
}

// `AI_OFFICE_RUNNER_ID_HINT`: the supervisor script (scripts/ai-office-dev.ts)
// generates a runner id itself *before* spawning this process, so it can
// unambiguously recognize this exact instance's heartbeat afterward
// (rather than guessing based on "whichever heartbeat is newest," which
// breaks down the moment two spawns happen close together during a
// restart). A runner started any other way (manually, `npm run
// ai-office:runner`) has no hint and falls back to generating its own,
// exactly as before.
const runnerId = process.env.AI_OFFICE_RUNNER_ID_HINT || `runner-${process.pid}-${randomUUID().slice(0, 8)}`;
const pollIntervalMs = Number(process.env.AI_OFFICE_RUNNER_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;

const db = getAppDatabase();
log(`starting — runnerId=${runnerId} pollIntervalMs=${pollIntervalMs}`);

// A real liveness signal (Phase 8 Part P) — upserted every poll tick so
// the dashboard can tell "runner process not running" (OFFLINE) apart
// from "runner alive, nothing eligible right now" (ONLINE_IDLE), which
// the previous activity-event heuristic could never distinguish. An
// immediate upsert here (before the first tick) means the dashboard
// reflects this process as online right away, even at a slow poll
// interval.
upsertRunnerHeartbeat(db, { runnerId, status: "IDLE" });

const handle = startRunLoop(db, {
  runnerId,
  pollIntervalMs,
  onCycle: (outcome) => {
    upsertRunnerHeartbeat(db, {
      runnerId,
      status: outcome.kind === "executed" || outcome.kind === "recovered" ? "WORKING" : "IDLE",
    });
    // Deliberately quiet on "idle"/"no-eligible-work" — an office with
    // nothing to do polls silently rather than spamming the terminal
    // every interval; every other outcome is worth a line.
    if (outcome.kind === "idle" || outcome.kind === "no-eligible-work") return;
    log(outcome.kind, outcome.detail);
  },
});

/**
 * Shutdown policy: stop scheduling further cycles immediately, then let
 * any already-in-flight cycle finish naturally rather than force-exiting
 * mid-transaction. `runOneCycle` is already bounded (the per-task
 * execution timeout), and every terminal DB transition it makes is
 * wrapped in a SQL transaction — so even an unclean kill (SIGKILL, power
 * loss) is safe, recovered by the next startup's crash-recovery sweep.
 * A graceful SIGINT/SIGTERM therefore has nothing extra to do beyond
 * "don't start new work" — once `stop()` clears the poll timer, the
 * process exits on its own as soon as the current cycle (if any)
 * resolves, no forced `process.exit()` required.
 */
function shutdown(signal: string) {
  log(`received ${signal} — stopping (letting any in-flight cycle finish naturally)`);
  handle.stop();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
