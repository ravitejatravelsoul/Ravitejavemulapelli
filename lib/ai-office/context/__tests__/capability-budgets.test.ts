import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCapabilityContextBudget,
  DEFAULT_CAPABILITY_CONTEXT_BUDGETS,
  GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS,
  getGlobalAbsoluteMaxEstimatedInputTokens,
} from "../capability-budgets.ts";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  delete process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES;
  delete process.env.AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getCapabilityContextBudget", () => {
  test("CODING gets a larger output ceiling than FAST/GENERAL — role-specific limits", () => {
    const coding = getCapabilityContextBudget("CODING");
    const fast = getCapabilityContextBudget("FAST");
    const general = getCapabilityContextBudget("GENERAL");
    assert.ok(coding.maxOutputTokens > general.maxOutputTokens);
    assert.ok(general.maxOutputTokens > fast.maxOutputTokens);
  });

  test("every default capability's target AND burst stay under the global absolute ceiling", () => {
    for (const capability of Object.keys(DEFAULT_CAPABILITY_CONTEXT_BUDGETS) as Array<keyof typeof DEFAULT_CAPABILITY_CONTEXT_BUDGETS>) {
      const budget = DEFAULT_CAPABILITY_CONTEXT_BUDGETS[capability];
      assert.ok(budget.targetEstimatedInputTokens < GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS);
      assert.ok(budget.burstEstimatedInputTokens < GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS);
    }
  });

  test("every default capability's burst is strictly greater than its target — a real, deliberate tolerance", () => {
    for (const capability of Object.keys(DEFAULT_CAPABILITY_CONTEXT_BUDGETS) as Array<keyof typeof DEFAULT_CAPABILITY_CONTEXT_BUDGETS>) {
      const budget = DEFAULT_CAPABILITY_CONTEXT_BUDGETS[capability];
      assert.ok(budget.burstEstimatedInputTokens > budget.targetEstimatedInputTokens);
    }
  });

  test("the exact requested starting policy: target/burst pairs match spec", () => {
    assert.deepEqual(
      [DEFAULT_CAPABILITY_CONTEXT_BUDGETS.GENERAL.targetEstimatedInputTokens, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.GENERAL.burstEstimatedInputTokens],
      [6_000, 8_000],
    );
    assert.deepEqual(
      [DEFAULT_CAPABILITY_CONTEXT_BUDGETS.REASONING.targetEstimatedInputTokens, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.REASONING.burstEstimatedInputTokens],
      [9_000, 12_000],
    );
    assert.deepEqual(
      [DEFAULT_CAPABILITY_CONTEXT_BUDGETS.CODING.targetEstimatedInputTokens, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.CODING.burstEstimatedInputTokens],
      [18_000, 24_000],
    );
    assert.deepEqual(
      [DEFAULT_CAPABILITY_CONTEXT_BUDGETS.REVIEW.targetEstimatedInputTokens, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.REVIEW.burstEstimatedInputTokens],
      [10_000, 14_000],
    );
    assert.deepEqual(
      [DEFAULT_CAPABILITY_CONTEXT_BUDGETS.FAST.targetEstimatedInputTokens, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.FAST.burstEstimatedInputTokens],
      [3_000, 4_000],
    );
    assert.equal(GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS, 40_000);
  });

  test("a role with no legitimate reason to see files gets maxFiles 0", () => {
    assert.equal(getCapabilityContextBudget("GENERAL").maxFiles, 0);
    assert.equal(getCapabilityContextBudget("FAST").maxFiles, 0);
  });

  test("an env override changes one field for one capability without affecting others", () => {
    process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES = JSON.stringify({ CODING: { burstEstimatedInputTokens: 30000 } });
    assert.equal(getCapabilityContextBudget("CODING").burstEstimatedInputTokens, 30000);
    assert.equal(getCapabilityContextBudget("CODING").targetEstimatedInputTokens, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.CODING.targetEstimatedInputTokens);
    assert.equal(getCapabilityContextBudget("REVIEW").burstEstimatedInputTokens, DEFAULT_CAPABILITY_CONTEXT_BUDGETS.REVIEW.burstEstimatedInputTokens, "other capabilities unaffected");
  });

  test("malformed override JSON is ignored, falling back to defaults rather than throwing", () => {
    process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES = "{not valid json";
    assert.deepEqual(getCapabilityContextBudget("CODING"), DEFAULT_CAPABILITY_CONTEXT_BUDGETS.CODING);
  });
});

describe("getGlobalAbsoluteMaxEstimatedInputTokens", () => {
  test("defaults to 40,000 with no override configured", () => {
    assert.equal(getGlobalAbsoluteMaxEstimatedInputTokens(), 40_000);
  });

  test("is configurable via AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS", () => {
    process.env.AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS = "50000";
    assert.equal(getGlobalAbsoluteMaxEstimatedInputTokens(), 50_000);
  });

  test("an invalid override value falls back to the default rather than disabling the ceiling", () => {
    process.env.AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS = "not-a-number";
    assert.equal(getGlobalAbsoluteMaxEstimatedInputTokens(), 40_000);
    process.env.AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS = "-5";
    assert.equal(getGlobalAbsoluteMaxEstimatedInputTokens(), 40_000);
  });
});
