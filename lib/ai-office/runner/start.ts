import "server-only";
import { randomUUID } from "node:crypto";
import { getAppDatabase } from "../db/client.ts";
import { startRunLoop, DEFAULT_POLL_INTERVAL_MS } from "./runner.ts";

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
 */

function log(message: string, detail?: Record<string, unknown>) {
  const line = `[ai-office-runner] ${new Date().toISOString()} ${message}`;
  if (detail) console.log(line, detail);
  else console.log(line);
}

const runnerId = `runner-${process.pid}-${randomUUID().slice(0, 8)}`;
const pollIntervalMs = Number(process.env.AI_OFFICE_RUNNER_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;

const db = getAppDatabase();
log(`starting — runnerId=${runnerId} pollIntervalMs=${pollIntervalMs}`);

const handle = startRunLoop(db, {
  runnerId,
  pollIntervalMs,
  onCycle: (outcome) => {
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
