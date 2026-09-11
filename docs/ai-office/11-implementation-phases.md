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

> **Implemented** (combined with Phase 2 task 1, per the checkpoint below)
> on `feature/teja-ai-office`. Built: `/ai-office` (hero with an animated
> constellation visual and "Enter AI Office" CTA, "What It Is," a 10-role
> gallery, an 8-step workflow visualization, a conceptual architecture
> overview, and the ownership disclosure banner — all per
> [07-ui-ux-spec.md](./07-ui-ux-spec.md) §2); a distinct "AI Office"
> nav entry (desktop pill + mobile sheet link) in
> `components/layout/navbar.tsx`; `app/robots.ts` disallows `/office/`;
> `app/sitemap.ts` includes `/ai-office`.
>
> **Deviations from this document, recorded for the next phase's
> implementer:**
> - Two new dependencies were required to implement the *real* session
>   auth this checkpoint calls for (not a placeholder): `jose` (session
>   JWT signing/verification — exactly as specified in
>   [08-security-plan.md](./08-security-plan.md) §2) and `server-only`
>   (build-time guard on credential/session modules, matching that same
>   section's guidance for provider-adapter modules, applied here too).
>   Both documented inline in this note per the dependency policy in
>   [00-master-plan.md](./00-master-plan.md); neither was anticipated by
>   name in the original planning pass.
> - The owner credential is seeded via `.env.local`
>   (`OFFICE_OWNER_EMAIL` + `OFFICE_OWNER_PASSWORD_HASH`, a `salt:hash`
>   pair produced by the new `scripts/ai-office-hash-password.mjs` dev
>   tool) rather than a database row — there is no `users` table yet
>   (Phase 3 hasn't run). This is the "env-driven seed script" option
>   [08-security-plan.md](./08-security-plan.md) §1 explicitly names, not
>   an improvised shortcut; moving it into SQLite in Phase 3 only touches
>   `lib/ai-office/auth/credentials.ts`'s internals, not its call sites.
> - The private route tree uses a `(protected)` route group —
>   `app/office/login/page.tsx` (public) sits alongside
>   `app/office/(protected)/layout.tsx` (calls `verifySession()`, redirects
>   to `/office/login` if absent) and `app/office/(protected)/page.tsx`
>   — instead of the single flat `app/office/layout.tsx` sketched in
>   [03-system-architecture.md](./03-system-architecture.md) §1. A single
>   layout enforcing auth for everything under `/office/**` would also
>   gate `/office/login` itself, which can't require a session to reach
>   the page that creates one. This is the standard Next.js App Router
>   shape for "most of a segment is protected, one sibling isn't" and
>   doesn't change any documented security property — `verifySession()`
>   is still the real boundary, `proxy.ts` is still optimistic-only.
> - The public site's existing `Navbar`/`Footer` (from the root
>   `app/layout.tsx`) still render around `/office/login` and the signed-in
>   placeholder, rather than a fully separate distraction-free shell —
>   root layout was deliberately left untouched to keep this checkpoint's
>   blast radius minimal. A chrome-free private shell (if wanted) is
>   reasonable scope for Phase 2's *remaining* work (the populated
>   dashboard), not required for this checkpoint.
> - `app/office/(protected)/page.tsx` is an intentionally bare "signed
>   in" placeholder with explicit synthetic-content labeling, per the
>   brief's private-data rule — no project/task/budget data, fake or
>   otherwise, is rendered anywhere in this checkpoint.

> **Combined release checkpoint with Phase 2's login shell.** The public
> "Enter AI Office" button must never ship pointing at a 404 or an
> unbuilt route. Phase 1 and the *minimal* portion of Phase 2 (§ below —
> `proxy.ts`, session lib, login form, a restricted-looking but otherwise
> empty `/office` landing) are implemented and released **together**,
> even though they remain two separate phases for scope/effort
> accounting and can be built in either order (they have no technical
> dependency on each other, only this shared release gate). Phase 1 is
> not considered complete in isolation — see its Definition of Done
> below. Phase 2's *remaining* scope (the real, populated dashboard) can
> ship immediately afterward without any further public-facing change,
> since the entrance already resolves to something intentional.

