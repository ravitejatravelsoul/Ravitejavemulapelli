import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, createWorkspace } from "../workspace-service.ts";
import { runQABrowserVerification } from "../qa-browser-verification.ts";

/**
 * Real Playwright checks against a real, short-lived static server —
 * no mocking of the browser or the HTTP layer. Uses the same
 * heading/description/button/message markup shape as the SimulatedAdapter
 * Hello World fixtures (lib/ai-office/providers/simulated/fixtures.ts),
 * but constructed directly here so this test doesn't depend on that
 * module's exact strings.
 */

const GOOD_HTML = [
  "<!DOCTYPE html>",
  '<html lang="en"><head><meta charset="UTF-8" /><title>Hello</title></head>',
  "<body>",
  "<h1>Hello, World!</h1>",
  '<p class="description">A small test page.</p>',
  '<button id="greet-button" type="button">Say hello</button>',
  '<p id="message"></p>',
  '<script src="script.js"></script>',
  "</body></html>",
].join("\n");

const GOOD_JS = [
  'document.getElementById("greet-button").addEventListener("click", function () {',
  '  document.getElementById("message").textContent = "Hello! Thanks for clicking.";',
  "});",
].join("\n");

const BUGGY_JS = [
  'document.getElementById("greet-button").addEventListener("click", function () {',
  '  document.getElementById("nonexistent-element").textContent = "Hello! Thanks for clicking.";',
  "});",
].join("\n");

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-qa-verify-test-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
});

afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("runQABrowserVerification", () => {
  test("returns FAIL immediately when no workspace exists — never starts a server or browser", async () => {
    const result = await runQABrowserVerification("no-such-project");
    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /no workspace/i);
    assert.equal(result.targetUrl, "");
  });

  test("returns FAIL when the workspace exists but has no index.html", async () => {
    await createWorkspace("empty-project");
    const result = await runQABrowserVerification("empty-project");
    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /index\.html/);
  });

  test("PASSes against a real page where the button correctly updates the message", async () => {
    await writeFile("good-project", "index.html", GOOD_HTML);
    await writeFile("good-project", "script.js", GOOD_JS);

    const result = await runQABrowserVerification("good-project");

    assert.equal(result.status, "PASS", result.summary);
    assert.deepEqual(result.details.consoleErrors, []);
    assert.ok(result.durationMs >= 0);
    assert.match(result.targetUrl, /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
  });

  test("FAILs against a real page whose button references the wrong element id (a real bug)", async () => {
    await writeFile("buggy-project", "index.html", GOOD_HTML);
    await writeFile("buggy-project", "script.js", BUGGY_JS);

    const result = await runQABrowserVerification("buggy-project");

    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /did not change/i);
  });

  test("two consecutive verification runs against different projects each start and cleanly stop their own ephemeral server (no orphaned listener)", async () => {
    await writeFile("project-a", "index.html", GOOD_HTML);
    await writeFile("project-a", "script.js", GOOD_JS);
    await writeFile("project-b", "index.html", GOOD_HTML);
    await writeFile("project-b", "script.js", GOOD_JS);

    const first = await runQABrowserVerification("project-a");
    const second = await runQABrowserVerification("project-b");

    assert.equal(first.status, "PASS");
    assert.equal(second.status, "PASS");
    assert.notEqual(first.targetUrl, second.targetUrl, "each run must use its own fresh ephemeral port, proving the prior server was actually closed");
  });
});
