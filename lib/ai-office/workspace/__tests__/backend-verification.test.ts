import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, createWorkspace } from "../workspace-service.ts";
import { runBackendVerification } from "../backend-verification.ts";

/**
 * Real end-to-end coverage for Priority 0 #8's first increment: a real
 * `npm install` + `npm start` against a real (tiny, zero-dependency, so
 * this stays fast and offline-safe) generated backend project, with a
 * real spawned process actually answering a real HTTP request — not a
 * mock of any of these steps. The zero-dependency choice is the only
 * thing keeping `npm install` from needing real network access in this
 * test suite; the module itself places no such restriction on a real
 * generated project.
 */

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-backend-verify-test-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
});

afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(workspaceRoot, { recursive: true, force: true });
});

const WORKING_SERVER_JS = `
const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dbPath: process.env.DB_PATH ?? null }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

describe("runBackendVerification", () => {
  test("returns FAIL immediately when no workspace exists — never attempts npm install", async () => {
    const result = await runBackendVerification("no-such-backend-project");
    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /no workspace/i);
  });

  test("returns FAIL when the workspace exists but has no package.json", async () => {
    await createWorkspace("no-package-json-project");
    const result = await runBackendVerification("no-package-json-project");
    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /package\.json/i);
  });

  test("returns FAIL when package.json is not valid JSON", async () => {
    await writeFile("bad-json-project", "package.json", "{ not valid json");
    const result = await runBackendVerification("bad-json-project");
    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /not valid JSON/i);
  });

  test('returns FAIL when package.json has no "start" script — this environment never guesses which file to run', async () => {
    await writeFile("no-start-script-project", "package.json", JSON.stringify({ name: "x", version: "1.0.0" }));
    const result = await runBackendVerification("no-start-script-project");
    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /"start" script/i);
  });

  test("a real backend really starts via npm install + npm start, binds a real dynamic port, and answers a real HTTP request — then is fully torn down", async () => {
    const id = "real-backend-project";
    await writeFile(id, "package.json", JSON.stringify({ name: id, version: "1.0.0", scripts: { start: "node server.js" } }));
    await writeFile(id, "server.js", WORKING_SERVER_JS);

    const result = await runBackendVerification(id, { healthPath: "/health" });

    assert.equal(result.status, "PASS", JSON.stringify(result));
    assert.equal(result.details.healthStatus, 200);
    assert.equal(typeof result.details.port, "number");

    // Real teardown — the port must actually be free again, not just reported as stopped.
    await assert.rejects(() => fetch(`http://127.0.0.1:${result.details.port}/health`, { signal: AbortSignal.timeout(500) }));
  });

  test("the backend's own DB_PATH env var points at a real, isolated, per-run scratch file — never a fixed or shared path", async () => {
    const id = "db-path-project";
    await writeFile(id, "package.json", JSON.stringify({ name: id, version: "1.0.0", scripts: { start: "node server.js" } }));
    await writeFile(id, "server.js", WORKING_SERVER_JS);

    const resultA = await runBackendVerification(id, { healthPath: "/health" });
    const resultB = await runBackendVerification(id, { healthPath: "/health" });

    assert.equal(resultA.status, "PASS", JSON.stringify(resultA));
    assert.equal(resultB.status, "PASS", JSON.stringify(resultB));
    const dbPathA = (JSON.parse(String(resultA.details.healthBody)) as { dbPath: string | null }).dbPath;
    const dbPathB = (JSON.parse(String(resultB.details.healthBody)) as { dbPath: string | null }).dbPath;
    assert.ok(dbPathA && dbPathB, "the backend must really receive a DB_PATH env var");
    assert.notEqual(dbPathA, dbPathB, "each verification run must get its own isolated, ephemeral DB file — never a shared or fixed path");
  });

  test("a backend that crashes immediately is reported as FAIL with the real exit code, not a timeout", async () => {
    const id = "crashing-backend-project";
    await writeFile(id, "package.json", JSON.stringify({ name: id, version: "1.0.0", scripts: { start: "node crash.js" } }));
    await writeFile(id, "crash.js", "console.error('boom'); process.exit(3);");

    const result = await runBackendVerification(id, { startTimeoutMs: 5000 });

    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /exited on its own/i);
    assert.match(result.summary, /3/);
    assert.match(String(result.details.stderr), /boom/);
  });

  test("a backend that never binds its port is reported as FAIL with a startup-timeout reason, and is still cleanly stopped", async () => {
    const id = "hanging-backend-project";
    await writeFile(id, "package.json", JSON.stringify({ name: id, version: "1.0.0", scripts: { start: "node hang.js" } }));
    await writeFile(id, "hang.js", "setInterval(() => {}, 1000);"); // alive, never listens on anything

    const result = await runBackendVerification(id, { startTimeoutMs: 1500 });

    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /never responded/i);
  });
});
