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

> **Implemented** on `feature/teja-ai-office`. A deterministic, zero-cost
> simulation layer proves the full idea → approval-readiness workflow
> (including QA failure, retry, and escalation) without calling any AI
> model. No orchestration intelligence, no Durable Runner, no live
> provider — persistence-adjacent execution only, as scoped.
>
> **Schema migration**: none required. Migration `001-init.sql` (Phase
> 3) was analyzed against every Phase 4 transition and found already
> sufficient — treated as immutable, not touched. Two clarifications
> were needed (not schema gaps, just resolving informal task-brief
> phrasing against the literal approved enums):
> - "PENDING → RUNNING → DONE" in the task brief maps to the schema's
>   actual `tasks.status` values `PENDING → IN_PROGRESS → DONE` (there
>   is no literal `RUNNING` value for `tasks.status` — that word
>   describes `task_attempts.status`/`agent_runs.status`, which do have
>   it).
> - "FAILED → BLOCKED/ESCALATED" maps to `tasks.status = 'BLOCKED'` +
>   `agent_runs.status = 'ESCALATED'` (both already in the Phase 3
>   schema) + a `failures` row — **not** a new `approvals` row. None of
>   `approvals.kind`'s ten values ([08-security-plan.md](./08-security-plan.md)
>   §9) semantically fit "a task exhausted its retries," and
>   [04-agent-architecture.md](./04-agent-architecture.md) §6 itself
>   allows escalation to surface as either "a pending Approval **or** a
>   flagged item on the dashboard" — the latter is what `tasks.status =
>   BLOCKED` + an unresolved `failures` row already provides.
>
> **Provider interface**
> (`lib/ai-office/providers/types.ts`): implements
> [04-agent-architecture.md](./04-agent-architecture.md) §4's
> `AIProviderAdapter`/`AgentTaskInput`/`CostEstimate` exactly, with one
> deliberate, documented refinement — `AgentTaskResult.output` is a
> single `StructuredAgentOutput` shape (summary, artifacts[],
> decisions[], testResults[], events[], recommendedNextActions[],
> optional failure) rather than the planning sketch's bare
> `ArtifactPayload | TestResultPayload | DecisionPayload` union, which
> couldn't represent a role producing more than one kind of output at
> once (the Architect routinely needs to emit both an artifact *and* a
> decision in the same run). Provider-neutral; a future `ClaudeAdapter`
> (Phase 7+) implements the same interface unchanged.
>
> **`SimulatedAdapter`**
> (`lib/ai-office/providers/simulated/`): the only provider in this
> phase. `estimateCost()` always returns zero. Fixtures
> (`fixtures.ts`) are keyed by `roleId` + an explicit `scenario` string
> read from `TaskContext.scenario` — never random. Every one of the 11
> approved roles has `success` and `failure` fixtures; the two developer
> roles (frontend/backend) additionally have `retry-success` (visibly
> different content — "applied a fix for the QA-reported issue" — not
> just a different status, so the fix is evidenced in artifact content,
> not only in attempt history). QA's `failure` fixture is modeled as
> `AgentTaskResult.status: "FAILED"` even though the QA *agent itself*
> didn't error — the task's Definition of Done (passing tests) wasn't
> met, which is what "failed" means at this framework level; the fixture
> still carries a real `testResults` entry (`status: "FAIL"`) alongside
> the failure reason.
>
> **`AgentRunner`**
> (`lib/ai-office/agents/agent-runner.ts`, `executeTask()`): loads task/
> role/project, checks the budget gate, creates the `TaskAttempt`, builds
> scoped context, creates the `AgentRun`, invokes the adapter, persists
> `AIUsage` unconditionally, then on success persists artifacts/
> decisions/test results/events, marks the attempt/run/task DONE,
> resolves any failure previously recorded against this task, advances
> project status (bookkeeping against the five fixed quality gates in
> [05-orchestration-workflow.md](./05-orchestration-workflow.md) §5 —
> not role-selection or planning), and refreshes project memory. On
> failure it persists any partial test result, the failure record, and
> the event, then either requeues (attempt count ≤ role.maxRetries) or
> escalates. `executeTask()` refuses to run a task that isn't `PENDING`
> ("not-eligible") — the concrete guard against ever re-running a
> terminal or already-claimed task, since Phase 4 has no dispatch loop
> to accidentally call it twice. `lib/ai-office/agents/budget-gate.ts`'s
> `authorizeBudget()` is the preserved Phase 6 hook — SIMULATED always
> authorizes, LIVE is refused outright (no adapter exists yet). No
> module outside `agent-runner.ts` imports `SimulatedAdapter` — enforced
> by an architectural test, not just convention.
>
> **Retry/escalation behavior — corrected post-review, see the
> "Post-review correction" note below for the bug this replaced**:
> review-type roles (`qa-agent`, `security-reviewer`, `code-reviewer` —
> derived semantically, see below, not a hardcoded id list) resolve
> their remediation target by walking the dependency ancestry *backwards*
> until they find a development-role task, however many review hops
> away that is — not just the immediate parent. Every already-`DONE`
> review task that transitively depends on that development task is
> also reopened (it validated code that's about to change again), and
> the failing review task itself is reopened to rerun once the fix
> lands. Every non-review role still retries itself on failure, per
> [05-orchestration-workflow.md](./05-orchestration-workflow.md) §4's
> "QA failure re-opens the developer task... not the QA task itself."
> The ceiling check follows
> [04-agent-architecture.md](./04-agent-architecture.md) §3's lifecycle
> diagram literally (`attempt++ ≤ maxRetries` retries, otherwise
> escalates) — with the seeded default `maxRetries: 3`, that's 4 total
> attempts allowed before escalation, not 3; recorded here since the
> diagram's exact arithmetic is easy to misread.
>
> **Context scoping**
> (`lib/ai-office/agents/context-builder.ts`): built directly from each
> role's own `allowedInputs` tags (already seeded in
> `agent-role-catalog.ts`) — fetches only the latest artifact per
> allowed type and, only when `project-memory` is an allowed input, the
> project summary and decisions. Structurally reads only `artifacts`/
> `project_decisions`/`project_memory_cache` — there is no code path by
> which `budget_records`, `ai_usage`, or `users` rows could ever reach a
> role's context, regardless of `allowedInputs` content.
>
> **Project memory**
> (`lib/ai-office/domain/project-memory.ts`, new — not built in Phase 3,
> whose required-entity list didn't include it): `refreshProjectMemory()`
> is plain counting/templating over already-persisted rows (task
> completion count, current task, latest test status, unresolved
> failures, decision count) — not a summarizer model, deterministic by
> construction. Called by AgentRunner after every terminal task outcome,
> *after* project status is advanced so the summary reflects the final
> state of that run.
>
> **Tests**: 108 automated tests, across 7 new files
> (`providers/__tests__/simulated-adapter.test.ts`,
> `agents/__tests__/{import-boundary,agent-runner,phase4-simulation,remediation}.test.ts`,
> plus 2 domain/db files unchanged from Phase 3). All Phase 3 tests
> remain green — no Phase 3 file was modified. The full acceptance
> scenario (idea → product → research → architecture → dev → QA fail →
> fix → QA pass → security → code review → release readiness) is run
> both once and 3 consecutive times against fresh temp databases in the
> same test file, asserting byte-identical artifact content and project-
> memory summaries across runs. `npm run test:ai-office`'s script was
> changed from a hard-coded file list to a quoted glob
> (`"lib/ai-office/**/*.test.ts"`) once it became clear Node's test
> runner *does* support glob arguments (a bare directory path does not)
> — new test files are picked up automatically from here on, no more
> manual script edits per file.
>
> **Post-review correction (same phase, before Phase 5 began)**: the
> first version of this phase's retry logic reopened a failing review
> task's *direct* dependency, which is only correct for QA (its direct
> dependency is the development task). For the real Phase 4 workflow
> graph — Developer → QA → Security and Developer → QA → Code Review —
> that reopened QA when Security or Code Review failed, not the
> development task the finding actually required a code change in
> (concretely: a Security finding like "unvalidated file path input," or
> a Code Review finding like "inconsistent error handling," would have
> been "fixed" by merely rerunning QA, with no code change involved at
> all). Root cause: "review role → reopen direct dependency" is a
> graph-position assumption that only happens to hold for a two-hop
> chain (Developer → QA); it silently breaks for any longer chain.
> Fixed by deriving two role categories from data already seeded in
> Phase 3 — never a hardcoded role-id list, never graph position — in
> the new `lib/ai-office/agents/remediation.ts`: a **development role**
> is any role whose `allowedOutputs` includes `"code"`; a **review
> role** is any role whose `allowedInputs` includes `"code"` but whose
> `allowedOutputs` does not. `findRemediationTargets()` walks the
> dependency ancestry backwards from a failing review task past any
> number of intermediate review hops until it finds development-role
> task(s). `findStaleDownstreamReviews()` then finds every already-
> `DONE` review task that transitively depends on those development
> tasks — this is what correctly reopens QA when Security fails (a task
> strictly *between* the development task and the one that failed) and
> *also* correctly reopens an already-passed Security when Code Review
> fails afterward on the same code (an already-`DONE` sibling branch,
> not on the direct path to the failing task at all) — one rule covers
> both cases. This generalizes automatically to any future development
> role (a hypothetical `mobile-developer` seeded with `"code"` in
> `allowedOutputs` needs no change to this file) and to any future
> review role seeded the same way — see
> [14-open-questions.md](./14-open-questions.md) if a role is ever added
> that doesn't fit this input/output-based classification cleanly.
> Verified with 8 new tests in
> `agents/__tests__/remediation.test.ts`: Security failure → remediation
> targets the developer task, not QA; Code Review failure → same; the
> full remediation loop for each (dev fix → QA rerun → the failing
> review reruns and passes); the combined case (Security already `DONE`,
> Code Review fails, Security is invalidated and must rerun); escalation
> for both Security and Code Review past their retry ceiling, with a
> confirmed "no infinite loop" refusal afterward; and that
> `READY_FOR_REVIEW` stays unreachable until every reopened review task
> is `DONE` again (the existing `advanceProjectStatus` bookkeeping needed
> no changes — it already required literally every task `DONE`, so once
> this fix correctly reopens a stale review task to non-`DONE`, that
> existing "all tasks `DONE`" check does the rest). Context scoping
> (`context-builder.ts`) was not touched by this fix — confirmed by
> rerunning the existing context-scoping tests unchanged.
>
> **Deviations from the planning docs, recorded rather than silently
> made**: the `AgentTaskResult.output` shape refinement (above); the
> "retry ceiling" arithmetic clarification (above); QA's failure
> being modeled as `AgentTaskResult.status: "FAILED"` rather than a
> "succeeded but reported a failure" shape (there is no such third state
> in the approved lifecycle diagram, and this reading is what makes the
> QA→developer reopening rule apply without a special case); the
> review-role-reopens-remediation-target rule (corrected version, above)
> was generalized from QA (the only role the docs give a worked example
> for) to every review role via the semantic
> allowedInputs/allowedOutputs classification, not a hardcoded id list.

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

> **Implemented** on `feature/teja-ai-office`. Idea submission now
> produces a full, validated task plan automatically
> (`lib/ai-office/orchestrator/**`), and a durable, browser-independent
> local process (`lib/ai-office/runner/**`) advances that plan to
> completion — including the full QA-failure/remediation path from
> Phase 4 — without any test or human code ever naming which task runs
> next. Still $0, still `SimulatedAdapter`-only, still no deployment.
>
> **Scope deviation from the original planning bullets below, made
> explicitly per this phase's actual authorization, not silently**: the
> "Start New Project" dashboard flow and the `app/office/projects/**`
> list/new/detail pages listed under "Expected files affected" below
> were **not** built this phase. The authorization that actually scoped
> this phase's work explicitly excluded dashboard/UI polishing ("do not
> build a full operational dashboard... do not spend the phase
> polishing UI"), narrowing Phase 5 to the Orchestrator + Runner engine
> only. The existing Phase 2 authenticated placeholder is unchanged.
> Wiring a real "submit an idea" UI onto `planProject()` remains
> straightforward future work — the function itself is already a plain,
> synchronous, fully-tested entry point a Server Action can call
> directly.
>
> **Orchestrator (planning)** (`lib/ai-office/orchestrator/`):
> `planProject(db, projectId)` is the single planning entry point —
> requires the project be `DRAFT` with an idea attached, and is fully
> transactional (one `BEGIN`/`COMMIT` around every task/dependency
> insert, the planning decision, and either the `IN_PROGRESS` transition
> or the approval-required `BLOCKED` transition), so a planning failure
> midway — an exception from `validateTaskGraph`, or any DB error —
> leaves the project exactly as it was, never a half-written task set.
> Three collaborating pieces:
> - `role-selection.ts` — a deterministic, keyword-based classifier
>   (`selectRoles()`), explicitly **not** AI: the same idea text always
>   selects the same roles. Always includes `product-owner`,
>   `solution-architect`, `backend-developer`, `qa-agent`,
>   `code-reviewer`, `release-agent`; conditionally adds
>   `ui-ux-agent`+`frontend-developer` on a UI/screen signal,
>   `security-reviewer` on an auth/payment/PII/network signal, and
>   `research-agent` on an explicit research signal *or* when the idea
>   text is under 8 words (too little to plan confidently without a
>   feasibility pass). A small, unambiguous backend-only idea correctly
>   skips `ui-ux-agent`/`frontend-developer` — proving roles aren't woken
>   for every idea, per this phase's explicit requirement.
> - `graph.ts` — pure, DB-free `validateTaskGraph()`: rejects duplicate
>   task ids, self-dependencies, dependencies on ids absent from the
>   plan, and any cycle (Kahn's algorithm — a node set that can't be
>   fully topologically ordered contains a cycle). Called *before*
>   `planProject()` opens its transaction — an invalid plan is refused
>   before a single row is written, not rolled back after.
> - `orchestrator.ts` — `buildTaskPlan()` turns a selected role set into
>   dependency edges following
>   [04-agent-architecture.md](./04-agent-architecture.md) §1's input
>   columns (Product → [Research] → Architecture → [UI/UX] →
>   [Frontend]/Backend → QA → [Security]/Code Review → Release), with
>   every role's dependencies recomputed against whichever *other* roles
>   are actually present in that specific plan — omitting an optional
>   role never leaves a dangling reference. `requiresOwnerApproval()` is
>   a synthetic, test-only signal (idea text matching "paid service" /
>   "subscription" / etc.) that creates a `PENDING` `approvals` row and
>   `BLOCKED`s the project instead of starting execution — proving the
>   approval-gate mechanics without any real destructive/paid action.
>
> **Two low-level primitives were added to `lib/ai-office/domain/tasks.ts`**
> (`insertTaskRow`, `insertTaskDependencyRow`) purely because SQLite has
> no nested transactions — the Phase 3 `createTask`/
> `createTaskWithDependencies` each open their own `BEGIN`/`COMMIT`, so
> they can't be called from inside the Orchestrator's own transaction.
> These two are intentionally non-transactional, single-INSERT
> primitives that only the Orchestrator's own transaction wraps.
>
> **Eligibility — the one place task-execution readiness is decided**
> (`lib/ai-office/runner/eligibility.ts`, `findEligibleTasks()`): a
> `PENDING` task is eligible when its project is `IN_PROGRESS`, has no
> `PENDING` approval blocking it, the task holds no unexpired lease, and
> every dependency is `DONE` (checked in JS against a small per-project
> graph, not a correlated SQL subquery — kept as readable code, per the
> "implement this in one clear location" requirement). Two deliberate
> non-checks, each documented in the file itself: retry ceilings aren't
> re-checked here because `AgentRunner` already moves a
> ceiling-exceeded task to `BLOCKED` (not `PENDING`) at failure time, so
> it's naturally excluded; a `LIVE`-mode project's task is **not**
> filtered out here — it's left structurally eligible so the Runner
> claims it and lets `AgentRunner`'s existing budget gate refuse it with
> a proper event, rather than this function silently hiding LIVE work
> (the brief's explicit "do not silently fall back to SIMULATED").
>
> **Durable Local Runner** (`lib/ai-office/runner/runner.ts`):
> `runOneCycle(db, runnerId, options?)` is the entire mechanism — one
> bounded claim/execution unit, genuinely `async` (it `await`s
> `AgentRunner.executeTask()` directly rather than assuming anything
> about how a provider adapter settles internally, which would be a
> fragile assumption to bake in just because `SimulatedAdapter` happens
> not to use a real timer today). Per cycle, in order: (1) refuse if the
> Office isn't `OPEN`; (2) sweep for crash-interrupted work
> (`findStaleLeasedTasks` — any `IN_PROGRESS` task holding an expired
> lease is restored to `PENDING`, `attemptCount` left untouched since it
> was already incremented when that interrupted attempt began, and a
> `task.recovered_after_crash` event is recorded; a stale lease on an
> already-terminal task is cleared silently, not reported as a
> recovery) — if anything was recovered, that recovery *is* this cycle's
> unit of work, new execution waits for the next cycle; (3) find
> eligible tasks and atomically claim the oldest one via the Phase 3
> `claimTask()` CAS (`UPDATE ... WHERE status='PENDING' AND (lease NULL
> OR expired)`) — losing the race to another runner connection is not an
> error, just nothing to do this cycle; (4) refuse outright (never
> silently downgrade) a claimed `LIVE`-mode task, releasing its lease and
> `BLOCK`ing the project with a `project.live_mode_refused` event; (5)
> otherwise execute through `AgentRunner.executeTask()` and unconditionally
> release the lease afterward in a `finally`, regardless of outcome — a
> retried task must be immediately eligible again next cycle, not stuck
> waiting for its lease to expire naturally. Returns a structured
> `{ kind, detail? }` outcome — `executed | idle | office-closed |
> no-eligible-work | live-mode-refused | recovered | error` — deterministic
> and side-effect-free to interpret. `startRunLoop(db, options)` is a
> thin `setTimeout`-based wrapper repeatedly calling `runOneCycle()` at a
> configurable interval (default 5s; tests inject a short one) with a
> synchronous `stop()` handle; all real logic stays in `runOneCycle()`,
> the loop has none of its own.
>
> **Startup strategy — standalone companion script, not an
> `instrumentation.ts` singleton** (`lib/ai-office/runner/start.ts`, run
> via `npm run ai-office:runner`): decided in the user's favor of the
> stated concern going in. `next dev`'s hot-reload restarts the Next.js
> server module graph on every server-file save; an in-process singleton
> guarded only by a module-level variable would either be killed and
> silently respawned mid-cycle on every save, or — worse, since Next's
> hot-reload doesn't always tear down old module instances cleanly —
> risk two concurrent poll loops existing briefly across a reload,
> which is exactly the failure mode the "no two runners execute the same
> task simultaneously" requirement rules out. A separate `node` process
> has no such lifecycle coupling: it starts once, runs until explicitly
> stopped, and talks to the same `.data/office.db` file via the
> identical `getAppDatabase()` the Next.js app itself lazily opens (same
> migrate-then-seed-on-first-access path, so there's no separate manual
> init step). This also directly satisfies "closing `/office` must not
> stop the workflow" — the browser and the runner process have no
> relationship to each other at all, by construction, not by convention.
> `start.ts` generates a per-process `runnerId` (`runner-<pid>-<random>`),
> reads `AI_OFFICE_RUNNER_POLL_INTERVAL_MS` for interval override, logs
> every non-idle/non-no-eligible-work outcome (idle polling stays quiet —
> no spam), and on `SIGINT`/`SIGTERM` calls `stop()` and lets any
> in-flight cycle finish naturally rather than force-exiting mid-transaction
> — safe either way, since every terminal DB transition
> `AgentRunner` makes is already wrapped in its own SQL transaction and
> the crash-recovery sweep exists precisely to reclaim an even harder
> kill (`SIGKILL`, power loss) on the next startup. This resolves the
> corresponding open question in
> [14-open-questions.md](./14-open-questions.md).
>
> **A genuine atomicity gap, found and fixed while reviewing
> `AgentRunner` for this phase** (not a regression introduced here —
> latent since Phase 4, made newly dangerous once execution runs
> unattended in the background): `finishSuccess()` and `finishFailure()`
> each issued several separate, non-transactional SQL statements for
> what is logically one terminal transition. A crash between two of
> those statements could leave a torn state — e.g. an artifact already
> written but the task still `IN_PROGRESS` — which the new
> crash-recovery sweep would then re-execute, producing a *duplicate*
> artifact for the same attempt. Fixed by wrapping each function's
> entire body in `BEGIN`/`COMMIT`/`ROLLBACK`; verified by the crash-recovery
> test that recovers an interrupted attempt and confirms the
> eventual successful re-execution produces exactly one artifact, not
> two.
>
> **Execution timeout** (`lib/ai-office/agents/agent-runner.ts`):
> `callAdapterWithTimeout()` races the adapter call against a `setTimeout`
> (`Promise.race`'s standard shape — a Promise cannot be forcibly
> cancelled, only stopped-waiting-for, which is safe here since neither
> `SimulatedAdapter` nor any code in this repo has a side effect tied to
> the loser of that race actually completing). Default 5 minutes
> (`DEFAULT_TASK_TIMEOUT_MS`, generous for a future live provider,
> irrelevant to the always-instant `SimulatedAdapter`); a timeout
> synthesizes a `FAILED` `AgentTaskResult` so it flows through the exact
> same retry/escalation path as any other failure, with no separate
> "timeout" code path to keep in sync. Proven at both the `AgentRunner`
> layer directly and through the Runner (`RunOneCycleOptions.execution`
> accepts a short `timeoutMs` and a test-only hanging adapter) with a
> repeated-timeout escalation test, confirming a hung provider call
> cannot stall the office forever and eventually escalates like any
> other repeated failure.
>
> **Office Close/Open, Project Pause/Resume**: a `CLOSED` office refuses
> every cycle immediately (`office-closed`), touching no task state at
> all; reopening resumes eligible work on the very next cycle, with
> nothing to explicitly "restart." A `PAUSED` project's tasks are simply
> excluded from `findEligibleTasks()`'s `p.status = 'IN_PROGRESS'`
> filter — no task is deleted, recreated, or otherwise touched; other
> active projects are entirely unaffected; resuming (`IN_PROGRESS` again)
> makes its tasks eligible again from exactly the state they were left
> in.
>
> **Multiple projects**: `findEligibleTasks()` has no per-project
> fairness logic — it orders candidates by `createdAt` across every
> `IN_PROGRESS` project and the Runner claims the oldest eligible one,
> per cycle, globally. This is deliberately simple, per the brief's "no
> sophisticated fairness needed" — but it does mean an older project
> that keeps failing and retrying (each retry returns it to `PENDING`
> immediately, same `createdAt`) sorts ahead of a newer, healthy
> project's tasks every single cycle until it exhausts its retry
> ceiling. Verified this starvation is *bounded*, not indefinite: once
> the failing project's task escalates (4 attempts, the seeded
> `maxRetries: 3` default) its project moves to `BLOCKED`, which removes
> it from `findEligibleTasks()`'s `IN_PROGRESS` filter entirely, and the
> healthy project's tasks then proceed to completion — proven directly
> by a test where a permanently-failing project's task is created first
> (the worst ordering case) and a second, healthy project still reaches
> `READY_FOR_REVIEW`.
>
> **Approval-required tasks**: an idea matching the synthetic
> approval-required signal never has any of its tasks executed, no
> matter how many cycles run — its project is `BLOCKED` at planning
> time (before any task exists in `IN_PROGRESS` territory), which keeps
> every one of its tasks out of `findEligibleTasks()` permanently until
> the approval is explicitly decided (a future phase's job; this phase
> only proves the block holds).
>
> **Readiness-gate strengthening**: `advanceProjectStatus()`'s
> latest-test-result query was changed from a plain `SELECT ... FROM
> test_results ORDER BY createdAt DESC LIMIT 1` to one `JOIN`ed against
> `tasks` and scoped to `t.status = 'DONE'`. This is defense-in-depth,
> not a bug fix — the existing `allDone` check (every task in the plan
> must already be `DONE`) already made the old query safe in practice,
> since a reopened review task's status reverts to non-`DONE` the moment
> Phase 4's remediation fix invalidates it, which already blocked
> `allDone` from passing on stale evidence. The join means this specific
> query is now correct even read in isolation, without relying on the
> `allDone` check upstream of it. Verified under full autonomous
> execution (not just direct `AgentRunner` calls): an idea that makes QA
> fail once reaches `READY_FOR_REVIEW` only after the developer fix
> lands and QA reruns and passes — driven entirely by repeated
> `runOneCycle()` calls, no manual task selection.
>
> **Remediation fix, proven again under the Runner**: the Phase 4
> QA/Security/Code-Review remediation-routing fix (walking dependency
> ancestry to the actual development task, invalidating stale downstream
> reviews) is exercised end-to-end through `runOneCycle()` in the
> autonomous acceptance tests, not only via direct `AgentRunner` calls —
> confirming the fix holds when task selection is the Runner's decision,
> not the test's.
>
> **A real bug found and fixed while writing tests for this phase**:
> `role-selection.ts`'s keyword matching originally used plain
> `text.includes(signal)`, which false-positives badly on short signals
> — `"ui"` is a substring of `"build"`, and since nearly every idea in
> this system's own test fixtures (and realistically, in real usage)
> literally starts with "Build a...", a plain substring check would have
> tagged almost every idea as UI/UX-relevant, defeating the explicit
> "a small backend utility skips UI/UX and Frontend" requirement this
> phase exists to satisfy. Caught by writing the "backend-only idea"
> test before assuming it would pass, not by inspection. Fixed with
> word-boundary regex matching (`\bsignal\b`, case-insensitive) instead
> of substring `includes`.
>
> **Schema migration**: none required. Every table Phase 5 reads or
> writes (`tasks`, `task_dependencies`, `projects`, `approvals`,
> `project_decisions`, `messages_events`) already exists in the
> immutable `001-init.sql`; no new columns or tables were needed.
>
> **Tests**: 61 new automated tests across 5 new files —
> `orchestrator/__tests__/{graph,role-selection,orchestrator}.test.ts`
> (26), `runner/__tests__/{eligibility,runner}.test.ts` (32), plus 3 new
> execution-timeout tests added to the existing
> `agents/__tests__/agent-runner.test.ts`. All 108 Phase 1–4 tests remain
> green, unmodified except the deliberate `agent-runner.ts` atomicity/
> timeout/readiness changes above — 169 total, `npm run test:ai-office`.
> Covers (non-exhaustively): deterministic role selection including the
> small-idea-skips-UI case; DAG cycle/missing-dependency/self-dependency
> rejection; planning transactionality and idempotent-refusal on a
> non-`DRAFT` project; every eligibility rule in isolation; Office
> Close/Open; Project Pause/Resume including "paused doesn't block
> another project"; a dual-connection claim race (exactly one execution,
> the loser correctly reports no remaining work); crash recovery with
> `attemptCount` preserved and no duplicate artifacts on re-execution; a
> stale lease on an already-terminal task recovering silently;
> timeout + repeated-timeout escalation, at both the `AgentRunner` and
> Runner layers; `LIVE`-mode refusal with the project `BLOCKED` and the
> task itself left untouched; graceful `stop()` halting polling
> immediately; a full idea-only autonomous run reaching
> `READY_FOR_REVIEW` via `runOneCycle()` alone; the QA-failure/
> remediation path under autonomous execution; the approval-required
> path never executing any task; the same autonomous idea run 3 times on
> fresh databases producing an identical final shape; two-project
> isolation with no cross-project artifact leakage; the bounded-starvation
> behavior above; and a runner-restart-continuity test proving a second,
> unrelated `runnerId` against the same DB picks up exactly where the
> first left off with no in-memory state required (the same property a
> real process restart relies on).
>
> **Browser independence**: every Runner/Orchestrator test in this phase
> runs under plain `node --test` — no Next.js dev/prod server, no route
> handler, no React import anywhere in `lib/ai-office/orchestrator/**` or
> `lib/ai-office/runner/**`. `runOneCycle()`/`startRunLoop()` take a
> `DatabaseSync` handle and nothing else; the standalone
> `lib/ai-office/runner/start.ts` script (smoke-tested directly against
> the real `.data/office.db`, output restored afterward) demonstrates the
> same thing as an actual separate OS process, not just a test-harness
> abstraction.
>
> **Deviations from the planning docs, recorded rather than silently
> made**: the dashboard/UI scope narrowing (above, first paragraph); the
> standalone-script startup strategy (above, resolves the corresponding
> open question rather than leaving both options theoretically live);
> `runOneCycle()`/`startRunLoop()` are genuinely `async` rather than a
> synchronous-looking wrapper — an earlier draft of this file briefly
> used a `Promise`-draining trick to keep the whole call chain
> "synchronous," which was correctly flagged during review as a fragile
> assumption about `SimulatedAdapter`'s internals rather than a real
> guarantee, and was replaced with a plain `await` before any test was
> written against it; the `role-selection.ts` substring-matching bug fix
> (above); the `agent-runner.ts` atomicity gap fix (above, a proactive
> fix within the explicitly authorized "if you discover a genuine
> atomicity gap... fix it" scope, not a user-reported bug).
>
> **Known issues / accepted limitations**: the global (not
> per-project-fair) eligibility ordering means a failing project can
> delay — never indefinitely, per the bounded-starvation analysis above
> — a healthy project's progress until its retry ceiling is exhausted;
> acceptable per the brief's explicit "no sophisticated fairness needed."
> `start.ts`'s `SIGINT`/`SIGTERM` handling is unit-reasoned (bounded
> execution + transactional terminal writes + existing crash recovery)
> and smoke-tested for startup/idle behavior, but genuinely
> concurrent OS-level signal delivery to a `node`-under-`npm` child
> process was not independently reproduced in this Windows/Git-Bash
> development environment; the underlying `stop()` logic itself (not the
> OS signal plumbing) is directly covered by an automated test.

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
