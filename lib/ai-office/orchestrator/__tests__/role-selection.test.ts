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

  // Real defect found in the second AI Office pilot: this fallback used
  // to default to backend-developer alone, silently producing a
  // backend-only plan for a genuine, unambiguous user-facing app idea
  // ("Build a polished personal task manager called TaskFlow...") that
  // never happened to use a literal word like "app"/"ui"/"page" despite
  // describing browser interaction throughout — a real project that
  // could then never pass its own QA gate (no browser-loadable
  // deliverable was ever going to exist). The safe default for a
  // genuinely ambiguous idea is now a usable UI, not an invisible
  // backend service — see role-selection.ts's own docblock for the
  // full "why."
  test("an idea with no UI, backend, or CLI signal now defaults to a usable UI (frontend-developer), not an invisible backend-only service", () => {
    const { roles } = selectRoles("x");
    assert.ok(roles.includes("frontend-developer"));
    assert.ok(roles.includes("ui-ux-agent"));
    assert.ok(!roles.includes("backend-developer"));
  });

  test("an explicit CLI/terminal idea with no UI or backend signal still correctly gets backend-developer, never frontend-developer — a CLI has no browser UI", () => {
    const { roles } = selectRoles("Build a CLI that reformats CSV files into JSON.");
    assert.ok(roles.includes("backend-developer"));
    assert.ok(!roles.includes("frontend-developer"));
    assert.ok(!roles.includes("ui-ux-agent"));
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

describe("selectRoles — real project-type regression suite (second AI Office pilot follow-up)", () => {
  test("the exact real TaskFlow idea text now correctly produces a frontend deliverable — the literal real-world regression this fix closes", () => {
    const { roles } = selectRoles(
      `Build a polished personal task manager called TaskFlow.

Users must be able to create, edit, complete, reopen and delete tasks.

Each task has:
- title
- optional description
- priority: Low, Medium or High
- created date
- completion status

Provide:
- All, Active and Completed filters
- search
- task counts
- clear empty states
- responsive desktop/mobile design
- persistent local storage so tasks survive refresh
- confirmation before deleting a task
- accessible keyboard-friendly controls

No login.
No backend.
No external APIs.

The finished application must include:
- working preview
- README.md with exact local-run instructions
- downloadable ZIP
- real browser functional testing
- responsive testing
- no console errors
- no broken interactions`,
    );
    assert.ok(roles.includes("frontend-developer"), "TaskFlow is a real user-facing app — it must get a frontend deliverable");
    assert.ok(roles.includes("ui-ux-agent"));
    assert.ok(!roles.includes("backend-developer"), 'the idea explicitly says "No backend."');
  });

  test("frontend-only app (explicit UI signal, explicit no-backend)", () => {
    const { roles } = selectRoles("Build a static personal blog webpage with no backend and no database.");
    assert.ok(roles.includes("frontend-developer"));
    assert.ok(!roles.includes("backend-developer"));
  });

  test("backend-only service (explicit API/database signal, no UI mention)", () => {
    const { roles } = selectRoles("Build a REST API backend service with a database for managing inventory records.");
    assert.ok(roles.includes("backend-developer"));
    assert.ok(!roles.includes("frontend-developer"));
    assert.ok(!roles.includes("ui-ux-agent"));
  });

  test("full-stack app (explicit UI signal AND explicit backend/API signal)", () => {
    const { roles } = selectRoles("Build a web application with a REST API and database for managing customer orders, with a dashboard for staff.");
    assert.ok(roles.includes("frontend-developer"));
    assert.ok(roles.includes("backend-developer"));
    assert.ok(roles.includes("ui-ux-agent"));
  });

  test("static SPA (explicit UI signal, no server-side signal at all)", () => {
    const { roles } = selectRoles("Create a single-page pomodoro timer web app using only local browser state, no backend.");
    assert.ok(roles.includes("frontend-developer"));
    assert.ok(!roles.includes("backend-developer"));
  });

  test("CLI/no-browser project (explicit CLI signal, no UI signal)", () => {
    const { roles } = selectRoles("Write a command-line tool that batch-renames files according to a pattern.");
    assert.ok(roles.includes("backend-developer"));
    assert.ok(!roles.includes("frontend-developer"));
    assert.ok(!roles.includes("ui-ux-agent"));
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
