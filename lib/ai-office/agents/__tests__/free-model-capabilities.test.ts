import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requiredCapabilitiesForRole, primaryCapabilityForRole, TASK_CAPABILITIES, isTaskCapability } from "../free-model-capabilities.ts";

describe("free-model-capabilities", () => {
  test("TASK_CAPABILITIES lists exactly the 10 capabilities the brief requires", () => {
    assert.deepEqual(
      [...TASK_CAPABILITIES].sort(),
      ["ARCHITECTURE", "CODING", "FAST", "GENERAL", "REASONING", "RESEARCH", "REVIEW", "SECURITY", "STRUCTURED_OUTPUT", "TEST_GENERATION"],
    );
  });

  test("every real agent role maps to at least one capability, primary capability matches the first entry", () => {
    for (const role of [
      "product-owner",
      "research-agent",
      "ui-ux-agent",
      "solution-architect",
      "frontend-developer",
      "backend-developer",
      "qa-agent",
      "security-reviewer",
      "code-reviewer",
      "release-agent",
      "orchestrator",
    ]) {
      const caps = requiredCapabilitiesForRole(role);
      assert.ok(caps.length > 0, `${role} should have at least one required capability`);
      assert.equal(primaryCapabilityForRole(role), caps[0]);
    }
  });

  test("solution-architect's primary capability is ARCHITECTURE, qa-agent's is TEST_GENERATION — matching the brief's example tendencies", () => {
    assert.equal(primaryCapabilityForRole("solution-architect"), "ARCHITECTURE");
    assert.equal(primaryCapabilityForRole("qa-agent"), "TEST_GENERATION");
    assert.equal(primaryCapabilityForRole("security-reviewer"), "SECURITY");
    assert.equal(primaryCapabilityForRole("release-agent"), "FAST");
  });

  test("an unknown/future role falls back to GENERAL rather than throwing", () => {
    assert.deepEqual(requiredCapabilitiesForRole("some-future-role"), ["GENERAL"]);
    assert.equal(primaryCapabilityForRole("some-future-role"), "GENERAL");
  });

  test("isTaskCapability narrows correctly", () => {
    assert.equal(isTaskCapability("CODING"), true);
    assert.equal(isTaskCapability("NOT_A_CAPABILITY"), false);
  });
});
