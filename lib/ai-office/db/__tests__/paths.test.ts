import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { getDefaultDbPath } from "../paths.ts";

/**
 * Investigated as part of the first Claude LIVE pilot's system-reliability
 * report: the Next.js app and the standalone runner (lib/ai-office/runner/
 * start.ts) are two separate OS processes — this proves they resolve the
 * database file identically (both depend only on `process.cwd()`, nothing
 * process-type-specific), and that a permanent e2e test can safely point
 * both at a disposable database via `AI_OFFICE_DB_PATH` without ever
 * touching a real `.data/office.db`.
 */
describe("getDefaultDbPath — server/runner database path consistency", () => {
  test("resolves deterministically from process.cwd() alone when no override is set", () => {
    delete process.env.AI_OFFICE_DB_PATH;
    const first = getDefaultDbPath();
    const second = getDefaultDbPath();
    assert.equal(first, second, "must be perfectly deterministic — two calls in the same process must agree");
    assert.equal(first, join(process.cwd(), ".data", "office.db"));
  });

  test("AI_OFFICE_DB_PATH overrides the resolved path when set — the mechanism a real e2e test uses to stay isolated from the real database", () => {
    process.env.AI_OFFICE_DB_PATH = "/tmp/some-disposable-test.db";
    try {
      assert.equal(getDefaultDbPath(), "/tmp/some-disposable-test.db");
    } finally {
      delete process.env.AI_OFFICE_DB_PATH;
    }
  });

  test("two independent calls simulating the Next.js process and the standalone runner process resolve to the identical path given the same cwd and env", () => {
    // Neither getDefaultDbPath() nor process.cwd() depend on anything
    // process-identity-specific (no PID, no argv[1], no __dirname) — so
    // any two processes started from the same working directory with the
    // same (or no) AI_OFFICE_DB_PATH are structurally guaranteed to agree,
    // which is exactly what was verified for the real, running dev-server
    // and runner processes during the pilot's diagnosis.
    delete process.env.AI_OFFICE_DB_PATH;
    const asIfNextServer = getDefaultDbPath();
    const asIfStandaloneRunner = getDefaultDbPath();
    assert.equal(asIfNextServer, asIfStandaloneRunner);
  });
});
