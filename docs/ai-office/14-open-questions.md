# 14 — Open Questions

Genuinely undecided items — anything here was deliberately left for
Raviteja (or the Phase implementer, with his sign-off) rather than
silently assumed. Nothing in the rest of this package depends on these
being resolved a particular way; each notes what changes if resolved
differently.

## 1. Should `docs/ai-office/**` be gitignored, like the other private planning docs?

This repo already excludes `ADMIN_SPEC.md`, `CMS_ARCHITECTURE.md`,
`FIREBASE_MIGRATION.md`, `LAUNCH.md`, `MEDIA_GUIDE.md`, `AGENTS.md`, and
`CLAUDE.md` from version control with an explicit "private planning/ops
notes" comment. This new package is arguably the same category — maybe
more so, since it describes a system whose entire premise is privacy.
**Not changed in this task** (a `.gitignore` edit wasn't requested and
felt like a decision worth surfacing rather than making). If yes: add
`/docs/ai-office/` to the existing private-docs block in `.gitignore`.
If no: it stays tracked, e.g. because Raviteja wants it visible as a
portfolio artifact showing planning rigor to recruiters — a legitimate
reason given the audience this repo already writes for (`README.md`
Author/Contact section).

## 2. SQLite driver: `node:sqlite` vs. `better-sqlite3`?

Depends entirely on the developer machine's actual Node version at the
time Phase 3 starts (`node --version`). `node:sqlite` avoids a new
dependency and any native-module build risk; `better-sqlite3` is more
battle-tested and works on any Node 20+ install. Recommendation leans
`node:sqlite` if available, `better-sqlite3` otherwise — but this must be
checked against the real environment, not decided from the README's
stated "Node.js 20+" floor alone. See
[06-data-model.md](./06-data-model.md) §1.

## 3. Test runner choice

Vitest is recommended (fast, TypeScript-native, no config-file sprawl,
pairs naturally with a future component-testing need) but not installed
or committed to in this planning task. See
[10-testing-strategy.md](./10-testing-strategy.md) §1.

## 4. Notification delivery for "project ready for review"

The product spec (§3.2) commits only to an in-app activity feed
notification at minimum. Whether to add anything beyond that — desktop
notification, email, something else — is unresolved. Given "no
unnecessary SaaS dependencies" and local-first, the likely answer is
"in-app only, indefinitely," but this is Raviteja's call, not assumed
here.

## 5. Should Orchestrator role-selection ever become an LLM call itself?

[05-orchestration-workflow.md](./05-orchestration-workflow.md) §1 notes
this as a possible Phase 7+ enhancement (better judgment on ambiguous
ideas) but explicitly does not commit to it — the rule-based table is
sufficient for Phases 4–6 and arguably sufficient indefinitely for a
single-user tool with modest idea volume. If pursued, it must remain
strictly additive (a new option behind the same interface), never a
required rewrite of the deterministic path, so simulated-mode testing
keeps working unchanged.

## 6. Standalone service for long-running LIVE multi-agent runs?

[03-system-architecture.md](./03-system-architecture.md) §8 rejects a
separate app/service for the current design (everything is
request/response driven from the owner's browser). If a genuine
long-running background-worker need emerges once real Claude-backed runs
are in daily use (Phase 7+), this decision should be revisited with real
usage data, not re-litigated speculatively now.

## 7. MFA and stronger auth timeline

[08-security-plan.md](./08-security-plan.md) §11 recommends TOTP-based
MFA "before any public exposure" but doesn't fix a phase for adding it —
tied to the (also open, see §10 of that plan and Phase 10 here) decision
of *whether and when* to deploy beyond localhost at all.

## 8. Per-role budget sub-allocation

[09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md) §9
explicitly scopes this out of the initial design as unnecessary
complexity, flagged only as a possible future refinement if real usage
data shows a need. No decision needed now; revisit only if Phase 8/9
usage data suggests one role dominates spend in a way the owner wants
visibility or a cap on specifically.

## 9. Exact wording/visual identity for the public ownership disclosure

The product spec and UI/UX spec both require a disclosure statement
("this is a privately operated workspace belonging to Raviteja
Vemulapelli") but don't fix its exact copy or visual treatment — left to
the Phase 1 implementer's judgment, consistent with the existing site's
voice (see `README.md`'s "Author" section for tone reference), not
prescribed here.
