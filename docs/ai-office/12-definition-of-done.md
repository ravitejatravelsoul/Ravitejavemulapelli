# 12 — Definition of Done

## 1. Per-project Definition of Done (what the Orchestrator enforces)

This is the authoritative list — if it ever needs to change, update it
here first, then sync
[05-orchestration-workflow.md](./05-orchestration-workflow.md) §5, which
restates it for workflow context.

A project reaches `READY_FOR_REVIEW` only when **all** of:

1. Every task in its plan is `DONE`.
2. The latest QA `TestResult` is `PASS`.
3. The Security Reviewer task is `DONE` with no unresolved
   high-severity finding.
4. The Code Reviewer task is `DONE`.
5. No unresolved blocking `Approval` remains open for the project.

A project reaches `APPROVED` only when, additionally:

6. The owner has explicitly taken the "approve" action from
   `/office/projects/[id]` — never automatic, never inferred from all
   gates passing (gates passing means *ready for review*, not
   *approved*; those are deliberately separate states, per
   [05-orchestration-workflow.md](./05-orchestration-workflow.md) §3).

## 2. Per-phase Definition of Done (implementation phases 1–9)

Every phase in
[11-implementation-phases.md](./11-implementation-phases.md) is done
only when:

1. Its own phase-specific acceptance criteria are met.
2. Its own phase-specific tests are green.
3. `npm run build`, `npm run typecheck`, and `npm run lint` all pass
   repo-wide, with no new warnings attributable to Office code.
4. A manual spot-check of the existing public routes shows no visual or
   functional regression (per
   [10-testing-strategy.md](./10-testing-strategy.md) §2.13).
5. The public site still requires zero environment variables to run.
6. No file outside the "may modify" list in
   [02-current-portfolio-assessment.md](./02-current-portfolio-assessment.md)
   §11 was touched, unless a genuine, documented need arose (and if so,
   that file is added to a note in the phase's own summary, not silently
   changed).
7. Any new dependency added carries the documented
   reason/alternatives/maintenance/security/cost writeup required by the
   dependency policy in [00-master-plan.md](./00-master-plan.md).
8. From Phase 5 onward specifically: the Durable Runner's behavior is
   verified per [10-testing-strategy.md](./10-testing-strategy.md) §2.14
   (lease atomicity, crash recovery, timeout enforcement) — a phase that
   touches dispatch, budget, or provider code is not done on test-suite
   green alone if it hasn't also been checked against that section.

## 3. Definition of Done for the planning package itself (this task)

1. All 15 documents + README exist in `docs/ai-office/`.
2. No contradiction between documents (e.g. the data model matches what
   the architecture doc describes; the phase plan matches the testing
   strategy's layers; the security plan's routes match the architecture
   doc's routes).
3. Every requirement in the original brief is traceable to at least one
   document (cross-checked in
   [00-master-plan.md](./00-master-plan.md) §4 and this document's §1–2).
4. Security and budget controls are designed as enforced code paths
   (§2 of [08-security-plan.md](./08-security-plan.md),
   §2 of [09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md)),
   not deferred to "we'll figure it out later."
5. Simulated-agent mode can run the full brief-required scenario at $0,
   by design, before any Claude integration (Phase 4, ahead of Phase 7).
6. Claude integration (Phase 7) slots into the existing
   `AIProviderAdapter` interface without requiring changes to
   Orchestrator or AgentRunner code — verified by the interface design
   in [04-agent-architecture.md](./04-agent-architecture.md) §4 being
   identical for both adapters.
7. Every table/route/component reused from the existing portfolio is
   named specifically (not "reuse the design system" vaguely) — see
   [07-ui-ux-spec.md](./07-ui-ux-spec.md) §6.
8. Anything genuinely undecided is listed in
   [14-open-questions.md](./14-open-questions.md), not silently assumed
   into an architectural decision elsewhere.