- **Objective**: Add the public `/ai-office` preview page and its single
  entry point, with zero effect on existing routes — and ensure that
  entry point always leads somewhere intentional, never a 404.
- **Scope**: `app/ai-office/page.tsx` and its section components; a
  navbar link; robots/sitemap updates. (The login destination itself is
  Phase 2's scope — see the checkpoint note above for why both ship
  together.)
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
  5. The "Enter AI Office" button links to `/office` — this route must
     resolve to Phase 2's minimal login shell (task 1 of Phase 2) before
     Phase 1 is considered shippable. Do not release Phase 1's public
     entrance on its own with `/office` unresolved.
- **Expected files affected**: `app/ai-office/**` (new),
  `components/layout/navbar.tsx`, `app/robots.ts`, `app/sitemap.ts`.
- **Tests**: Visual/manual (per §2.12/2.13 of the testing strategy);
  no dynamic behavior yet to unit test.
- **Acceptance criteria**: Public page matches §2's content requirements
  (including the ownership disclosure), no private information present,
  passes the same accessibility bar as the rest of the site, existing
  pages unaffected, and "Enter AI Office" resolves to a real, intentional
  restricted-owner experience (Phase 2's minimal login shell) rather than
  a 404.
- **Definition of Done**: Page live on `localhost`, `npm run build`
  clean, nav/robots/sitemap changes reviewed, **and** the entrance button
  verified to lead to a working `/office/login` (i.e. Phase 2 task 1 is
  done in the same release).
- **Risks**: Navbar layout regression on mobile (shared component).
  Mitigation: test at the existing mobile breakpoint used elsewhere.
- **Rollback**: Revert the 4 touched files; delete `app/ai-office/`. If
  rolling back Phase 1 alone (keeping the combined-checkpoint login
  shell), the entrance button reverts too — the two are released
  together specifically so this never happens in production, only as a
  pre-release rollback.
- **Effort**: Small.

---

## Phase 2 — Private authentication and owner dashboard shell

> **Task 1 (minimal login shell) implemented** together with Phase 1 —
> see that phase's implementation note for exactly what shipped and the
> recorded deviations (route-group structure, `jose`/`server-only`
> dependencies, env-seeded credential). **Task 2 (the full, populated
> dashboard) is explicitly NOT implemented** — `app/office/(protected)/page.tsx`
> is a bare placeholder, not a dashboard, per this checkpoint's scope.
> Phase 3 onward remains not started.
>
> See the Phase 1 checkpoint note above — task 1 below ships together
> with Phase 1 as a combined release; tasks 2+ (the populated dashboard)
> can follow immediately after without any further change to the public
> entrance.

- **Objective**: Stand up `/office/login` and an authenticated, empty
  dashboard shell — auth works end to end before any real feature sits
  behind it, and the public entrance always resolves to this rather than
  an unbuilt route.
- **Scope**: `proxy.ts`, DAL, session lib, login Server Action, owner
  seed, dashboard shell layout (no live data yet — static/placeholder
  sections).
- **Prerequisites**: Phase 1's page/nav work (logically paired, not a
  hard technical dependency — see the combined-checkpoint note).
- **Implementation tasks**:
  1. **Minimal login shell (ships with Phase 1)**: `proxy.ts`, session
     secret, `jose` signing, HttpOnly cookie, optimistic redirect check,
     `verifySession()` DAL, owner seed script/route, login form + Server
     Action, and an `app/office/page.tsx` that — once authenticated —
     shows at minimum a "signed in, dashboard coming soon" state rather
     than a blank page. This alone is enough for "Enter AI Office" to be
     an intentional, restricted, owner-only experience.
  2. **Full dashboard shell**: `app/office/layout.tsx` enforcing auth
     app-wide for `/office/**`, the real (still data-empty, per Phase
     3+) dashboard sections per
     [07-ui-ux-spec.md](./07-ui-ux-spec.md) §4.
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
  verified in a browser; task 1 confirmed live at the same time as
  Phase 1's public entrance (see checkpoint note).
