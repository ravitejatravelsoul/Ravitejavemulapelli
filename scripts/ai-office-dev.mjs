#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * `npm run ai-office:dev` — starts the Next.js dev server and the
 * standalone AI Office runner together, as one convenience command, and
 * makes sure BOTH child processes are actually killed when this script
 * exits for any reason (normal exit, Ctrl+C, or the parent being
 * killed). This directly targets a real failure mode already hit once
 * this session: an orphaned standalone-runner process left holding the
 * SQLite file open long after its parent terminal was gone.
 *
 * Both children are launched by invoking `process.execPath` (node.exe
 * itself) directly against a resolved script path — never through `npm
 * run` or a shell. This matters specifically on Windows: `npm` itself is
 * `npm.cmd`, a batch-file shim `child_process.spawn` cannot invoke
 * without `shell: true` — and spawning *through* a shell wrapper means
 * `child.kill()` only terminates the shell process, not the real node
 * process underneath it, which is exactly how an earlier version of this
 * script (using `shell: true` to work around the `.cmd` issue) leaked
 * orphaned runner processes during this phase's own testing. Resolving
 * real script paths and invoking node directly avoids both problems at
 * once: no shell, no `.cmd`, no wrapper layer for a kill signal to get
 * lost in.
 */

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
const runnerScript = join(repoRoot, "lib", "ai-office", "runner", "start.ts");

const children = [];

function spawnChild(label, args) {
  const child = spawn(process.execPath, args, { stdio: "inherit", shell: false, cwd: repoRoot });
  children.push({ label, child });
  child.on("exit", (code, signal) => {
    console.log(`[ai-office-dev] ${label} exited (code=${code ?? "null"} signal=${signal ?? "null"})`);
    shutdown();
  });
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { label, child } of children) {
    if (!child.killed && child.exitCode === null) {
      console.log(`[ai-office-dev] stopping ${label}`);
      child.kill();
    }
  }
}

spawnChild("next dev", [nextBin, "dev"]);
// `--env-file-if-exists`: unlike `next dev` (which loads `.env.local`
// automatically), a plain `node` process has no built-in .env loading at
// all — the runner would otherwise never see ANTHROPIC_API_KEY/pricing,
// silently blocking every Claude-approved task forever with "no
// ANTHROPIC_API_KEY/pricing configuration is set on the server" even
// after the owner approved it. Real defect found and fixed during the
// first genuine Claude LIVE pilot run.
spawnChild("ai-office runner", ["--env-file-if-exists=" + join(repoRoot, ".env.local"), "--conditions=react-server", runnerScript]);

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
process.on("exit", shutdown);
