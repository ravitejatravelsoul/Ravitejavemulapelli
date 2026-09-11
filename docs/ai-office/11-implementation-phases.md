# 11 — Implementation Phases

No calendar estimates — relative effort only (Small / Medium / Large).
Every phase ends with the regression checklist in
[10-testing-strategy.md](./10-testing-strategy.md) §2.13, not repeated
per phase below to avoid redundancy, but it is part of every phase's
Definition of Done implicitly.

---

## Phase 0 — Planning and architecture

- **Objective**: Produce the complete planning package (this
  `docs/ai-office/` directory) before any code exists.
- **Scope**: Documentation only.
- **Prerequisites**: None.
- **Implementation tasks**: Repository inspection; author all 15 docs +
  README; git safety setup (feature branch, no push, no merge).
- **Expected files affected**: `docs/ai-office/**` only (new).
- **Tests**: N/A (no code).
- **Acceptance criteria**: Package is internally consistent (see
  [00-master-plan.md](./00-master-plan.md) §5), every brief requirement
  is represented in some document, no contradictions between documents.
- **Definition of Done**: This phase — the current task.
- **Risks**: Planning drifts from what's actually buildable. Mitigation:
  every architectural claim in this package is grounded in an actual
  file/pattern read from the repo (cited inline) or explicitly flagged as
  an open decision, not invented.
- **Rollback**: Delete `docs/ai-office/` and/or the branch — zero effect
  on anything else.
- **Effort**: Medium.

---

## Phase 1 — Portfolio integration and public AI Office entrance

- **Objective**: Add the public `/ai-office` preview page and its single
  entry point, with zero effect on existing routes.
- **Scope**: `app/ai-office/page.tsx` and its section components; a
  navbar link; robots/sitemap updates.
- **Prerequisites**: Phase 0 approved by owner.
- **Implementation tasks**:
  1. Build `/ai-office` per [07-ui-ux-spec.md](./07-ui-ux-spec.md) §2,
     reusing existing motion/card/theme components.
  2. Add an "AI Office" link to `components/layout/navbar.tsx`.
  3. Update `app/robots.ts` to disallow `/office/` (the *future*
     private path — it doesn't exist yet, but reserving the disallow
     rule now costs nothing and prevents forgetting it later); ensure
     `/ai-office` is crawlable.
  4. Update `app/sitemap.ts` to include `/ai-office`.
  5. The "Enter AI Office" button links to `/office` — acceptable to
     404 until Phase 2 ships it, or ship Phase 1+2 together; either is
     fine, called out as an implementer choice.
- **Expected files affected**: `app/ai-office/**` (new),
  `components/layout/navbar.tsx`, `app/robots.ts`, `app/sitemap.ts`.
- **Tests**: Visual/manual (per §2.12/2.13 of the testing strategy);
  no dynamic behavior yet to unit test.
- **Acceptance criteria**: Public page matches §2's content requirements
  (including the ownership disclosure), no private information present,
  passes the same accessibility bar as the rest of the site, existing
  pages unaffected.
- **Definition of Done**: Page live on `localhost`, `npm run build`
  clean, nav/robots/sitemap changes reviewed.
- **Risks**: Navbar layout regression on mobile (shared component). 
  Mitigation: test at the existing mobile breakpoint used elsewhere.
- **Rollback**: Revert the 4 touched files; delete `app/ai-office/`.
- **Effort**: Small.

---

## Phase 2 — Private authentication and owner dashboard shell

- **Objective**: Stand up `/office/login` and an authenticated, empty
  dashboard shell — auth works end to end before any real feature sits
  behind it.
- **Scope**: `proxy.ts`, DAL, session lib, login Server Action, owner
  seed, dashboard shell layout (no live data yet — static/placeholder
  sections).
- **Prerequisites**: Phase 1 (nav entry exists; not a hard technical
  dependency, just logical sequencing).
