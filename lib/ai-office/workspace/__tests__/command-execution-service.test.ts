import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../workspace-service.ts";
import { runCommand, startManagedProcess, CommandNotAllowedError, WorkspaceNotFoundError } from "../command-execution-service.ts";

let root: string;
const PROJECT = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-office-cmd-test-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = root;
});

afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(root, { recursive: true, force: true });
});

describe("runCommand — allowlist and workspace preconditions", () => {
  test("rejects an executable not in the caller-supplied allowlist, without ever spawning it", async () => {
    await createWorkspace(PROJECT);
    await assert.rejects(
      () => runCommand({ projectId: PROJECT, executable: "rm", args: ["-rf", "/"], allowedExecutables: ["node"], purpose: "test" }),
      CommandNotAllowedError,
    );
  });

  test("refuses to run against a project with no workspace yet", async () => {
    await assert.rejects(
      () => runCommand({ projectId: "44444444-4444-4444-4444-444444444444", executable: "node", args: ["-e", "1"], allowedExecutables: ["node"], purpose: "test" }),
      WorkspaceNotFoundError,
    );
  });
});

describe("runCommand — no shell, real process behavior", () => {
  test("captures stdout and a zero exit code for a successful command", async () => {
    await createWorkspace(PROJECT);
    const result = await runCommand({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "console.log('hello from child')"],
      allowedExecutables: [process.execPath],
      purpose: "test",
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hello from child/);
    assert.equal(result.timedOut, false);
  });

  test("captures stderr and a non-zero exit code for a failing command", async () => {
    await createWorkspace(PROJECT);
    const result = await runCommand({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "console.error('oops'); process.exit(2)"],
      allowedExecutables: [process.execPath],
      purpose: "test",
    });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /oops/);
  });

  test("arguments are passed literally, never shell-interpreted — a shell-metacharacter-laden argument is just a string", async () => {
    await createWorkspace(PROJECT);
    const dangerousArg = "hello; rm -rf / && echo pwned`whoami`";
    const result = await runCommand({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "console.log(process.argv[1])", dangerousArg],
      allowedExecutables: [process.execPath],
      purpose: "test",
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes(dangerousArg), "the argument must arrive completely intact, not shell-expanded");
  });

  test("cwd is always the project's own workspace root, never caller-suppliable", async () => {
    await createWorkspace(PROJECT);
    const result = await runCommand({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "console.log(process.cwd())"],
      allowedExecutables: [process.execPath],
      purpose: "test",
    });
    assert.ok(result.stdout.includes(PROJECT), "the child's cwd must be inside this project's own workspace directory");
  });

  test("a hung process is killed at the timeout and reported as timed out", async () => {
    await createWorkspace(PROJECT);
    const result = await runCommand({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      allowedExecutables: [process.execPath],
      purpose: "test",
      timeoutMs: 300,
    });
    assert.equal(result.timedOut, true);
  });

  test("combined stdout+stderr output beyond the cap is truncated, not unbounded", async () => {
    await createWorkspace(PROJECT);
    const result = await runCommand({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))"],
      allowedExecutables: [process.execPath],
      purpose: "test",
    });
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.length <= 1024 * 1024, "captured output must never exceed the documented cap");
  });

  test("the child's environment is a fresh sanitized set, never a copy of this process's own env", async () => {
    process.env.AI_OFFICE_TEST_SECRET_SENTINEL = "leak-me-not";
    try {
      await createWorkspace(PROJECT);
      const result = await runCommand({
        projectId: PROJECT,
        executable: process.execPath,
        args: ["-e", "console.log(JSON.stringify(process.env))"],
        allowedExecutables: [process.execPath],
        purpose: "test",
      });
      assert.ok(!result.stdout.includes("leak-me-not"), "an arbitrary env var from the host process must never reach the child");
    } finally {
      delete process.env.AI_OFFICE_TEST_SECRET_SENTINEL;
    }
  });
});

async function getFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

