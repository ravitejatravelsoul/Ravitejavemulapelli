import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isAiOfficeOperationalModeEnabled } from "../operational-mode.ts";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** `NODE_ENV` is typed read-only on `process.env` — replace the whole object rather than assigning/deleting the single key, matching the pattern used elsewhere in this codebase for tests that vary NODE_ENV. */
function setEnv(vars: { AI_OFFICE_OPERATIONAL_MODE?: string; NODE_ENV?: string }): void {
  const next = { ...ORIGINAL_ENV } as Record<string, string | undefined>;
  delete next.AI_OFFICE_OPERATIONAL_MODE;
  delete next.NODE_ENV;
  Object.assign(next, vars);
  process.env = next as NodeJS.ProcessEnv;
}

describe("isAiOfficeOperationalModeEnabled — the V1 limited-production safety guard", () => {
  test("explicit 'enabled' is always true, regardless of NODE_ENV", () => {
    setEnv({ AI_OFFICE_OPERATIONAL_MODE: "enabled", NODE_ENV: "production" });
    assert.equal(isAiOfficeOperationalModeEnabled(), true);
  });

  test("explicit 'disabled' is always false, even outside production", () => {
    setEnv({ AI_OFFICE_OPERATIONAL_MODE: "disabled" });
    assert.equal(isAiOfficeOperationalModeEnabled(), false);
  });

  test("unset + NODE_ENV=production defaults to disabled — the safe default, no separate lock-down step required", () => {
    setEnv({ NODE_ENV: "production" });
    assert.equal(isAiOfficeOperationalModeEnabled(), false);
  });

  test("unset + NODE_ENV unset/development stays fully operational — local dev is never affected", () => {
    setEnv({});
    assert.equal(isAiOfficeOperationalModeEnabled(), true);

    setEnv({ NODE_ENV: "development" });
    assert.equal(isAiOfficeOperationalModeEnabled(), true);
  });

  test("an unrecognized override value is treated the same as unset (falls back to the NODE_ENV default), never silently enabling production", () => {
    setEnv({ AI_OFFICE_OPERATIONAL_MODE: "yes-please", NODE_ENV: "production" });
    assert.equal(isAiOfficeOperationalModeEnabled(), false);
  });
});
