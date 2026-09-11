# Teja's AI Office — Planning Package

**Status: planning only.** Nothing described here has been implemented.
Produced on branch `feature/teja-ai-office` (created from a clean
`master`; not merged, not pushed).

This is the complete implementation specification for Teja's AI Office —
a private, owner-only autonomous AI software-development workspace added
to this portfolio. It was written after a full inspection of the current
repository, so it reflects what actually exists today, not assumptions
about a typical Next.js app.

## Reading order

1. **[00-master-plan.md](./00-master-plan.md)** — start here. Vision,
   constraints, and a summary table of every key architectural decision
   with links to where it's justified in detail.
2. **[01-product-spec.md](./01-product-spec.md)** — what the product
   does, from both the public visitor's and the owner's point of view.
3. **[02-current-portfolio-assessment.md](./02-current-portfolio-assessment.md)**
   — what exists in this repo today (framework, routing, styling, auth,
   data, tests, build/deploy), what AI Office may touch, what must stay
   untouched, and the rollback strategy.
4. **[03-system-architecture.md](./03-system-architecture.md)** — where
   the code lives, component/sequence diagrams, the layered architecture,
   the provider abstraction, local-first deployment shape.
5. **[04-agent-architecture.md](./04-agent-architecture.md)** — the
   agent role catalog, the agent contract (permissions, retries,
   escalation), the AI Provider Interface.
6. **[05-orchestration-workflow.md](./05-orchestration-workflow.md)** —
   how the Orchestrator selects roles and drives the full idea → approval
   state machine, mapped explicitly to the brief's required test
   sequence.
7. **[06-data-model.md](./06-data-model.md)** — every table, the ER
   diagram, the SQLite decision, and the project-memory mechanism.
8. **[07-ui-ux-spec.md](./07-ui-ux-spec.md)** — public preview page,
   login, owner dashboard, component reuse plan, responsive behavior.
9. **[08-security-plan.md](./08-security-plan.md)** — auth, session,
   CSRF/XSS, authorization boundaries, secrets handling, the full owner
   approval gate list, local-vs-deployed differences.
10. **[09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md)**
    — the $30/month enforcement mechanism, cost tracking granularity,
    warnings, hard limits, Office-closed = $0 guarantee.
11. **[10-testing-strategy.md](./10-testing-strategy.md)** — every test
    layer, including the required simulated end-to-end workflow test and
    the regression checklist that protects the existing portfolio.
12. **[11-implementation-phases.md](./11-implementation-phases.md)** —
    Phase 0 through Phase 10, each with objective/scope/prerequisites/
    tasks/files/tests/acceptance criteria/DoD/risks/rollback/effort.
13. **[12-definition-of-done.md](./12-definition-of-done.md)** — the
    single source of truth for "done," at the project, phase, and
    planning-package level.
14. **[13-risk-register.md](./13-risk-register.md)** — every identified
    risk, likelihood, impact, mitigation, and which document owns it.
15. **[14-open-questions.md](./14-open-questions.md)** — everything
    genuinely left for Raviteja to decide, with what changes either way.

## If you're implementing, not just reading

Start at [11-implementation-phases.md](./11-implementation-phases.md)
Phase 1. Every phase names its exact files, its tests, and its Definition
of Done — you shouldn't need to invent an architectural decision that
isn't already made somewhere in this package. If you find yourself
inventing one, check [14-open-questions.md](./14-open-questions.md)
first (it may already be flagged), and if it's genuinely new, add it
there rather than deciding unilaterally in code.

**Before writing any code**, re-read
`node_modules/next/dist/docs/` for the version of Next.js actually
installed at that time (per `AGENTS.md`) — this package was written
against Next.js 16.2.10's documented conventions (`proxy.ts`, not
`middleware.ts`; the Server Actions + `jose` + DAL auth pattern), and
those conventions may have moved again by the time implementation
starts.