- **Risks**: `proxy.ts` matcher too broad, adding latency/risk to public
  routes. Mitigation: matcher scoped to `/office/:path*` only, tested
  explicitly.
- **Rollback**: Remove the listed new files/dirs; `proxy.ts` deletion
  fully restores pre-Office routing behavior — but see the Phase 1
  rollback note: rolling this back also means reverting Phase 1's
  entrance button, since the two ship as one checkpoint.
- **Effort**: Medium.

---

## Phase 3 — Projects/tasks/agents state engine

> **Implemented** on `feature/teja-ai-office`. The full schema (19 domain
> tables + `schema_migrations`), a deterministic migration runner,
> idempotent seed data, and domain repositories for every entity in
> [06-data-model.md](./06-data-model.md) §2 are live. No orchestration
> intelligence, no simulated/live agent execution — persistence only, as
> scoped.
>
> **SQLite driver decision**: `node:sqlite` (Node's built-in
> `DatabaseSync`), not `better-sqlite3`. Actual environment: Node
> **v24.13.0**. `node:sqlite` works with zero CLI flags on this version
> (still emits a one-time `ExperimentalWarning` per process — harmless,
> not a functional gate) and needs no native module at all, since it
> ships inside the Node binary. The one real cost: `@types/node` was
> pinned to `^20`, which predates `node:sqlite`'s type declarations —
> bumped to `^24.13.4` (matching the actual runtime major version) as a
> devDependency-only change; `npx tsc --noEmit` across the whole repo
> was re-run clean afterward to confirm zero fallout elsewhere.
> Alternatives considered: `better-sqlite3` (rejected — a native module
> is genuine Windows-prebuild risk this developer's environment simply
> doesn't need to take on, given `node:sqlite` covers every API surface
> this phase needs: prepared statements, manual transactions, PRAGMA,
> `sqlite_version()` — confirmed 3.50.4 bundled). Security/maintenance:
> `node:sqlite` is Node core, versioned with Node itself, no separate
> supply-chain surface; its "experimental" label is the one real
> ongoing risk (API could still change in a future Node major) —
> accepted for a personal local tool where the Node version is fully
> within the owner's control. Cost: $0, zero new runtime dependencies.
>
> **Test runner decision**: stayed with Node's built-in `node:test` —
> did not add Vitest. See
> [14-open-questions.md](./14-open-questions.md) §4 for the reasoning.
> `npm run test:ai-office` now runs `lib/ai-office/auth/token.test.ts`
> plus two new Phase 3 suites
> (`lib/ai-office/db/__tests__/schema.test.ts`,
> `lib/ai-office/domain/__tests__/repositories.test.ts`), 53 tests
> total, all green. Explicit file paths are passed to `node --test`
> rather than a directory/glob — this Node version's directory-based
> test discovery didn't reliably pick up `.test.ts` files in manual
> verification, so explicit paths were used instead as the more robust
> option; revisit if this becomes unwieldy as more suites are added.
>
> **Migration design**: hand-written SQL files under
> `lib/ai-office/db/migrations/NNN-description.sql` (one so far:
> `001-init.sql`), applied in order inside a transaction per file,
> tracked in a `schema_migrations` table (version, name, appliedAt)
> living in the same database. A failed migration rolls back and is
> never recorded as applied — confirmed by test, not just asserted in
> prose. `getSchemaVersion()`/`runMigrations()` in
> `lib/ai-office/db/migrate.ts`.
>
> **Repository approach**: one module per closely-related table group
> under `lib/ai-office/domain/**` (`office.ts`, `users.ts`,
> `agent-roles.ts`, `projects.ts`, `tasks.ts` — tasks + dependencies +
> attempts + agent runs, tightly coupled by design — `budget.ts`,
> `events.ts`, `project-outputs.ts` — decisions + artifacts + test
> results + failures + approvals). Every exported function is a plain,
> readable, domain-named function (`createProjectWithIdea`,
> `claimTask`, `recordDecision`, ...) — no generic
> `Repository<T>`-style abstraction. `claimTask()` implements exactly
> the atomic compare-and-swap statement shape from
> [03-system-architecture.md](./03-system-architecture.md) §9.3, plus
> `releaseLease()` and `findStaleLeasedTasks()` — persistence primitives
> only, no dispatch loop, no eligibility-selection policy (that's
> Phase 5, not implemented here, per this task's explicit scope limit).
>
> **Owner auth migration**: the `users` table is now real and
> authoritative. `lib/ai-office/db/seed.ts`'s `seedOwnerFromEnv()`
> seeds one owner row from `.env.local`'s `OFFICE_OWNER_EMAIL`/
> `OFFICE_OWNER_PASSWORD_HASH` — but only once, only if the `users`
> table is still empty; it never overwrites an existing row. This is
> the exact "env-driven seed script" option
> [08-security-plan.md](./08-security-plan.md) §1 names, now actually
> wired up rather than deferred. `lib/ai-office/auth/credentials.ts`'s
> `verifyOwnerCredentials()` now queries the `users` table instead of
> reading the env vars directly on every login attempt — its exported
> signature is unchanged, so `app/office/actions/auth.ts` (its only
> caller) needed no changes. The Phase 1/2 timing-safe-comparison
> property (a wrong email can't be distinguished from a wrong password
> by response time) was deliberately preserved across this change via a
> fixed dummy-salt scrypt computation when no matching user is found —
> not automatic, had to be re-derived for the DB-backed shape and is
> called out here so it isn't accidentally regressed later.
>
> **Office status / budget persistence**: `office_status` singleton
> (id fixed to `'singleton'`, enforced by both the PK and a CHECK
> constraint — a second insert cannot create a duplicate row, tested)
> and a default `budget_records` office-scope row seeded at **$30**
> capUsd / 80 warnAtPercent. No enforcement, no Office-Close workflow,
> no spend gating — storage and repository behavior only, exactly as
> scoped; Phase 6 wires the actual behavior on top of this.
>
> **Deviations from the planning docs, recorded rather than silently
> made:**
> - Added `'research-notes'` to the `artifacts.type` CHECK list — 
>   [04-agent-architecture.md](./04-agent-architecture.md) §1 names
>   "Research notes (artifact)" as the Research Agent's output, but
>   [06-data-model.md](./06-data-model.md) §2's original `artifacts.type`
>   enum didn't include it. Small gap between two of this package's own
>   documents, resolved by extending the enum rather than left blocking
>   implementation.
> - `budget_records.scopeId` uses the literal string `'office'` (never
>   `NULL`) for office-scope rows specifically so
>   `UNIQUE (scope, scopeId, periodStart)` can actually prevent
>   duplicates — SQLite treats every `NULL` as distinct from every other
>   `NULL`, so a `NULL` scopeId would never collide with itself across
>   repeated seed calls the way the sentinel string does.
> - `budget_records.warnAtPercent` is a single column, seeded to `80`.
>   [09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md)
>   §4's prose mentions two default thresholds ("50% and 80%") but the
>   approved schema only ever had one `warnAtPercent` column — resolved
>   by treating 80 as the stored, configurable hard-warning threshold;
>   whether a second, lower "soft notice" threshold becomes a real
>   second column or stays hardcoded application logic is a Phase 6
>   decision, not reopened here.
> - Agent role `id` slugs (`orchestrator`, `product-owner`,
>   `research-agent`, `solution-architect`, `ui-ux-agent`,
>   `frontend-developer`, `backend-developer`, `qa-agent`,
>   `security-reviewer`, `code-reviewer`, `release-agent`) and each
>   role's `maxRetries` (uniformly 3) / `escalatesTo` (`owner` for
>   Orchestrator, `orchestrator` for every other role) are this
>   implementation's own choice — the planning docs named only two
>   example ids (`qa-agent`, `solution-architect`) and never fixed a
>   numeric retry ceiling. Recorded here as the source of truth; see
>   `lib/ai-office/domain/agent-role-catalog.ts`.
> - `.gitignore` gained `*.sqlite-shm`/`*.sqlite-wal`/`*.sqlite-journal`,
>   `*.db-shm`/`*.db-wal`/`*.db-journal`, and `/.data/` — WAL mode (used
>   for the app database) creates `-shm`/`-wal` sidecar files that the
>   pre-existing `*.sqlite`/`*.db` patterns did not cover. Found by
>   actually creating a real local database and checking `git status`
>   rather than assuming the existing patterns were sufficient — see
>   [13-risk-register.md](./13-risk-register.md) for this logged as a
>   risk that materialized and was caught before anything was ever
>   committed.

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
  dependency policy requires); write schema + migrations, **including**
  the `tasks.leaseOwnerId`/`leaseExpiresAt` columns per
  [06-data-model.md](./06-data-model.md) §8 (schema-only here — the
  Durable Runner that actually uses them arrives in Phase 5, but the
  columns exist from this phase so Phase 5 doesn't need a migration of
  its own); write one repository per table group, including an atomic
  claim method (`claimEligibleTask()`) implementing the compare-and-swap
  update in
  [03-system-architecture.md](./03-system-architecture.md) §9.3, even
  though nothing calls it yet; seed `agent_roles` from the catalog in
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
  `SimulatedAdapter`, at $0. **Deliberately without the Durable Runner
  yet** — tasks are advanced by direct, manual calls to
  `AgentRunner.execute()` in this phase, proving the state machine and
  the `SimulatedAdapter` contract are correct in isolation before adding
  the dispatch/claim/lease machinery on top in Phase 5. This keeps each
  phase's surface area reviewable on its own.
