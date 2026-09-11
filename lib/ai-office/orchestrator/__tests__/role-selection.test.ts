import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { selectRoles, requiresOwnerApproval } from "../role-selection.ts";

describe("selectRoles — deterministic keyword classifier", () => {
  test("a small, unambiguous backend-only idea skips UI/UX and Frontend", () => {
    const { roles } = selectRoles(
      "Write a backend utility function that validates email address formatting according to RFC 5322 rules.",
    );
    assert.ok(!roles.includes("ui-ux-agent"), "should not include ui-ux-agent");
    assert.ok(!roles.includes("frontend-developer"), "should not include frontend-developer");
    assert.ok(roles.includes("backend-developer"));
    assert.ok(roles.includes("product-owner"));
    assert.ok(roles.includes("qa-agent"));
    assert.ok(roles.includes("code-reviewer"));
    assert.ok(roles.includes("release-agent"));
  });

  test("a web-app idea includes UI/UX and Frontend", () => {
    const { roles, rationale } = selectRoles(
      "Build a small web application where manual testers capture screenshots, organize them into steps, and export a test report.",
    );
    assert.ok(roles.includes("ui-ux-agent"));
    assert.ok(roles.includes("frontend-developer"));
    assert.ok(rationale.some((r) => r.includes("UI/screen signal")));
  });

  test("an idea mentioning auth/login includes security-reviewer", () => {
    const { roles } = selectRoles("Build a login page with password reset for our internal tool.");
    assert.ok(roles.includes("security-reviewer"));
  });

  test("an idea with no security signal excludes security-reviewer", () => {
    const { roles } = selectRoles("Build a small CLI that reformats CSV files into JSON.");
    assert.ok(!roles.includes("security-reviewer"));
  });

  test("a very short idea includes research-agent even without an explicit research keyword", () => {
    const { roles, rationale } = selectRoles("Build a note app.");
    assert.ok(roles.includes("research-agent"));
    assert.ok(rationale.some((r) => r.includes("very short")));
  });

  test("an idea explicitly asking to research/explore includes research-agent", () => {
    const { roles } = selectRoles(
      "We want to research and investigate the feasibility of syncing data across three different unfamiliar third-party services before committing to an architecture.",
    );
    assert.ok(roles.includes("research-agent"));
  });

  test("result is deterministic — identical input produces identical output across repeated calls", () => {
    const text = "Build a small web application for tracking personal reading habits with login.";
    const first = selectRoles(text);
    const second = selectRoles(text);
    assert.deepEqual(first, second);
  });

  test("always includes the universal roles regardless of idea content", () => {
    const { roles } = selectRoles("x");
    for (const universal of ["product-owner", "solution-architect", "backend-developer", "qa-agent", "code-reviewer", "release-agent"]) {
      assert.ok(roles.includes(universal), `expected ${universal} to always be included`);
    }
  });
});

describe("requiresOwnerApproval — synthetic approval signal", () => {
  test("an idea mentioning a paid/purchase signal requires approval", () => {
    const result = requiresOwnerApproval("Integrate a paid service subscription for SMS notifications.");
    assert.equal(result.required, true);
    assert.ok(result.matchedSignal);
  });

  test("an idea with no approval signal does not require approval", () => {
    const result = requiresOwnerApproval("Build a small tool to reformat CSV files.");
    assert.equal(result.required, false);
  });
});
