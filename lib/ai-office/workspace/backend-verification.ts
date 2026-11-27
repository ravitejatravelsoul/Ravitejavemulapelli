import "server-only";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readFile, workspaceExists } from "./workspace-service.ts";
import { runCommand, startManagedProcess, type ManagedProcess } from "./command-execution-service.ts";

/**
 * Real full-stack execution, step 1 (Priority 0 #8) — until now, a
 * `backend-developer` task's deliverable was written to the workspace
 * and then NEVER ACTUALLY RUN: `qa-browser-verification.ts` only ever
 * starts a static file server and drives a browser against it, which
 * says nothing about whether generated server code even starts, let
 * alone whether it answers a real request. This closes that specific
 * gap — proving the backend is a real, runnable process that binds a
 * real port and responds to a real HTTP request — using the same
 * sandboxed, no-shell process execution `command-execution-service.ts`
 * already provides for everything else in this codebase.
 *
 * Deliberately NOT yet a full API/DB/integration test battery (that
 * needs its own documented request/response contract, which is a
 * separate, later increment) — this only proves the one thing nothing
 * in this codebase could prove at all before: the backend is really
 * alive. Bounded, isolated, and self-cleaning: a fresh ephemeral port,
 * a fresh scratch directory for this run's own SQLite file (never a
 * real persisted DB), and the process is always stopped before this
 * function returns, success or failure.
 *
 * The health path defaults to GET /__office_health — a real, required
 * contract (see structured-output-contract.ts's backend-developer
 * instructions) rather than the deliverable's own root route, which may
 * not exist at all for a pure API backend. A plain 200 from a
 * deliverable's own real route would only prove the HTTP server is
 * alive, not that it's wired to its own data store; this convention
 * additionally gets a real {"dbConnected": true|false} signal when the
 * product reports one.
 *
 * Disclosed, understood limitation — not something this claims to
 * solve: the spawned backend process (and `npm install` itself) has NO
 * outbound network restriction of its own. qa-browser-verification.ts's
 * network isolation only covers requests a BROWSER makes against the
 * static-served frontend; a real Node.js child process here could still
 * reach the public internet directly. The environment-level mitigations
 * that already apply are real (no host secret ever reaches this
 * process — see sanitizedEnv() in command-execution-service.ts — and in
 * production this always runs inside one ephemeral, single-tenant
 * GitHub Actions VM destroyed at the end of the job), but they are not
 * a network firewall. A genuine per-process network restriction would
 * need OS-level enforcement (e.g. a Linux network namespace or firewall
 * rule scoped to this child's own process tree) that this Node-based
 * command runner cannot provide on its own, and implementing one
 * requires care this change does not attempt — reported here rather
 * than silently left unstated or worked around unsafely.
 */

export interface BackendVerificationResult {
  status: "PASS" | "FAIL";
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
}

const INSTALL_TIMEOUT_MS = 120_000;

/**
 * Resolves a way to invoke npm WITHOUT ever going through a shell — the
 * same "no shell, ever" invariant command-execution-service.ts's own
 * docblock establishes for everything it runs. On Windows, `npm` is a
 * `.cmd` shim that `child_process.spawn` cannot execute directly with
 * `shell: false` (it throws synchronously, before the process even
 * starts) — invoking npm's own JS CLI entry point through the real
 * `node.exe` already running this process sidesteps that completely,
 * with no change to the global no-shell execution policy anywhere else
 * in this codebase. Falls back to the plain "npm" executable name,
 * which already works correctly as-is on Linux/macOS — where this
 * office's own production worker actually runs (GitHub Actions'
 * `ubuntu-latest`) — if the expected file isn't found next to this
 * Node install.
 */