- **Scope**: `lib/ai-office/providers/**` (interface +
  `SimulatedAdapter` + fixtures), `lib/ai-office/agents/agent-runner.ts`.
- **Prerequisites**: Phase 3 (data engine, including the lease columns
  and `claimEligibleTask()` repository method) complete.
- **Implementation tasks**: Define `AIProviderAdapter` interface per
  [04-agent-architecture.md](./04-agent-architecture.md) §4; build
  `SimulatedAdapter` with at least one success and one failure fixture
  per role; build `AgentRunner` per
  [04-agent-architecture.md](./04-agent-architecture.md) §5 (without the
  budget gate yet — that's Phase 6 — but structured so adding it later
  doesn't require a rewrite, i.e. the call site for the gate exists as a
  no-op hook); `AgentRunner.execute()` is written to accept an
  already-claimed task, so it needs no changes when Phase 5 starts
  calling it from the real claim loop instead of a test harness.
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

## Phase 5 — Orchestrator and Durable Local Execution Runner

- **Objective**: Replace hand-triggered task creation and execution
  (used for Phase 4 testing) with the real Orchestrator (planning) and
  the Durable Local Execution Runner (dispatch) — idea in, full task
  plan and role selection out automatically, and from this phase on,
  work keeps advancing whether or not the owner's browser is open. This
  is the phase that actually delivers the brief's "must not depend on
  keeping `/office` open" requirement — everything before it is
  necessary scaffolding, this is where it becomes true.
