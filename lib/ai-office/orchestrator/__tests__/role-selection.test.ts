import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { selectRoles, requiresOwnerApproval, requiresDeploymentApproval } from "../role-selection.ts";

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

  test("always includes the truly universal roles regardless of idea content", () => {
    const { roles } = selectRoles("x");
    for (const universal of ["product-owner", "solution-architect", "qa-agent", "code-reviewer", "release-agent"]) {
      assert.ok(roles.includes(universal), `expected ${universal} to always be included`);
    }
  });

  test("an idea with no UI signal and no backend signal still gets a development role (fallback default: backend-developer)", () => {
    const { roles } = selectRoles("x");
    assert.ok(roles.includes("backend-developer"));
    assert.ok(!roles.includes("frontend-developer"));
  });
});

describe("selectRoles — capability-driven backend selection (Phase 8 follow-up)", () => {
  test('"Create a static landing page with a heading and button." — frontend yes, backend no', () => {
    const { roles } = selectRoles("Create a static landing page with a heading and button.");
    assert.ok(roles.includes("frontend-developer"), "expected frontend-developer");
    assert.ok(!roles.includes("backend-developer"), "a static landing page needs no backend");
  });

  test('"Build a todo page using browser localStorage." — frontend yes, backend no', () => {
    const { roles } = selectRoles("Build a todo page using browser localStorage.");
    assert.ok(roles.includes("frontend-developer"), "expected frontend-developer");
    assert.ok(!roles.includes("backend-developer"), "client-side-only storage needs no backend");
  });

  test('"Build a todo app with server persistence and REST API." — frontend yes, backend yes', () => {
    const { roles } = selectRoles("Build a todo app with server persistence and REST API.");
    assert.ok(roles.includes("frontend-developer"), "expected frontend-developer");
    assert.ok(roles.includes("backend-developer"), "server persistence and a REST API are explicit backend signals");
  });

  test('"Build an authenticated dashboard backed by a database." — backend yes', () => {
    const { roles } = selectRoles("Build an authenticated dashboard backed by a database.");
    assert.ok(roles.includes("backend-developer"), "a database is an explicit backend signal");
  });

  test("a generic implementation-logic idea with neither signal still gets exactly one development role, not zero", () => {
    const { roles } = selectRoles("Build a small tool.");
    const devRoles = roles.filter((r) => r === "frontend-developer" || r === "backend-developer");
    assert.equal(devRoles.length, 1, "every project needs at least one development role");
  });

  test('"webpage" (one word, no space) is recognized as a UI signal — a real acceptance run surfaced this exact wording incorrectly falling through to the backend default', () => {
    const { roles } = selectRoles(
      "Create a small modern Hello World webpage with a heading, a short description, and a button. Clicking the button should change visible text.",
    );
    assert.ok(roles.includes("frontend-developer"), "expected frontend-developer");
    assert.ok(roles.includes("ui-ux-agent"), "expected ui-ux-agent");
    assert.ok(!roles.includes("backend-developer"), "a static Hello World webpage needs no backend");
  });

  test('a negated backend/database mention ("work without requiring a backend or database") does not select backend-developer — a real UI acceptance run surfaced this exact false positive', () => {
    const { roles } = selectRoles(
      "Create a polished modern task manager web application. Users should be able to add tasks, mark tasks complete, delete tasks, and see counts for total, active, and completed tasks. The application should have a clean responsive design and work without requiring a backend or database. Keep the implementation simple and reliable.",
    );
    assert.ok(roles.includes("frontend-developer"), "expected frontend-developer");
    assert.ok(!roles.includes("backend-developer"), "the idea explicitly says no backend/database is required");
  });

  test("a genuine (non-negated) backend/database mention still selects backend-developer", () => {
    const { roles } = selectRoles("Build a task manager that stores tasks in a database with a REST API.");
    assert.ok(roles.includes("backend-developer"), "a real backend/database signal must still be honored");
  });

  test('other negation phrasings ("no backend needed", "does not require a database") are also recognized', () => {
    assert.ok(!selectRoles("Build a simple page. No backend needed for this.").roles.includes("backend-developer"));
    assert.ok(!selectRoles("Build a simple page that does not require a database.").roles.includes("backend-developer"));
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

describe("requiresDeploymentApproval — the second, independent synthetic scope signal", () => {
  test("an idea mentioning production deployment requires a (task-scoped) deployment approval", () => {
    const result = requiresDeploymentApproval("Build a small tool and deploy to production once it's ready.");
    assert.equal(result.required, true);
    assert.ok(result.matchedSignal);
  });

  test("an idea with no deployment signal does not require one", () => {
    const result = requiresDeploymentApproval("Build a small tool to reformat CSV files.");
    assert.equal(result.required, false);
  });

  test("the two approval signals are independent — a paid-service idea alone does not also trigger the deployment signal", () => {
    const result = requiresDeploymentApproval("Integrate a paid service subscription for SMS notifications.");
    assert.equal(result.required, false);
  });
});
