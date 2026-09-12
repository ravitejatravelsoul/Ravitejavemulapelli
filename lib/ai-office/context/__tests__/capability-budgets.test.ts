import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getCapabilityContextBudget, DEFAULT_CAPABILITY_CONTEXT_BUDGETS, HARD_MAX_ESTIMATED_INPUT_TOKENS } from "../capability-budgets.ts";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  delete process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getCapabilityContextBudget", () => {
  test("CODING gets a larger output ceiling than FAST/GENERAL — Part 7's role-specific limits", () => {
    const coding = getCapabilityContextBudget("CODING");
    const fast = getCapabilityContextBudget("FAST");
    const general = getCapabilityContextBudget("GENERAL");
    assert.ok(coding.maxOutputTokens > general.maxOutputTokens);
    assert.ok(general.maxOutputTokens > fast.maxOutputTokens);
  });

  test("every default capability budget stays under the absolute hard limit", () => {
    for (const capability of Object.keys(DEFAULT_CAPABILITY_CONTEXT_BUDGETS) as Array<keyof typeof DEFAULT_CAPABILITY_CONTEXT_BUDGETS>) {
      assert.ok(DEFAULT_CAPABILITY_CONTEXT_BUDGETS[capability].maxEstimatedInputTokens < HARD_MAX_ESTIMATED_INPUT_TOKENS);
    }
  });

  test("a role with no legitimate reason to see files gets maxFiles 0", () => {
    assert.equal(getCapabilityContextBudget("GENERAL").maxFiles, 0);
    assert.equal(getCapabilityContextBudget("FAST").maxFiles, 0);
  });

  test("an env override changes one field for one capability without affecting others", () => {
    process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES = JSON.stringify({ CODING: { maxOutputTokens: 6000 } });
    assert.equal(getCapabilityContextBudget("CODING").maxOutputTokens, 6000);
    assert.equal(getCapabilityContextBudget("CODING").maxFiles, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.CODING.maxFiles, "unrelated fields keep their default");
    assert.equal(getCapabilityContextBudget("REVIEW").maxOutputTokens, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.REVIEW.maxOutputTokens, "other capabilities unaffected");
  });

  test("malformed override JSON is ignored, falling back to defaults rather than throwing", () => {
    process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES = "{not valid json";
    assert.deepEqual(getCapabilityContextBudget("CODING"), DEFAULT_CAPABILITY_CONTEXT_BUDGETS.CODING);
  });
});
