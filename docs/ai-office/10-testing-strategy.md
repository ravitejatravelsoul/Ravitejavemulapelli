# 10 — Testing Strategy

## 1. Baseline: this repo has no test runner today

[02-current-portfolio-assessment.md](./02-current-portfolio-assessment.md)
§7 confirms zero existing tests and no test framework dependency. AI
Office is the first thing in this repository that needs one. Phase 3
(see [11-implementation-phases.md](./11-implementation-phases.md)) is
where a runner gets chosen and added — **not decided in this planning
task**, per the "no dependency installs" restriction — but the
requirements below constrain the choice: needs to run pure TypeScript
domain logic (state machine, budget math) fast and headlessly, and
ideally support component/UI testing later without a second framework.
A Vitest-based setup is the natural fit for a Next.js/TypeScript project
of this shape; this is a recommendation for the Phase 3 implementer to
confirm, not a commitment made here.

Whatever is chosen must **only** add a `"test"` script and dev
dependency — it must not touch `dev`/`build`/`start`/`lint`/`typecheck`
or affect the production bundle in any way.

## 2. Test layers

### 2.1 Unit tests (domain logic, no I/O)
- Orchestrator role-selection rules (§ table in
  [05-orchestration-workflow.md](./05-orchestration-workflow.md) §2) —
  given an idea's signals, assert the correct role set.
- State machine transitions (project status, task status, agent run
  status) — every edge in the diagrams in
  [05-orchestration-workflow.md](./05-orchestration-workflow.md) §3 and
  [04-agent-architecture.md](./04-agent-architecture.md) §3 gets at
  least one test.
- Budget math (`BudgetService.authorize()`) — under cap, at warn
  threshold, over cap, simulated-mode bypass — each a table-driven test
  matching [09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md)
  §2's decision table exactly.
- Retry/escalation counting (`attemptCount` vs `role.maxRetries`).

### 2.2 Integration tests (with the real SQLite file, temp DB per test run)
- Full repository CRUD for every table in
  [06-data-model.md](./06-data-model.md) §2.
- `AgentRunner` end-to-end against `SimulatedAdapter`: task picked up →
  run recorded → artifact written → status updated → next task
  dispatched.
- Migration script applies cleanly to an empty DB and is idempotent.

### 2.3 Workflow / state-machine tests (the brief's required scenario)
One test that runs the **entire** sequence from
[05-orchestration-workflow.md](./05-orchestration-workflow.md) §3.1 —
idea submitted through final approval, including the QA-failure-then-fix
branch — using `SimulatedAdapter` end to end, asserting:
- Every intermediate status matches the documented state diagram.
- Total `ai_usage.costUsd` across the run is exactly `0`.
- The project reaches `APPROVED` only after an explicit simulated
  "owner approves" step, never automatically.

### 2.4 Authentication tests
- Login: correct credentials → session cookie set, redirect to
  `/office`; incorrect credentials → generic failure, no user
  enumeration hint.
- `proxy.ts` optimistic redirect: unauthenticated request to
  `/office/*` → redirect to `/office/login`; authenticated → passes
  through.
- `verifySession()` DAL: expired/tampered/missing cookie → rejected, in
  a Server Component, a Server Action, and a Route Handler (three
  separate tests — per
  [08-security-plan.md](./08-security-plan.md) §2, each surface checks
  independently and must be proven to, not assumed).
- Session refresh/expiry behavior.

### 2.5 Permission tests
- Every `AgentRoleDefinition.permittedActions` allowlist: attempt an
  action outside the allowlist (e.g. QA agent attempting to write a
  `production_deploy`-flagged output) and assert it is refused and
  escalated, never silently executed.
- Confirm (via a static/architectural test, e.g. an import-graph check)
  that no module outside `lib/ai-office/agents/agent-runner.ts` imports a
  live `AIProviderAdapter` implementation — enforces
  [09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md) §2's
  "single enforcement point" claim mechanically, not just by convention.

### 2.6 Budget enforcement tests
Covered primarily in §2.1/§2.2; additionally:
- A LIVE-mode task whose `estimateCost()` would exceed the remaining cap
  is refused **before** any adapter call is made (assert the adapter's
  `runAgentTask` mock is never invoked).
- Crossing warn thresholds emits exactly one event per threshold per
  period (no duplicate-spam warnings).

### 2.7 Retry limits
- A task that fails `maxRetries` times reaches `ESCALATED`/`BLOCKED`,
  not an infinite loop — explicitly test the boundary (`maxRetries - 1`
  succeeds a retry, `maxRetries` exhausts it).

### 2.8 Office pause/resume
- `CLOSE OFFICE` while a project has pending tasks → no new `agent_runs`
  are created for any project, confirmed by asserting zero calls to
  `AgentRunner.run()` after closure in a test that tries to trigger one.
- `PAUSE PROJECT` → other projects continue dispatching; the paused
  project's tasks are skipped, not cancelled (still `PENDING` after
  resume).
- `RESUME`/`OPEN` → dispatch continues from exactly where it left off
  (assert no task is re-run, no task is skipped).

### 2.9 Agent simulation
- Each `SimulatedAdapter` fixture (one per role, at minimum a success and
  a failure fixture) produces output that validates against that role's
  `allowedOutputs` — a schema-shape test per role.

### 2.10 Approval gates
- Each `approvals.kind` from
  [08-security-plan.md](./08-security-plan.md) §9 has a test that
  triggers its condition and asserts the workflow blocks until an owner
  decision is recorded, and resumes correctly on `APPROVED`, and halts/
  reroutes correctly on `REJECTED`.

### 2.11 Data persistence / failure recovery
- Kill/restart the process mid-workflow (simulate by just not
  continuing a dispatch loop and re-invoking it later in a test) and
  confirm state resumes correctly from the DB with no duplicate task
  execution.

### 2.12 UI tests
- Component-level tests for status displays (project status, task
  status, budget bar) — given a data shape, correct label/color/aria
  output.
- A minimal end-to-end smoke test (Phase 8+, once Playwright or similar
  is justified — not before, per dependency policy) covering: login →
  start project (simulated) → see it reach `READY_FOR_REVIEW` → approve.

### 2.13 Regression testing of the existing portfolio
At the end of **every** phase, before it's considered complete:
- `npm run build` succeeds with no new warnings attributable to Office
  code.
- `npm run typecheck` and `npm run lint` pass repo-wide.
- Manual/visual spot check of the existing public routes (home, projects,
  blog, resume, contact, etc.) — unchanged rendering, no console errors.
- Confirm the public site still requires **zero** environment variables
  to run (per
  [02-current-portfolio-assessment.md](./02-current-portfolio-assessment.md)
  §9) — Office env vars being unset must not break anything outside
  `/office/**`.

This final check is the project's actual guarantee that "the current
portfolio must remain stable" — it is a checklist item in every phase's
Definition of Done (see
[11-implementation-phases.md](./11-implementation-phases.md) and
[12-definition-of-done.md](./12-definition-of-done.md)), not a one-time
verification.

## 3. What is *not* tested with real AI spend

No test — unit, integration, or workflow — ever calls a LIVE provider
adapter. Phase 7's Claude integration gets a small number of manual,
owner-triggered smoke checks against real budget (explicitly small and
owner-observed, not part of the automated suite) before Phase 8's one
real mini-project. This keeps `npm run test` (once it exists) permanently
free to run, including in any future CI — consistent with the $30/month
target never being put at risk by routine development activity.