- **Scope**: `lib/ai-office/orchestrator/**` (planning: role selection,
  task-plan creation, quality gates) and `lib/ai-office/runner/**`
  (dispatch: the poll loop, claim/lease logic, crash-recovery sweep) —
  see [03-system-architecture.md](./03-system-architecture.md) §9 for
  the full design both of these implement.
- **Prerequisites**: Phase 4.
- **Implementation tasks**:
  1. **Orchestrator (planning)**: role-selection rule table
     ([05-orchestration-workflow.md](./05-orchestration-workflow.md)
     §2); quality gates (§5); wire the "Start New Project" flow (Server
     Action → Orchestrator, plan-and-return, no inline execution) into
     the dashboard shell from Phase 2.
  2. **Durable Runner (dispatch)**: implement `runOneCycle()` — read
     `OfficeStatus`, find eligible tasks (dependencies met, project
     `IN_PROGRESS`, no live lease), call the Phase 3
     `claimEligibleTask()` repository method, invoke
     `AgentRunner.execute()`, persist results, enqueue the next eligible
     task — per
     [03-system-architecture.md](./03-system-architecture.md) §9.2–9.6.
  3. Implement the startup crash-recovery sweep (§9.6 of that document).
  4. Choose and implement the process shape — Option A (in-process
     singleton via `instrumentation.ts`, verified against
     `node_modules/next/dist/docs/` first) or Option B (standalone
     companion script) — per
     [03-system-architecture.md](./03-system-architecture.md) §9.7;
     document the choice made with the same reason/alternatives writeup
     used for other implementer decisions in this package.
  5. Wrap `runOneCycle()` in the chosen timer/process shell, with the
     poll interval and per-attempt timeout both configurable, sane
     defaults per §9.5–9.6 of that document.
