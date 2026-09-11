# 14 — Open Questions

Genuinely undecided items — anything here was deliberately left for
Raviteja (or the Phase implementer, with his sign-off) rather than
silently assumed. Nothing in the rest of this package depends on these
being resolved a particular way; each notes what changes if resolved
differently.

## 1. How is `docs/ai-office/**` kept out of a public production branch/artifact — and when must that be decided?

This repo already excludes `ADMIN_SPEC.md`, `CMS_ARCHITECTURE.md`,
`FIREBASE_MIGRATION.md`, `LAUNCH.md`, `MEDIA_GUIDE.md`, `AGENTS.md`, and
`CLAUDE.md` from version control with an explicit "private planning/ops
notes" comment. This new package is now explicitly classified as
internal planning material regardless (see
[08-security-plan.md](./08-security-plan.md) §12) — the open question is
purely *mechanism and timing*, not *whether*:

- **Mechanism options**: (a) add `/docs/ai-office/` to the existing
  private-docs block in `.gitignore` going forward (stops future commits
  from tracking it further, doesn't remove what's already tracked); (b)
  keep it tracked on working branches like `feature/teja-ai-office` for
  development visibility, but exclude it at merge/release time (e.g. a
  merge-time filter, or simply never merging this directory into
  `master`, keeping it a branch-local artifact); (c) a build/export step
  that produces "the public repo" as a derived artifact with internal
  docs stripped, leaving the full history intact in the working
  repository. Not decided here.
- **Timing**: this does **not** need to be resolved before Phase 1
  implementation starts (this task's own instruction was explicit: keep
  working on the current feature branch normally for now). It **does**
  need to be resolved before any merge of this work into `master`, and
  certainly before Phase 10 (optional deployment).
- **Hard constraint on any option chosen**: **git history is not to be
  rewritten** to achieve this (explicit instruction — no `filter-branch`,
  no history-rewriting removal of this package from past commits on this
  branch). Whatever mechanism is picked must work forward from wherever
  the codebase is when the decision is made, not by erasing that this
  package existed in history.
- A legitimate reason to lean toward keeping some or all of it publicly
  visible eventually: Raviteja may want it visible as a portfolio
  artifact demonstrating planning rigor to recruiters — a real
  consideration given the audience this repo already writes for
  (`README.md` Author/Contact section) — which is exactly why this is
  framed as a mechanism/timing question for him to resolve, not a
  foregone "hide everything" conclusion.

## 2. SQLite driver: `node:sqlite` vs. `better-sqlite3` — **RESOLVED (Phase 3)**

`node:sqlite` was chosen — the real developer environment runs Node
v24.13.0, where `node:sqlite`'s `DatabaseSync` works with zero flags
(still logging an `ExperimentalWarning`, harmless and one-time per
process) and needed only a devDependency version bump
(`@types/node` `^20` → `^24.13.4`, to unlock its type declarations — no
new runtime dependency). Zero native-module/Windows prebuild risk,
since it ships inside the Node binary itself. Full writeup — alternatives
considered, dependency impact, Windows compatibility, cost — in
[11-implementation-phases.md](./11-implementation-phases.md)'s Phase 3
status note. See [06-data-model.md](./06-data-model.md) §1 for the
original two-option framing this resolves.

## 3. Durable Runner implementation shape: in-process singleton vs. standalone companion process

[03-system-architecture.md](./03-system-architecture.md) §9.7 lays out
both options (Option A: `instrumentation.ts`-based in-process singleton;
Option B: a standalone `npm run office:runner` script) with a lean
toward Option A for single-command developer experience, but leaves the
final call to whoever implements Phase 5 — largely because Option A's
viability depends on verifying `instrumentation.ts`'s exact current
behavior against the installed Next.js version's own docs (per
`AGENTS.md`) at implementation time, not on anything decidable from this
package alone.

## 4. Test runner choice — **RESOLVED (Phase 3): stayed with `node:test`, did not add Vitest**

