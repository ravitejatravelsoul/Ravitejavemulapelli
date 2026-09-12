import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../workspace-service.ts";
import { runCommand, CommandNotAllowedError, WorkspaceNotFoundError } from "../command-execution-service.ts";

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