function resolveNpmInvocation(): { executable: string; prefixArgs: string[] } {
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCli)) return { executable: process.execPath, prefixArgs: [npmCli] };
  return { executable: "npm", prefixArgs: [] };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(
  port: number,
  path: string,
  timeoutMs: number,
  proc: ManagedProcess,
): Promise<{ reachable: boolean; status?: number; body?: string; exitedEarly?: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | undefined;
  let lastBody: string | undefined;
  while (Date.now() < deadline) {
    if (proc.hasExited()) return { reachable: false, exitedEarly: true };
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
      lastStatus = res.status;
      lastBody = await res.text().catch(() => "");
      // A non-2xx counts as "not ready yet," not a final answer — a
      // backend whose HTTP listener accepts connections before all its
      // routes (or an async DB connection its health check depends on)
      // are ready gets the same fair chance to become healthy within
      // the bound as one that's merely slow to start listening at all.
      if (res.ok) return { reachable: true, status: lastStatus, body: lastBody };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { reachable: false, status: lastStatus, body: lastBody };
}

export interface RunBackendVerificationOptions {
  /** Checked once the process is believed to be up — defaults to "/__office_health", the required contract (see this module's docblock). */
  healthPath?: string;
  /** Bounds the install step — real npm installs over a real network can be slow; a hung/never-resolving install must not block the runner forever. */
  installTimeoutMs?: number;
  /** Bounds how long this waits for the process to respond before giving up. */
  startTimeoutMs?: number;
}

interface BackendStartFailure {
  ok: false;
  result: BackendVerificationResult;
}
interface BackendStartSuccess {
  ok: true;
  proc: ManagedProcess;
  port: number;
  dbDir: string;
  dbPath: string;
  dbConnected: boolean | undefined;
  healthStatus: number | undefined;
  healthBody: string | undefined;
}

/**
 * The shared "get a real backend process from this workspace into a
 * verified-healthy state" sequence — every real step `runBackendVerification`
 * always did (package.json/"start" script validation, a real `npm
 * install`, a real `npm start` bound to a fresh port and DB file, polling
 * `/__office_health`), extracted so `runFullStackVerification` below can
 * reuse the exact same real startup instead of a second, divergent copy
 * of it. The caller owns the returned `proc`/`dbDir` and is responsible
 * for stopping/cleaning them up — this never tears down on success,
 * only on its own internal failure paths.
 */
async function startVerifiedBackend(
  projectId: string,
  startedAt: number,
  options: RunBackendVerificationOptions,
): Promise<BackendStartSuccess | BackendStartFailure> {
  const finish = (status: "FAIL", summary: string, details: Record<string, unknown> = {}): BackendStartFailure => ({
    ok: false,
    result: { status, summary, details, durationMs: Date.now() - startedAt },
  });

  if (!workspaceExists(projectId)) {
    return finish("FAIL", "No workspace exists for this project — nothing to verify.");
  }

  let packageJsonRaw: string;
  try {
    packageJsonRaw = await readFile(projectId, "package.json");
  } catch {
    return finish(
      "FAIL",
      'No package.json found in this workspace — a backend deliverable must be a Node.js project with a package.json declaring a "start" script; this environment never guesses which file to run.',
    );
  }

  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };
  } catch {
    return finish("FAIL", "package.json exists but is not valid JSON.");
  }

  if (!packageJson.scripts?.start) {
    return finish(
      "FAIL",
      'package.json has no "start" script. A backend deliverable must declare `"scripts": {"start": "node <entry file>"}` (or equivalent) as its single, deterministic entry point — this is the only contract this environment ever runs, never a guessed filename.',
    );
  }

  // Deliberately NOT --ignore-scripts: a legitimate generated backend
  // following this module's own DB_PATH/SQLite contract commonly depends
  // on a package like better-sqlite3, whose native binding is built by
  // its own install-time script — ignoring scripts would break exactly
  // the pattern this office's own backend-developer prompt asks for.
  // The accepted residual risk (a malicious/compromised dependency's
  // install script running real code) is bounded the same way the rest
  // of this module already is: no host secret ever reaches this process
  // (sanitizedEnv()), the workspace stays confined to this one project's
  // own directory, and in production this always runs inside a single
  // ephemeral GitHub Actions VM destroyed at the end of the job — never
  // a long-lived or shared host. Outbound network access from this
  // install step (and from the started backend itself) is NOT currently
  // restricted; see this module's own docblock.
  const npm = resolveNpmInvocation();
  const install = await runCommand({
    projectId,
    executable: npm.executable,
    args: [...npm.prefixArgs, "install", "--no-audit", "--no-fund"],
    allowedExecutables: [npm.executable],
    purpose: "install backend dependencies for verification",
    timeoutMs: options.installTimeoutMs ?? INSTALL_TIMEOUT_MS,
  });
  if (install.exitCode !== 0) {
    return finish("FAIL", `"npm install" failed (exit code ${install.exitCode ?? "unknown"}, timed out: ${install.timedOut}).`, {
      stdout: install.stdout.slice(-4000),
      stderr: install.stderr.slice(-4000),
    });
  }

  const port = await getFreePort();
  const dbDir = mkdtempSync(join(tmpdir(), "ai-office-backend-db-"));
  const dbPath = join(dbDir, "verification.sqlite");

  const proc = startManagedProcess({
    projectId,
    executable: npm.executable,
    args: [...npm.prefixArgs, "start"],
    allowedExecutables: [npm.executable],
    purpose: "start backend for verification",
    // A real, deterministic contract a generated backend can rely on:
    // bind to $PORT (never a hardcoded port, which would collide
    // across concurrent verifications), and use $DB_PATH for any
    // file-based database rather than a path it invents itself — see
    // this function's own docblock for why this DB is always
    // isolated and ephemeral.
    env: { PORT: String(port), DB_PATH: dbPath, NODE_ENV: "test" },
  });

  const healthPath = options.healthPath ?? "/__office_health";
  const health = await waitForHealth(port, healthPath, options.startTimeoutMs ?? 20_000, proc);

  if (health.exitedEarly) {
    const exit = proc.exitInfo();
    const out = proc.getOutput();
    await proc.stop();
    rmSync(dbDir, { recursive: true, force: true });
    return finish("FAIL", `The backend process exited on its own before becoming ready (exit code ${exit?.exitCode ?? "unknown"}, signal ${exit?.signal ?? "none"}).`, {
      stdout: out.stdout.slice(-4000),
      stderr: out.stderr.slice(-4000),
    });
  }
  if (!health.reachable) {
    const out = proc.getOutput();
    await proc.stop();
    rmSync(dbDir, { recursive: true, force: true });
    const sawSomething = health.status !== undefined ? ` (last saw HTTP ${health.status} from ${healthPath}, never 2xx)` : "";
    return finish("FAIL", `The backend never responded successfully on ${healthPath} (port ${port}) within the startup timeout${sawSomething}.`, {
      stdout: out.stdout.slice(-4000),
      stderr: out.stderr.slice(-4000),
    });
  }

  // Real, explicit evidence the deliverable's own health check reports
  // its data store as disconnected — never inferred from absence, only
  // from an actual `"dbConnected": false` the deliverable chose to
  // report (see structured-output-contract.ts's backend-developer
  // instructions: the field is only ever included when the product
  // genuinely has a database to check).
  let dbConnected: boolean | undefined;
  try {
    const parsed = JSON.parse(health.body ?? "{}") as { dbConnected?: unknown };
    if (typeof parsed.dbConnected === "boolean") dbConnected = parsed.dbConnected;
  } catch {
    // Not JSON, or not an object — no dbConnected signal either way.
  }
  if (dbConnected === false) {
    await proc.stop();
    rmSync(dbDir, { recursive: true, force: true });
    return finish("FAIL", `The backend responded on ${healthPath}, but its own health check reports it is not connected to its database ("dbConnected": false).`, {
      port,
      healthStatus: health.status,
      healthBody: health.body,
    });
  }

  return { ok: true, proc, port, dbDir, dbPath, dbConnected, healthStatus: health.status, healthBody: health.body };
}