- **Expected files affected**: `lib/ai-office/orchestrator/**` (new),
  `lib/ai-office/runner/**` (new), `app/office/actions/project.ts`
  (new), `app/office/projects/**` (new pages: list, new, detail), and
  either `instrumentation.ts` (Option A) or a new `npm run office:runner`
  script entry in `package.json` (Option B).
- **Tests**: Re-run the Phase 4 workflow test twice — once via the real
  Orchestrator + direct `AgentRunner.execute()` calls (proving planning
  is correct), once via repeated `runOneCycle()` calls (proving dispatch
  is correct) — per
  [10-testing-strategy.md](./10-testing-strategy.md) §2.3; role-selection
  unit tests per §2.1; the full durable-runner/crash-recovery suite per
  §2.14, including the lease-claim-atomicity test.
- **Acceptance criteria**: Submitting an idea through the actual UI
  reaches `READY_FOR_REVIEW` unattended in simulated mode, **and**
  continues to do so after the owner closes the browser tab mid-run and
  the runner's process is later restarted (manual test: start a project,
  close the tab, stop and restart the dev/runner process, confirm the
  project still reaches `READY_FOR_REVIEW` without any further browser
  interaction).
- **Definition of Done**: End-to-end manual run through the real UI with
  the browser closed mid-workflow, plus all automated tests (§2.3, §2.1,
  §2.14), green.
- **Risks**: Role-selection rules too rigid for real idea phrasing —
  mitigated as before (small, isolated, tunable table). Dev-mode
  hot-reload accidentally starting a second concurrent poll loop (Option
  A) — mitigated by the module-level singleton guard called out in
  [03-system-architecture.md](./03-system-architecture.md) §9.7, and
  testable by asserting a task is claimed exactly once even under a
  simulated double-start.
- **Rollback**: Remove `lib/ai-office/orchestrator/**` and
  `lib/ai-office/runner/**`; Phase 4's manually-triggered flow still
  works as a fallback demo, with the caveat that browser-independent
  continuation (this phase's core deliverable) would no longer exist —
  acceptable only as a transient rollback state, not a shipped one.
- **Effort**: Large.

---

## Phase 6 — Budget, pause and approval controls

- **Objective**: Wire in every owner-facing control:
  Open/Close Office, Pause/Resume Project, budget caps/warnings, and the
  Approvals queue — all enforced in code, not just displayed.
- **Scope**: `lib/ai-office/domain/budget-service.ts`, office/project
  control Server Actions, `/office/approvals`, `/office/budget`.
- **Prerequisites**: Phase 5 (Orchestrator + Durable Runner both exist).
- **Implementation tasks**: Implement `BudgetService.authorize()` per
  [09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md) §2;
  wire it into `AgentRunner`'s existing no-op hook from Phase 4 (called
  the same way regardless of whether `AgentRunner` was invoked by a test
  harness, Phase 5's `runOneCycle()`, or, later, Phase 7's live runs —
  one call site, per [09](./09-budget-and-cost-controls.md) §2); build
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
  behind the existing interface, with no changes to Orchestrator,
  AgentRunner, or the Durable Runner — and no new entry point that could
  let a live call bypass either.
- **Scope**: `lib/ai-office/providers/claude-adapter.ts`, pricing table,
  provider selection UI (simulated vs. live toggle, per project).
- **Prerequisites**: Phase 6 (budget gate must exist *before* any live
  spend is possible) — and Phase 5's Durable Runner, since LIVE tasks are
  claimed and executed the same way SIMULATED ones already are.
