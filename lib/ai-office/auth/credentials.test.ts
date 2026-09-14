import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// Explicit ".ts" extension — required for plain Node ESM resolution, same
// as token.test.ts (see that file's comment for why).
import { hashOwnerPassword, verifyOwnerCredentials } from "./credentials.ts";

/**
 * Node's built-in test runner (`node:test`), run via `npm run test:ai-office`
 * (see token.test.ts for the `--conditions=react-server` explanation).
 *
 * Covers the production auth fix: in production, `verifyOwnerCredentials`
 * must check `OFFICE_OWNER_EMAIL`/`OFFICE_OWNER_PASSWORD_HASH` directly and
 * never touch SQLite (Vercel's serverless filesystem isn't durable/shared
 * across instances, so a `users` row seeded on one instance can't be relied
 * on by another). Outside production, the existing SQLite-backed behavior
 * must be unchanged.
 */

// `NODE_ENV` is typed read-only on `process.env` — replace the whole
// object rather than assigning/deleting the single key, matching the
// pattern used elsewhere in this codebase for tests that vary NODE_ENV
// (see lib/ai-office/config/__tests__/operational-mode.test.ts).
const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function setEnv(vars: {
  NODE_ENV?: string;
  OFFICE_OWNER_EMAIL?: string;
  OFFICE_OWNER_PASSWORD_HASH?: string;
}): void {
  const next = { ...ORIGINAL_ENV } as Record<string, string | undefined>;
  delete next.NODE_ENV;
  delete next.OFFICE_OWNER_EMAIL;
  delete next.OFFICE_OWNER_PASSWORD_HASH;
  Object.assign(next, vars);
  process.env = next as NodeJS.ProcessEnv;
}

/**
 * Points `AI_OFFICE_DB_PATH` at a location SQLite cannot possibly open
 * (a path nested under a plain *file*, not a directory) — so if the
 * production path under test ever accidentally called `getAppDatabase()`,
 * that call would throw (`mkdirSync` on a parent that isn't a directory
 * fails with ENOTDIR) and the test would fail loudly instead of silently
 * passing because a real, working local DB happened to be available.
 * `AI_OFFICE_DB_PATH` isn't typed read-only, so a direct assignment (after
 * `setEnv` has already run) is fine here.
 */
function poisonSqlitePath(): void {
  const dir = mkdtempSync(join(tmpdir(), "ai-office-credentials-test-"));
  const notADirectory = join(dir, "not-a-directory");
  writeFileSync(notADirectory, "");
  process.env.AI_OFFICE_DB_PATH = join(notADirectory, "office.db");
}

const PASSWORD = "correct-horse-battery-staple-42!";
const EMAIL = "boss@tejas-ai-office.local";

test("production: correct email + password passes", () => {
  const hash = hashOwnerPassword(PASSWORD);
  setEnv({ NODE_ENV: "production", OFFICE_OWNER_EMAIL: EMAIL, OFFICE_OWNER_PASSWORD_HASH: hash });
  poisonSqlitePath();

  const result = verifyOwnerCredentials(EMAIL, PASSWORD);
  assert.equal(result, true);
});

test("production: email is compared case-insensitively and trimmed, matching local normalization", () => {
  const hash = hashOwnerPassword(PASSWORD);
  setEnv({ NODE_ENV: "production", OFFICE_OWNER_EMAIL: EMAIL, OFFICE_OWNER_PASSWORD_HASH: hash });
  poisonSqlitePath();

  const result = verifyOwnerCredentials("  BOSS@Tejas-AI-Office.Local  ", PASSWORD);
  assert.equal(result, true);
});

test("production: wrong email fails", () => {
  const hash = hashOwnerPassword(PASSWORD);
  setEnv({ NODE_ENV: "production", OFFICE_OWNER_EMAIL: EMAIL, OFFICE_OWNER_PASSWORD_HASH: hash });
  poisonSqlitePath();

  const result = verifyOwnerCredentials("someone-else@tejas-ai-office.local", PASSWORD);
  assert.equal(result, false);
});

test("production: wrong password fails", () => {
  const hash = hashOwnerPassword(PASSWORD);
  setEnv({ NODE_ENV: "production", OFFICE_OWNER_EMAIL: EMAIL, OFFICE_OWNER_PASSWORD_HASH: hash });
  poisonSqlitePath();

  const result = verifyOwnerCredentials(EMAIL, "wrong-password");
  assert.equal(result, false);
});

test("production: fails closed when OFFICE_OWNER_EMAIL is missing", () => {
  const hash = hashOwnerPassword(PASSWORD);
  setEnv({ NODE_ENV: "production", OFFICE_OWNER_PASSWORD_HASH: hash });
  poisonSqlitePath();

  const result = verifyOwnerCredentials(EMAIL, PASSWORD);
  assert.equal(result, false);
});

test("production: fails closed when OFFICE_OWNER_PASSWORD_HASH is missing", () => {
  setEnv({ NODE_ENV: "production", OFFICE_OWNER_EMAIL: EMAIL });
  poisonSqlitePath();

  const result = verifyOwnerCredentials(EMAIL, PASSWORD);
  assert.equal(result, false);
});

test("production: fails closed when OFFICE_OWNER_PASSWORD_HASH is malformed", () => {
  setEnv({
    NODE_ENV: "production",
    OFFICE_OWNER_EMAIL: EMAIL,
    OFFICE_OWNER_PASSWORD_HASH: "not-a-valid-salt-colon-hash-value",
  });
  poisonSqlitePath();

  const result = verifyOwnerCredentials(EMAIL, PASSWORD);
  assert.equal(result, false);
});

test("production: verification does not require SQLite (never throws even with an unusable DB path)", () => {
  const hash = hashOwnerPassword(PASSWORD);
  setEnv({ NODE_ENV: "production", OFFICE_OWNER_EMAIL: EMAIL, OFFICE_OWNER_PASSWORD_HASH: hash });
  poisonSqlitePath();

  assert.doesNotThrow(() => {
    verifyOwnerCredentials(EMAIL, PASSWORD);
  });
});

test("non-production: SQLite-backed verification still fails for an unseeded/unreachable DB (no regression, fails closed)", () => {
  const hash = hashOwnerPassword(PASSWORD);
  setEnv({ NODE_ENV: "test", OFFICE_OWNER_EMAIL: EMAIL, OFFICE_OWNER_PASSWORD_HASH: hash });
  poisonSqlitePath();

  // Outside production, credentials are checked against the `users` table,
  // not the env vars directly — a poisoned/unreachable DB path must fail
  // closed (never throw), exactly like the pre-fix behavior.
  const result = verifyOwnerCredentials(EMAIL, PASSWORD);
  assert.equal(result, false);
});

test("non-production: env vars alone are not sufficient to log in (would require the seeded users row, unlike production)", () => {
  const hash = hashOwnerPassword(PASSWORD);
  setEnv({ NODE_ENV: "development", OFFICE_OWNER_EMAIL: EMAIL, OFFICE_OWNER_PASSWORD_HASH: hash });
  poisonSqlitePath();

  const result = verifyOwnerCredentials(EMAIL, PASSWORD);
  assert.equal(result, false);
});