The original planning-time lean toward Vitest (below) was reconsidered
and reversed once Phase 3's actual scope was in front of an
implementer: pure Node-side persistence/integration tests need no
DOM/component-testing environment, no mocking framework, no snapshot
tooling — everything Node's built-in `node:test` + `node:assert`
already cover. Adding Vitest now would be a dependency with no
capability this phase actually needed. `npm run test:ai-office` covers
the auth (`token.test.ts`) and Phase 3 persistence
(`db/__tests__/schema.test.ts`,
`domain/__tests__/repositories.test.ts`) suites this way. This is
scoped to Phase 3 specifically — a later phase that genuinely needs
component/UI testing (per
[10-testing-strategy.md](./10-testing-strategy.md) §2.12, not before
Phase 8+) should re-open this question with that concrete need in hand,
not reopen it speculatively.

Original framing, for reference: Vitest was recommended (fast,
TypeScript-native, no config-file sprawl, pairs naturally with a future
component-testing need) but not installed or committed to in the
original planning task. See
[10-testing-strategy.md](./10-testing-strategy.md) §1.

## 5. Notification delivery for "project ready for review"

The product spec (§3.2) commits only to an in-app activity feed
notification at minimum. Whether to add anything beyond that — desktop
notification, email, something else — is unresolved. Given "no
unnecessary SaaS dependencies" and local-first, the likely answer is
"in-app only, indefinitely," but this is Raviteja's call, not assumed
here.

## 6. Should Orchestrator role-selection ever become an LLM call itself?

[05-orchestration-workflow.md](./05-orchestration-workflow.md) §1 notes
this as a possible Phase 7+ enhancement (better judgment on ambiguous
ideas) but explicitly does not commit to it — the rule-based table is
sufficient for Phases 4–6 and arguably sufficient indefinitely for a
single-user tool with modest idea volume. If pursued, it must remain
strictly additive (a new option behind the same interface), never a
required rewrite of the deterministic path, so simulated-mode testing
keeps working unchanged.

## 7. Heavier background infrastructure for very long-running LIVE multi-agent operations?

Superseded in part by the Durable Runner decision (§9 of
[03-system-architecture.md](./03-system-architecture.md)) — a lightweight
local poll loop now exists starting in Phase 5, so this is no longer
"should any background execution exist at all" (resolved: yes, locally,
zero infra). What remains genuinely open: if a real Claude-backed run
(Phase 7+) turns out to need wall-clock time far beyond the per-attempt
timeout default (§9.6 of that document — e.g. a single agent step that
legitimately needs tens of minutes), whether to raise that timeout, add
a checkpoint/resume mechanism within a single task, or introduce a
heavier worker specifically for long operations. [03](./03-system-architecture.md)
§9.8 already sketches the evolution path (swap the trigger, keep the
claim/execute/lease logic) if this is ever needed — revisit with real
Phase 7/8 usage data, not speculatively now.

## 8. MFA and stronger auth timeline

[08-security-plan.md](./08-security-plan.md) §11 recommends TOTP-based
MFA "before any public exposure" but doesn't fix a phase for adding it —
tied to the (also open, see §10 of that plan and Phase 10 here) decision
of *whether and when* to deploy beyond localhost at all.

## 9. Per-role budget sub-allocation

[09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md) §9
explicitly scopes this out of the initial design as unnecessary
complexity, flagged only as a possible future refinement if real usage
data shows a need. No decision needed now; revisit only if Phase 8/9
usage data suggests one role dominates spend in a way the owner wants
visibility or a cap on specifically.

## 10. Exact wording/visual identity for the public ownership disclosure

The product spec and UI/UX spec both require a disclosure statement
("this is a privately operated workspace belonging to Raviteja
Vemulapelli") but don't fix its exact copy or visual treatment — left to
the Phase 1 implementer's judgment, consistent with the existing site's
voice (see `README.md`'s "Author" section for tone reference), not
prescribed here.