- **Implementation tasks**: Implement `ClaudeAdapter` against the
  `AIProviderAdapter` interface; implement `estimateCost()` using real
  Claude pricing (kept in `pricing.ts`, see
  [09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md)
  §8); add `ANTHROPIC_API_KEY` to `.env.example` (documented, not
  committed with a value); add the simulated/live mode toggle to project
  settings UI. `ClaudeAdapter` is imported **only** inside
  `lib/ai-office/agents/agent-runner.ts`, exactly like `SimulatedAdapter`
  — no Server Action, Route Handler, or UI code ever imports a provider
  adapter directly. This is not a new rule for this phase; it's the
  Phase 4/§2-of-09 rule holding under the first real provider, verified
  explicitly here.
- **Expected files affected**: `lib/ai-office/providers/claude-adapter.ts`
  (new), `lib/ai-office/providers/pricing.ts` (new), `.env.example`,
  `app/office/projects/[id]/**` (mode toggle).
- **Tests**: Adapter unit tests against a mocked Claude client (no real
  API calls in automated tests, per
  [10-testing-strategy.md](./10-testing-strategy.md) §3); the existing
  import-graph test from §2.5 re-run to confirm it still passes with
  `claude-adapter.ts` present (proving the single-entry-point rule holds,
  not just asserted in prose); a small number of manual, owner-triggered
  smoke calls against real budget.
- **Acceptance criteria**: A single manual LIVE task run — claimed and
  executed by the same Durable Runner + `AgentRunner` + `BudgetService`
  path as every simulated run before it — completes, produces a real
  `ai_usage` row with accurate cost, and the budget gate correctly
  reflects the spend afterward.
- **Definition of Done**: One successful manual LIVE run, budget numbers
  verified against the Anthropic Console's actual usage for that key,
  import-graph test confirming no bypass path exists.
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
- **Implementation tasks**: Mostly TBD at the time this phase is actually
  greenlit — deliberately not designed in detail now, since the brief
  explicitly says not to design the first implementation around
  deployment, and any concrete choice made today would likely be stale
  by the time this phase starts. **One task is fixed regardless of what
  else this phase turns out to involve**: implement and verify
  brute-force/login throttling on `/office/login` (and any
  `app/api/office/**` Route Handler) — see
  [08-security-plan.md](./08-security-plan.md) §10, which names this a
  mandatory prerequisite, not an optional hardening pass.
- **Expected files affected**: TBD.
- **Tests**: TBD, but must include everything in
  [10-testing-strategy.md](./10-testing-strategy.md) §2.13 against the
  deployed environment, not just localhost — **plus** a test that a
  scripted brute-force attempt against `/office/login` is actually
  blocked by the rate limiter, not merely that one is configured.
- **Acceptance criteria**: TBD for deployment-specific items, but fixed
  for one: `/office/login` is never reachable from outside `localhost`
  without login throttling already in place and verified.
- **Definition of Done**: TBD, but cannot be reached without the rate
  limiting task above — see
  [12-definition-of-done.md](./12-definition-of-done.md).
- **Risks**: Premature optimization if planned in detail now. Mitigation:
  intentionally deferred.
- **Rollback**: N/A until scoped.
- **Effort**: Unestimated (deliberately).

---

## Phase ordering notes

- Phases 0–6 require **zero** paid AI spend and **zero** new external
  accounts — this is intentional; a huge amount of the system can be
  built and proven before Phase 7's first real cost is incurred. This
  includes the Durable Runner (Phase 5) — it only ever invokes
  `SimulatedAdapter` until Phase 7 exists, so its introduction does not
  move the "first real cost" line.
- Phase order is mostly strict (each depends on the previous), with one
  required exception: **Phase 1 and Phase 2's minimal login-shell task
  ship together as one release checkpoint**, not strictly sequentially —
  see the note at the top of Phase 1. Phase 2's remaining scope (the
  populated dashboard) and every phase after it remain strictly
  sequential.
- Browser-independent execution (the brief's core durability requirement)
  becomes true starting in **Phase 5**, not Phase 0 or "eventually" —
  before Phase 5, task creation and execution are still coupled to a
  single request, which is an accepted, deliberate limitation of Phases
  0–4's scaffolding, not the shipped end state.
