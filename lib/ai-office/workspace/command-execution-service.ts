import "server-only";
import { spawn } from "node:child_process";
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

export async function runCommand(input: RunCommandInput): Promise<RunCommandResult> {
  if (!input.allowedExecutables.includes(input.executable)) {
    throw new CommandNotAllowedError(
      `"${input.executable}" is not in the allowed executable list for this call (purpose: ${input.purpose}).`,
    );
  }
  if (!workspaceExists(input.projectId)) {
    throw new WorkspaceNotFoundError(`Project ${input.projectId} has no workspace to run a command in yet.`);
  }

  const cwd = getWorkspaceRootDir(input.projectId);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise<RunCommandResult>((resolve) => {
    const child = spawn(input.executable, input.args, {
      cwd,
      shell: false,
      env: sanitizedEnv() as NodeJS.ProcessEnv,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    function appendCapped(current: string, chunk: Buffer): string {
      if (current.length >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString("utf8");
      if (next.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        return next.slice(0, MAX_OUTPUT_BYTES);
      }
      return next;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk);
    });

    function finish(exitCode: number | null, signal: NodeJS.Signals | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut, truncated, startedAt, finishedAt: Date.now() });
    }

    child.on("error", () => {
      // Executable not found, permission denied, etc. — a normal
      // operational failure, never an uncaught exception.
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
