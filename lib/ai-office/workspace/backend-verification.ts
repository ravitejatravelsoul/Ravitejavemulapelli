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
  while (Date.now() < deadline) {
    if (proc.hasExited()) return { reachable: false, exitedEarly: true };
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
      const body = await res.text().catch(() => "");
      return { reachable: true, status: res.status, body };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return { reachable: false };
}

export interface RunBackendVerificationOptions {
  /** Checked once the process is believed to be up — defaults to "/", since a generated backend's own routes are not known ahead of time at this step. */
  healthPath?: string;
  /** Bounds the install step — real npm installs over a real network can be slow; a hung/never-resolving install must not block the runner forever. */
  installTimeoutMs?: number;
  /** Bounds how long this waits for the process to respond before giving up. */
  startTimeoutMs?: number;
}

export async function runBackendVerification(
  projectId: string,
  options: RunBackendVerificationOptions = {},
): Promise<BackendVerificationResult> {
  const startedAt = Date.now();
  const finish = (status: "PASS" | "FAIL", summary: string, details: Record<string, unknown> = {}): BackendVerificationResult => ({
    status,
    summary,
    details,
    durationMs: Date.now() - startedAt,
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

  let proc: ManagedProcess | undefined;
  try {
    proc = startManagedProcess({
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

    const health = await waitForHealth(port, options.healthPath ?? "/", options.startTimeoutMs ?? 20_000, proc);

    if (health.exitedEarly) {
      const exit = proc.exitInfo();
      const out = proc.getOutput();
      return finish("FAIL", `The backend process exited on its own before becoming ready (exit code ${exit?.exitCode ?? "unknown"}, signal ${exit?.signal ?? "none"}).`, {
        stdout: out.stdout.slice(-4000),
        stderr: out.stderr.slice(-4000),
      });
    }
    if (!health.reachable) {
      const out = proc.getOutput();
      return finish("FAIL", `The backend never responded on port ${port} within the startup timeout.`, {
        stdout: out.stdout.slice(-4000),
        stderr: out.stderr.slice(-4000),
      });
    }

    return finish("PASS", `The backend started as a real process (npm start), bound to a real port, and responded to a real HTTP request (status ${health.status}).`, {
      port,
      healthStatus: health.status,
      healthBody: health.body,
    });
  } finally {
    if (proc) await proc.stop();
    rmSync(dbDir, { recursive: true, force: true });
  }
}