describe("startManagedProcess — real full-stack execution support (Priority 0 #8)", () => {
  test("rejects an executable not in the caller-supplied allowlist, without ever spawning it", async () => {
    await createWorkspace(PROJECT);
    assert.throws(
      () => startManagedProcess({ projectId: PROJECT, executable: "rm", args: ["-rf", "/"], allowedExecutables: ["node"], purpose: "test" }),
      CommandNotAllowedError,
    );
  });

  test("refuses to start against a project with no workspace yet", async () => {
    assert.throws(
      () => startManagedProcess({ projectId: "55555555-5555-5555-5555-555555555555", executable: "node", args: ["-e", "1"], allowedExecutables: ["node"], purpose: "test" }),
      WorkspaceNotFoundError,
    );
  });

  test("starts a real long-running server, a caller can really connect to it, then stop() cleanly terminates it", async () => {
    await createWorkspace(PROJECT);
    const port = await getFreePort();
    const proc = startManagedProcess({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "require('http').createServer((req,res)=>{res.end('alive')}).listen(Number(process.env.VERIFY_PORT),'127.0.0.1')"],
      allowedExecutables: [process.execPath],
      purpose: "test",
      env: { VERIFY_PORT: String(port) },
    });

    try {
      // Poll — a real spawned process needs a moment to actually bind its listener.
      let body: string | null = null;
      for (let i = 0; i < 50 && body === null; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          body = await res.text();
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      assert.equal(body, "alive", "the real spawned process must really be reachable on the port its env var named");
      assert.equal(proc.hasExited(), false);
      assert.equal(typeof proc.pid, "number");

      await proc.stop();
      assert.equal(proc.hasExited(), true);
      await assert.rejects(() => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }), "the port must actually be free again after stop() resolves");
    } finally {
      await proc.stop(); // safe even if already stopped — idempotency guard below also covers this
    }
  });

  test("a process that exits on its own is observable via hasExited()/exitInfo() without stop() ever being called", async () => {
    await createWorkspace(PROJECT);
    const proc = startManagedProcess({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "process.exit(7)"],
      allowedExecutables: [process.execPath],
      purpose: "test",
    });
    for (let i = 0; i < 50 && !proc.hasExited(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(proc.hasExited(), true);
    assert.equal(proc.exitInfo()?.exitCode, 7);
  });

  test("stop() is safe to call more than once, and on an already-exited process", async () => {
    await createWorkspace(PROJECT);
    const proc = startManagedProcess({
      projectId: PROJECT,
      executable: process.execPath,
      args: ["-e", "process.exit(0)"],
      allowedExecutables: [process.execPath],
      purpose: "test",
    });
    for (let i = 0; i < 50 && !proc.hasExited(); i++) await new Promise((r) => setTimeout(r, 50));
    await proc.stop();
    await proc.stop();
  });

  test("custom env merges on top of the same sanitized allowlist runCommand uses — an arbitrary host secret still never reaches the child", async () => {
    process.env.AI_OFFICE_TEST_SECRET_SENTINEL = "leak-me-not";
    try {
      await createWorkspace(PROJECT);
      const proc = startManagedProcess({
        projectId: PROJECT,
        executable: process.execPath,
        args: ["-e", "console.log('MARKER:' + process.env.MY_CUSTOM_VAR + ':' + ('AI_OFFICE_TEST_SECRET_SENTINEL' in process.env)); setTimeout(() => {}, 5000)"],
        allowedExecutables: [process.execPath],
        purpose: "test",
        env: { MY_CUSTOM_VAR: "visible" },
      });
      for (let i = 0; i < 50 && !proc.getOutput().stdout.includes("MARKER:"); i++) await new Promise((r) => setTimeout(r, 50));
      assert.match(proc.getOutput().stdout, /MARKER:visible:false/);
      await proc.stop();
    } finally {
      delete process.env.AI_OFFICE_TEST_SECRET_SENTINEL;
    }
  });
});
