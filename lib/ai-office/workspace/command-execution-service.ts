import "server-only";
import { spawn, spawnSync } from "node:child_process";
import { getWorkspaceRootDir, workspaceExists } from "./workspace-service.ts";

/**
 * A controlled, server-side-only command runner — the single place
 * anything in this codebase is allowed to launch a child process for a
 * project. No model, adapter, or UI code calls `child_process` directly.
 *
 * Security posture (Phase 8's Part F/V):
 * - `spawn(executable, args, { shell: false })` — executable and
 *   arguments are always separate; nothing is ever concatenated into a
 *   shell command string, so there is no command-injection surface at
 *   all, independent of what `args` contains.
 * - There is no built-in default allowlist. A caller must pass its own
 *   `allowedExecutables` on every call; an executable not in that list
 *   is refused before `spawn` is ever invoked. "Nothing is permitted
 *   unless a caller explicitly names it" is the point, not a
 *   convenience default that could quietly grow over time.
 * - `cwd` is always the project's own workspace root
 *   (`getWorkspaceRootDir`) — never caller-suppliable — and the
 *   workspace must already exist; nothing runs against a directory
 *   that isn't a real, already-created project workspace.
 * - Output is capped (stdout+stderr combined) and the process is
 *   force-killed on timeout — a hung or runaway command can never
 *   block the runner indefinitely or exhaust memory.
 * - The child's environment is a fresh, minimal allowlist (PATH plus a
 *   couple of platform essentials) — never a copy of `process.env`, so
 *   no application secret (session keys, owner credentials, Ollama
 *   config) is ever reachable from generated code.
 */

export class CommandNotAllowedError extends Error {}
export class WorkspaceNotFoundError extends Error {}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB combined stdout+stderr

/** Only the environment variables a well-behaved CLI tool genuinely needs to run at all — never a copy of process.env. */
function sanitizedEnv(): Record<string, string> {
  const allowed = ["PATH", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"] as const;
  const env: Record<string, string> = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export interface RunCommandInput {
  projectId: string;
  executable: string;
  args: string[];
  /** Every executable this specific call permits — no implicit default. */
  allowedExecutables: string[];
  timeoutMs?: number;
  /** A short human-readable reason, recorded for audit/debugging — not interpreted. */
  purpose: string;
}

export interface RunCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  startedAt: number;
  finishedAt: number;
}

/** Shared by runCommand and startManagedProcess — appends a chunk, marking `state.truncated` once the cap is hit, never growing the buffer past it. */
function appendCapped(state: { value: string; truncated: boolean }, chunk: Buffer): void {
  if (state.value.length >= MAX_OUTPUT_BYTES) {
    state.truncated = true;
    return;
  }
  const next = state.value + chunk.toString("utf8");
  state.value = next.length > MAX_OUTPUT_BYTES ? next.slice(0, MAX_OUTPUT_BYTES) : next;
  if (next.length > MAX_OUTPUT_BYTES) state.truncated = true;
}

/**
 * Real incident found verifying Priority 0 #8: a tool like npm starts
 * the generated project's own real script (e.g. "npm start" running
 * `node server.js`) as a CHILD of the npm process itself. `child.kill()`
 * only ever signals the exact PID it was given — it does not, and
 * cannot, propagate to that grandchild. Killing (or timing out) the
 * npm wrapper therefore left the REAL backend server running
 * indefinitely afterward, still bound to its port — observed directly
 * as orphaned `node server.js` processes outliving a verification run
 * by well over an hour. Windows has no POSIX process-group signaling at
 * all, so the fix is platform-specific: `taskkill /T` walks the real
 * OS-tracked parent/child tree (the same pattern this codebase's own
 * e2e harness already uses — see lib/ai-office/e2e/conversation.e2e.ts
 * — proven to need no `detached` cooperation from the child); on POSIX,
 * spawning with `detached: true` makes the child its own process-group
 * leader, so signaling the negated PID reaches the whole group.
 */
function killProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH (already exited) or similar — nothing left to signal.
  }
}

function assertAllowedAndWorkspaceExists(input: { projectId: string; executable: string; allowedExecutables: string[]; purpose: string }): void {
  if (!input.allowedExecutables.includes(input.executable)) {
    throw new CommandNotAllowedError(
      `"${input.executable}" is not in the allowed executable list for this call (purpose: ${input.purpose}).`,
    );
  }
  if (!workspaceExists(input.projectId)) {
    throw new WorkspaceNotFoundError(`Project ${input.projectId} has no workspace to run a command in yet.`);
  }
}