- **Implementation tasks**: Per
  [08-security-plan.md](./08-security-plan.md) §1–2 exactly — session
  secret, `jose` signing, HttpOnly cookie, `proxy.ts` optimistic check,
  `verifySession()` DAL, owner seed script/route, login form + Server
  Action, `app/office/layout.tsx` enforcing auth, empty dashboard
  sections as placeholders for Phase 3+ data.
- **Expected files affected**: `proxy.ts` (new),
  `lib/ai-office/auth/**` (new), `app/office/login/**` (new),
  `app/office/layout.tsx`, `app/office/page.tsx` (new),
  `.env.local` (developer-local, not committed), `.env.example` update
  documenting `OFFICE_SESSION_SECRET`.
- **Tests**: Authentication tests per
  [10-testing-strategy.md](./10-testing-strategy.md) §2.4.
- **Acceptance criteria**: Cannot reach any `/office/*` page without a
  valid session; login/logout work; public site still needs zero env
  vars; `/ai-office` unaffected.
- **Definition of Done**: All §2.4 tests pass; manual login/logout
  verified in a browser.
- **Risks**: `proxy.ts` matcher too broad, adding latency/risk to public
  routes. Mitigation: matcher scoped to `/office/:path*` only, tested
  explicitly.
- **Rollback**: Remove the listed new files/dirs; `proxy.ts` deletion
  fully restores pre-Office routing behavior.
- **Effort**: Medium.

---

## Phase 3 — Projects/tasks/agents state engine

- **Objective**: The full data model is live (SQLite + migrations +
  repositories) and CRUD-testable, with no orchestration behavior yet —
  just correct persistence.
- **Scope**: `lib/ai-office/db/**`, `lib/ai-office/domain/**`
  (repositories per [06-data-model.md](./06-data-model.md) §2), seed
  data for `agent_roles`.
