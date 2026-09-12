#!/usr/bin/env node
import { spawn } from "node:child_process";

/**
 * `npm run ai-office:dev` — starts the Next.js dev server and the
 * standalone AI Office runner together, as one convenience command, and
 * makes sure BOTH child processes are actually killed when this script
 * exits for any reason (normal exit, Ctrl+C, or the parent being
 * killed). This directly targets a real failure mode already hit once
 * this session: an orphaned standalone-runner process left holding the
 * SQLite file open long after its parent terminal was gone. A plain
 * `node` script with explicit signal handling, not a shell one-liner —
 * shell background jobs (`cmd1 & cmd2`) are exactly the fragile pattern
 * that produces orphans on Windows.
 */

const children = [];

function spawnChild(label, command, args) {
  const child = spawn(command, args, { stdio: "inherit", shell: false });
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

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
spawnChild("next dev", npmCmd, ["run", "dev"]);
spawnChild("ai-office runner", npmCmd, ["run", "ai-office:runner"]);

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
process.on("exit", shutdown);