export async function runBackendVerification(
  projectId: string,
  options: RunBackendVerificationOptions = {},
): Promise<BackendVerificationResult> {
  const startedAt = Date.now();
  const started = await startVerifiedBackend(projectId, startedAt, options);
  if (!started.ok) return started.result;

  try {
    return {
      status: "PASS",
      summary: `The backend started as a real process (npm start), bound to a real port, and responded to a real HTTP request on ${options.healthPath ?? "/__office_health"} (status ${started.healthStatus}${started.dbConnected ? ", database connected" : ""}).`,
      details: { port: started.port, healthStatus: started.healthStatus, healthBody: started.healthBody },
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await started.proc.stop();
    rmSync(started.dbDir, { recursive: true, force: true });
  }
}

export interface FullStackVerificationResult {
  status: "PASS" | "FAIL";
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
  targetUrl: string;
}

/**
 * Real incident, Scenario B acceptance run (2026-11-27): a real
 * full-stack expense tracker's frontend correctly called its own real
 * backend API on click — but `runBackendVerification` and
 * `runQABrowserVerification` ran as two completely disconnected checks
 * (a browser against an isolated static-only server with no backend
 * attached, and a bare `/__office_health` ping with no browser at all),
 * so neither ever actually exercised the frontend-to-backend-to-database
 * round trip a real user depends on. The browser check's own click-and-
 * verify-visible-change probe then failed identically to a genuinely
 * broken button, because its `fetch()` call had no live backend to
 * reach. This runs the real backend (via `startVerifiedBackend`, the
 * exact same real `npm install`/`npm start`/health-poll sequence
 * `runBackendVerification` uses) and then points the SAME real browser
 * check at that live backend's own origin (`baseUrl`) instead of the
 * isolated static server — proving the actual integrated application a
 * real user would experience, not two separately-plausible halves.
 *
 * Only used when a project's plan includes BOTH a frontend-developer and
 * a backend-developer task (agent-runner.ts) — a backend-only or
 * frontend-only plan keeps using the simpler, independent check it
 * already had, since there is nothing to "integrate" for either.
 */
export async function runFullStackVerification(
  projectId: string,
  options: RunBackendVerificationOptions & { entryFile?: string } = {},
): Promise<FullStackVerificationResult> {
  const startedAt = Date.now();
  const started = await startVerifiedBackend(projectId, startedAt, options);
  if (!started.ok) {
    // The backend itself never reached a verified-healthy state — a
    // real backend-side problem (missing start script, a crash, a
    // startup timeout, a reported dbConnected:false), never the
    // frontend's fault. See the browser-FAIL branch below for the
    // symmetric case.
    return { ...started.result, details: { ...started.result.details, failureLayer: "backend" as const }, targetUrl: "" };
  }

  try {
    const { runQABrowserVerification } = await import("./qa-browser-verification.ts");
    const browserResult = await runQABrowserVerification(projectId, {
      entryFile: options.entryFile,
      baseUrl: `http://127.0.0.1:${started.port}`,
    });
    return {
      status: browserResult.status,
      summary: browserResult.status === "FAIL"
        ? `Full-stack integration check failed: ${browserResult.summary}`
        : `Full-stack integration check passed: the real backend started, and the real frontend's browser interaction round-tripped successfully against it (${browserResult.summary})`,
      // Real incident, Scenario B acceptance run (2026-11-27): a review-
      // role failure walks back to EVERY development task it depends on
      // (remediation.ts's findRemediationTargets) — for a full-stack
      // plan that's both frontend-developer and backend-developer,
      // reopened identically regardless of which one the failure is
      // actually about. The backend already started and answered health
      // checks successfully by this point (`started.ok` — see below for
      // the opposite case), so a failure here is in the real browser/DOM
      // check itself, not the backend's own startup — tagging it lets
      // agent-runner.ts's finishFailure narrow remediation to only the
      // frontend-developer task instead of also looping the backend-
      // developer task on a complaint ("tab switching," "button," a
      // visible-text check) it has no file type that could ever fix.
      details: browserResult.status === "FAIL"
        ? { ...browserResult.details, failureLayer: "frontend" as const, backend: { port: started.port, healthStatus: started.healthStatus, healthBody: started.healthBody } }
        : { ...browserResult.details, backend: { port: started.port, healthStatus: started.healthStatus, healthBody: started.healthBody } },
      durationMs: Date.now() - startedAt,
      targetUrl: browserResult.targetUrl,
    };
  } finally {
    await started.proc.stop();
    rmSync(started.dbDir, { recursive: true, force: true });
  }
}