export async function runCommand(input: RunCommandInput): Promise<RunCommandResult> {
  assertAllowedAndWorkspaceExists(input);

  const cwd = getWorkspaceRootDir(input.projectId);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise<RunCommandResult>((resolve) => {
    const child = spawn(input.executable, input.args, {
      cwd,
      shell: false,
      env: sanitizedEnv() as NodeJS.ProcessEnv,
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const stdout = { value: "", truncated: false };
    const stderr = { value: "", truncated: false };
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid, "SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => appendCapped(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => appendCapped(stderr, chunk));

    function finish(exitCode: number | null, signal: NodeJS.Signals | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout: stdout.value,
        stderr: stderr.value,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
        startedAt,
        finishedAt: Date.now(),
      });
    }

    child.on("error", () => {
      // Executable not found, permission denied, etc. — a normal
      // operational failure, never an uncaught exception.
      finish(null, null);
    });
    // 'close' is preferred when it arrives promptly — unlike 'exit', it
    // only fires once every stdio stream has actually finished being
    // read, so the captured stdout/stderr is genuinely complete. But
    // 'close' additionally waits for every process holding this child's
    // stdio handles, which includes any grandchild the child itself
    // spawned (exactly what `npm install`/`npm start` do) — if one of
    // those outlives the immediate child, 'close' can be delayed
    // arbitrarily long after the process we actually care about has
    // already ended (a real incident: an orphaned `node server.js`
    // grandchild left a verification run's `runCommand` call hanging
    // for over an hour). 'exit' plus a short grace window is the
    // bounded fallback — in the overwhelmingly common case 'close'
    // still wins the race within that window, and output is complete.
    child.on("close", (code, signal) => finish(code, signal));
    child.on("exit", (code, signal) => {
      setTimeout(() => finish(code, signal), 2000);
    });
  });
}

export interface StartManagedProcessInput {
  projectId: string;
  executable: string;
  args: string[];
  /** Every executable this specific call permits — no implicit default, same policy as runCommand. */
  allowedExecutables: string[];
  /** A short human-readable reason, recorded for audit/debugging — not interpreted. */
  purpose: string;
  /**
   * Extra variables merged on top of the same fixed sanitizedEnv()
   * allowlist runCommand uses (never a copy of process.env) — e.g. a
   * dynamically-assigned PORT or an isolated DB file path. Caller-chosen
   * keys only; this never widens what's inherited from the real host
   * environment.
   */
  env?: Record<string, string>;
}

export interface ManagedProcess {
  readonly pid: number | undefined;
  /** Combined output captured so far — same cap/truncation policy as runCommand's. */
  getOutput(): { stdout: string; stderr: string; truncated: boolean };
  /** True once the process has exited on its own (crashed or returned) — a caller polling readiness must check this to tell "still starting" apart from "already died," since neither looks different from the outside otherwise. */
  hasExited(): boolean;
  exitInfo(): { exitCode: number | null; signal: NodeJS.Signals | null } | null;
  /** SIGTERM, a short grace period, then SIGKILL if still alive. Safe to call more than once or on an already-exited process. */
  stop(): Promise<void>;
}

/**
 * Real full-stack execution support (Priority 0 #8) — the one place a
 * long-running server (a generated project's own backend, started for
 * verification) is allowed to run. Separate from `runCommand`, which
 * waits for the child to exit on its own: a backend process is not
 * expected to ever exit by itself, so "wait for exit" is the wrong
 * model entirely — the caller instead polls for real readiness (e.g. an
 * HTTP health check) and explicitly `stop()`s the process once
 * verification is done, successful or not. Same security posture as
 * runCommand: no shell, explicit allowlist, sanitized env, capped
 * output, pinned cwd.
 */
export function startManagedProcess(input: StartManagedProcessInput): ManagedProcess {
  assertAllowedAndWorkspaceExists(input);

  const cwd = getWorkspaceRootDir(input.projectId);
  const child = spawn(input.executable, input.args, {
    cwd,
    shell: false,
    env: { ...sanitizedEnv(), ...input.env } as NodeJS.ProcessEnv,
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  const stdout = { value: "", truncated: false };
  const stderr = { value: "", truncated: false };
  let exited = false;
  let exitInfo: { exitCode: number | null; signal: NodeJS.Signals | null } | null = null;

  child.stdout?.on("data", (chunk: Buffer) => appendCapped(stdout, chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendCapped(stderr, chunk));
  child.on("error", () => {
    exited = true;
    exitInfo = { exitCode: null, signal: null };
  });
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = { exitCode: code, signal };
  });

  return {
    pid: child.pid,
    getOutput: () => ({ stdout: stdout.value, stderr: stderr.value, truncated: stdout.truncated || stderr.truncated }),
    hasExited: () => exited,
    exitInfo: () => exitInfo,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited) {
          resolve();
          return;
        }
        // Real incident: a plain `child.kill("SIGTERM")` here only ever
        // signaled the immediate process (e.g. npm) — on Windows that
        // terminates it practically instantly with no chance to forward
        // anything to the real script it started as its own child, and
        // on POSIX a tool isn't guaranteed to forward signals to a
        // script it runs either. Either way the immediate child's own
        // 'exit' fired right away, resolving this promise and clearing
        // killTimer below BEFORE it could ever reach the grandchild —
        // orphaning the real backend server, observed running for over
        // an hour past the end of its own verification run. Always
        // targeting the whole tree from the first signal (not just as a
        // SIGKILL-escalation fallback) is the actual fix.
        const killTimer = setTimeout(() => {
          if (!exited) killProcessTree(child.pid, "SIGKILL");
        }, 5000);
        child.once("exit", () => {
          clearTimeout(killTimer);
          resolve();
        });
        killProcessTree(child.pid, "SIGTERM");
      }),
  };
}