- **Prerequisites**: Phase 2 (auth exists — even though the DB layer
  itself doesn't need auth, project creation Server Actions do).
- **Implementation tasks**: Choose SQLite driver (§ open decision in
  [06-data-model.md](./06-data-model.md) §1 — document the choice made,
  with the "reason/alternatives/maintenance/security/cost" writeup the
  dependency policy requires); write schema + migrations; write one
  repository per table group; seed `agent_roles` from the catalog in
  [04-agent-architecture.md](./04-agent-architecture.md) §1; choose and
  add the test runner (§ open decision in
  [10-testing-strategy.md](./10-testing-strategy.md) §1, same
  documented-choice requirement); add `"test"` npm script.
- **Expected files affected**: `lib/ai-office/db/**` (new),
  `lib/ai-office/domain/**` (new), `package.json` (new deps: DB driver,
  test runner — documented per dependency policy), `.gitignore` (only if
  the chosen DB file path isn't already covered by the existing
  `*.sqlite`/`*.db` patterns — verify first).
- **Tests**: Integration tests per
  [10-testing-strategy.md](./10-testing-strategy.md) §2.2.
- **Acceptance criteria**: Every table has a working repository; a
  migration runs cleanly on an empty DB; `agent_roles` seed matches the
  catalog exactly.
- **Definition of Done**: `npm run test` green for §2.2; `npm run build`
  still clean (native DB module, if any, doesn't break the build).
- **Risks**: A native SQLite dependency causing platform-specific build
  issues (Windows, given the developer's environment). Mitigation:
  prefer `node:sqlite` if the local Node version supports it (zero native
  module risk); otherwise pin a `better-sqlite3` version with known
  prebuilt binaries for Windows and document the fallback.
- **Rollback**: Remove `lib/ai-office/db/**`, `lib/ai-office/domain/**`,
  revert `package.json`, delete the local DB file.
- **Effort**: Large.

---

## Phase 4 — Simulated agent workflows

- **Objective**: Run the brief's full required scenario (idea → ... →
  approval, including QA failure/retry) end to end using
  `SimulatedAdapter`, at $0.
- **Scope**: `lib/ai-office/providers/**` (interface +
  `SimulatedAdapter` + fixtures), `lib/ai-office/agents/agent-runner.ts`.
- **Prerequisites**: Phase 3 (data engine) complete.
- **Implementation tasks**: Define `AIProviderAdapter` interface per
  [04-agent-architecture.md](./04-agent-architecture.md) §4; build
  `SimulatedAdapter` with at least one success and one failure fixture
  per role; build `AgentRunner` per
  [04-agent-architecture.md](./04-agent-architecture.md) §5 (without the
  budget gate yet — that's Phase 6 — but structured so adding it later
  doesn't require a rewrite, i.e. the call site for the gate exists as a
  no-op hook).
- **Expected files affected**: `lib/ai-office/providers/**` (new),
  `lib/ai-office/agents/**` (new).
- **Tests**: Workflow/state-machine test per
  [10-testing-strategy.md](./10-testing-strategy.md) §2.3 (the
  brief's exact required sequence) — this is the single most important
  test in the whole project; agent simulation tests per §2.9.
- **Acceptance criteria**: The full sequence in
  [05-orchestration-workflow.md](./05-orchestration-workflow.md) §3.1
  runs to completion, unattended, at $0, repeatably.
- **Definition of Done**: §2.3 test green, run at least 3 times
  consecutively with identical results (determinism check).
- **Risks**: Fixtures too simplistic to exercise real retry/escalation
  paths. Mitigation: explicitly include a QA-failure fixture in the
  default flow, not just a happy-path one.
- **Rollback**: Remove `lib/ai-office/providers/**`,
  `lib/ai-office/agents/**`.
- **Effort**: Large.

---

## Phase 5 — Orchestrator

- **Objective**: Replace hand-triggered task creation (used for Phase 4
  testing) with the real Orchestrator — idea in, full task plan and role
  selection out, automatically.
- **Scope**: `lib/ai-office/orchestrator/**`.
- **Prerequisites**: Phase 4.
- **Implementation tasks**: Implement the role-selection rule table
  ([05-orchestration-workflow.md](./05-orchestration-workflow.md) §2);
  implement the dispatch loop (§4); implement quality gates (§5); wire
  the "Start New Project" flow (Server Action → Orchestrator) into the
  dashboard shell from Phase 2.
- **Expected files affected**: `lib/ai-office/orchestrator/**` (new),
  `app/office/actions/project.ts` (new), `app/office/projects/**` (new
  pages: list, new, detail).
- **Tests**: Re-run the Phase 4 workflow test, now via the real
  Orchestrator instead of manually seeded tasks (same acceptance
  criteria as Phase 4, proving the Orchestrator reproduces the same
  behavior); role-selection unit tests per §2.1.
- **Acceptance criteria**: Submitting an idea through the actual UI
  reaches `READY_FOR_REVIEW` unattended in simulated mode.
- **Definition of Done**: End-to-end manual run through the real UI,
  plus automated tests, both green.
- **Risks**: Role-selection rules too rigid for real idea phrasing.
  Mitigation: rules are a small, isolated table (§2 of
  [05-orchestration-workflow.md](./05-orchestration-workflow.md)) —
  designed to be tuned without touching the state machine.
- **Rollback**: Remove `lib/ai-office/orchestrator/**`; Phase 4's
  manually-triggered flow still works as a fallback demo.
- **Effort**: Large.

---

## Phase 6 — Budget, pause and approval controls

- **Objective**: Wire in every owner-facing control:
  Open/Close Office, Pause/Resume Project, budget caps/warnings, and the
  Approvals queue — all enforced in code, not just displayed.
- **Scope**: `lib/ai-office/domain/budget-service.ts`, office/project
  control Server Actions, `/office/approvals`, `/office/budget`.
- **Prerequisites**: Phase 5.
- **Implementation tasks**: Implement `BudgetService.authorize()` per
  [09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md) §2;
  wire it into `AgentRunner`'s existing no-op hook from Phase 4; build
  Office/Project control Server Actions per
  [05-orchestration-workflow.md](./05-orchestration-workflow.md) §8;
  build Approvals queue UI and decision Server Action; build budget
  settings UI.
- **Expected files affected**: `lib/ai-office/domain/budget-service.ts`
  (new), `app/office/actions/{office-control,budget,approvals}.ts`
  (new), `app/office/{approvals,budget}/**` (new).
- **Tests**: Budget enforcement (§2.6), retry limits (§2.7), office
  pause/resume (§2.8), approval gates (§2.10) — all from
  [10-testing-strategy.md](./10-testing-strategy.md).
- **Acceptance criteria**: All of §9's approval kinds correctly block
  and resume; closing the Office provably stops all new agent runs;
  budget hard cap provably blocks a run and creates an approval instead
  of silently overspending.
- **Definition of Done**: All listed tests green; a manual test closes
  the Office mid-run and confirms no further activity.
- **Risks**: A control that looks like it works in the UI but doesn't
  actually gate the underlying dispatch loop (UI-only enforcement is a
  known anti-pattern). Mitigation: every control's test asserts on the
  domain layer (no `AgentRun` created), not just on UI state.
- **Rollback**: Remove the listed new files; Phase 5's Orchestrator still
  runs, just without owner controls (acceptable only as a transient
  rollback state, not a shipped state).
- **Effort**: Large.

---

## Phase 7 — Claude API integration

- **Objective**: Add the first real `AIProviderAdapter` implementation,
  behind the existing interface, with no changes to Orchestrator/
  AgentRunner.
- **Scope**: `lib/ai-office/providers/claude-adapter.ts`, pricing table,
  provider selection UI (simulated vs. live toggle, per project).
- **Prerequisites**: Phase 6 (budget gate must exist *before* any live
  spend is possible).
- **Implementation tasks**: Implement `ClaudeAdapter` against the
  `AIProviderAdapter` interface; implement `estimateCost()` using real
  Claude pricing (kept in `pricing.ts`, see
  [09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md)
  §8); add `ANTHROPIC_API_KEY` to `.env.example` (documented, not
  committed with a value); add the simulated/live mode toggle to project
  settings UI.
- **Expected files affected**: `lib/ai-office/providers/claude-adapter.ts`
  (new), `lib/ai-office/providers/pricing.ts` (new), `.env.example`,
  `app/office/projects/[id]/**` (mode toggle).
- **Tests**: Adapter unit tests against a mocked Claude client (no real
  API calls in automated tests, per
  [10-testing-strategy.md](./10-testing-strategy.md) §3); a small number
  of manual, owner-triggered smoke calls against real budget.
- **Acceptance criteria**: A single manual LIVE task run completes,
  produces a real `ai_usage` row with accurate cost, and the budget gate
  correctly reflects the spend afterward.
- **Definition of Done**: One successful manual LIVE run, budget numbers
  verified against the Anthropic Console's actual usage for that key.
- **Risks**: Pricing table drift (provider changes prices). Mitigation:
  flagged in [13-risk-register.md](./13-risk-register.md) as an ongoing
  maintenance item, not a one-time task.
- **Rollback**: Remove `claude-adapter.ts`; system continues to function
  fully in simulated mode (no other phase depends on Claude being wired
  up).
- **Effort**: Medium.

---

## Phase 8 — One real autonomous mini-project

- **Objective**: Prove the whole system end to end with real stakes: one
  small, real application idea, run live, through to owner approval.
- **Scope**: No new architecture — this phase is a supervised real run,
  plus whatever small bug fixes it surfaces.
- **Prerequisites**: Phase 7.
- **Implementation tasks**: Owner submits a genuinely small idea (e.g.
  a single-purpose CLI or script); observe the full run; fix any gaps
  found (documented as follow-up tasks, not silently patched without
  record); owner performs the final approval.
- **Expected files affected**: Unpredictable — whatever bugs surface;
  kept minimal and targeted, no opportunistic refactors.
- **Tests**: The existing suite must still be green after any fixes; add
  a regression test for anything that broke and wasn't already covered.
- **Acceptance criteria**: One project reaches `APPROVED` via a real,
  owner-observed LIVE run, within budget.
- **Definition of Done**: Owner sign-off on the resulting project
  artifact.
- **Risks**: Real-world idea phrasing exposes gaps the simulated fixtures
  didn't cover. This is the *point* of the phase — expected, not a
  failure.
- **Rollback**: N/A (observational phase); any code fixes follow normal
  per-file rollback.
- **Effort**: Medium.

---

## Phase 9 — Reliability / security hardening

- **Objective**: Close gaps found in Phase 8, tighten error handling,
  and do a focused security pass before considering the system "done"
  for personal daily use.
- **Scope**: Whatever Phase 8 revealed, plus a deliberate second pass on
  [08-security-plan.md](./08-security-plan.md)'s checklist (session
  expiry edge cases, secrets masking, audit log completeness).
- **Prerequisites**: Phase 8.
- **Implementation tasks**: Address Phase 8 findings; run the `/security-
  review` workflow already available in this environment against the
  Office code specifically; verify every §9 approval gate one more time
  with adversarial-style manual testing (e.g. deliberately crafting an
  agent fixture that tries a disallowed action, confirming it's blocked).
- **Expected files affected**: Targeted fixes only.
- **Tests**: Any new coverage the fixes require.
- **Acceptance criteria**: No known open security gap; no known reliability
  gap from Phase 8 left unaddressed or undocumented.
- **Definition of Done**: See [12-definition-of-done.md](./12-definition-of-done.md).
- **Risks**: Scope creep into unrelated refactors. Mitigation: this
  phase fixes what Phase 8 found and re-verifies §9, nothing else.
- **Rollback**: Per-fix, standard revert.
- **Effort**: Medium.

---

## Phase 10 — Optional deployment

- **Objective**: If and only if Raviteja decides to expose the Office
  beyond `localhost`, adapt it for a real deployment target.
- **Scope**: Deployment configuration, the §11/§10-of-security-plan
  "deployed" differences (HTTPS, rate limiting, stronger auth/MFA,
  session storage).
- **Prerequisites**: Phase 9, and an explicit owner decision to proceed
  (this phase is not assumed to happen — see
  [00-master-plan.md](./00-master-plan.md) §2, local-first is the
  standing target).
- **Implementation tasks**: TBD at the time this phase is actually
  greenlit — deliberately not designed in detail now, since the brief
  explicitly says not to design the first implementation around
  deployment, and any concrete choice made today would likely be stale
  by the time this phase starts.
- **Expected files affected**: TBD.
- **Tests**: TBD, but must include everything in
  [10-testing-strategy.md](./10-testing-strategy.md) §2.13 against the
  deployed environment, not just localhost.
- **Acceptance criteria**: TBD.
- **Definition of Done**: TBD.
- **Risks**: Premature optimization if planned in detail now. Mitigation:
  intentionally deferred.
- **Rollback**: N/A until scoped.
- **Effort**: Unestimated (deliberately).

---

## Phase ordering notes

- Phases 0–6 require **zero** paid AI spend and **zero** new external
  accounts — this is intentional; a huge amount of the system can be
  built and proven before Phase 7's first real cost is incurred.
- Phase order is mostly strict (each depends on the previous), with one
  flexibility: Phase 1 and Phase 2 could be built in either order or
  together, since Phase 1 has no technical dependency on Phase 2 (only a
  logical/UX one — the "Enter AI Office" button needs somewhere to go).
