# Teja's AI Office — Master Plan

Status: **Planning only. Nothing in this package has been implemented.**
Branch: `feature/teja-ai-office` (created from a clean `master`; pushed
to `origin` — planning commit `2e837f2f1ebaede28565fcd7ca69bdb189f5d75c`
— not merged into `master`).

## 1. What this is

Teja's AI Office is a private, owner-only autonomous software-development
workspace added to this portfolio repository. Raviteja submits a one-line
(or longer) application idea; a set of specialized AI agents — coordinated
by an Orchestrator — research, plan, architect, build, test, review, and
package the project for his final approval. The public portfolio gets a
small, impressive preview page that explains the concept without exposing
anything operational.

This is a **personal, single-user system**, not a SaaS product. Every
design decision in this package optimizes for that: minimal auth
complexity, local SQLite, a $30/month cost ceiling, and no infrastructure
beyond what already runs on `localhost` today.

## 2. Non-negotiable constraints (from the brief)

- Planning only in this task — no application code, no dependency
  installs, no deploys, no package file changes.
- The current portfolio must keep working exactly as it does today,
  throughout every phase.
- Local-first: everything must run on `localhost` before any deployment
  is considered. No Vercel-specific design, no required paid services.
- Simulated agents must be fully testable before any paid AI API is wired
  up.
- Public visitors may see *what* the Office is and *that* it exists; they
  may never see private projects, code, agent conversations, credentials,
  costs, logs, or GitHub operations.
- Hard budget ceiling: **$30/month** AI API spend, enforced in software,
  not just documented.
- Provider-agnostic AI abstraction — Claude first, but not hard-wired.

## 3. How to read this package

See [README.md](./README.md) for the recommended reading order and a
one-line description of each document. Short version: read
[01-product-spec.md](./01-product-spec.md) and
[02-current-portfolio-assessment.md](./02-current-portfolio-assessment.md)
first for the "what" and "what exists today," then
[03-system-architecture.md](./03-system-architecture.md) through
[10-testing-strategy.md](./10-testing-strategy.md) for the "how," then
[11-implementation-phases.md](./11-implementation-phases.md) for the
build order.

## 4. Key architectural decisions (summary — see linked docs for detail)

| Decision | Choice | Why | Detail |
|---|---|---|---|
| Where it lives | Same Next.js app, new route segments | No second app, no duplicated design system/build/deploy | [03](./03-system-architecture.md) |
| Public entrance | `/ai-office` (static, public) | Marketing/preview only, no data | [03](./03-system-architecture.md), [07](./07-ui-ux-spec.md) |
| Private workspace | `/office/**` (auth-gated route group) | Clear boundary, one place to guard | [03](./03-system-architecture.md) |
| Auth | Single-owner credential + signed session cookie, `proxy.ts` optimistic check + DAL enforcement | No auth vendor needed for one user; matches Next 16's documented pattern | [08](./08-security-plan.md) |
| Database | SQLite (file-based, local) | Zero-cost, zero-ops, matches "local-first" | [06](./06-data-model.md) |
| Orchestration | Deterministic state machine + rule engine, not an LLM call, for role/complexity decisions in early phases | Keeps Phase 0–6 fully free to test | [05](./05-orchestration-workflow.md) |
| Execution durability | A lightweight local poll loop (the "Durable Runner") claims/executes tasks via an atomic SQLite lease, independent of any open browser session — no Redis, no hosted queue | Work must keep advancing after the owner closes `/office`, survive process restarts, and never duplicate-execute a task — all achievable with SQLite's existing single-writer guarantees | [03](./03-system-architecture.md) §9 |
| AI provider | Adapter interface; Claude adapter first, Simulated adapter always available | Testability + no vendor lock-in | [04](./04-agent-architecture.md) |
| Budget enforcement | Software gate before every LIVE (non-simulated) agent run | "$30/month" must be a real ceiling, not a hope | [09](./09-budget-and-cost-controls.md) |

## 5. What "done" looks like for this planning task

A developer (human or AI) should be able to pick up
[11-implementation-phases.md](./11-implementation-phases.md) and start
Phase 1 without inventing a data model, an auth strategy, a routing
scheme, or an agent contract — those are all decided here. Anything
genuinely undecided is listed in
[14-open-questions.md](./14-open-questions.md), not silently assumed.

## 6. This package is internal planning material

Every document in `docs/ai-office/**`, including this one, is internal —
written at an implementation level of detail the public `/ai-office`
page must never expose (security mechanics, budget enforcement
internals, the data model, retry/escalation logic, operational workflow
internals). See
[08-security-plan.md](./08-security-plan.md) §12 for the full boundary
and the still-open question (tracked in
[14-open-questions.md](./14-open-questions.md) §1) of how this package
is kept out of any future public production branch/artifact without
rewriting git history.

## 7. Non-goals (explicitly out of scope for this whole effort, not just this task)

- Multi-tenant / multi-user support.
- Enterprise RBAC, SSO, or org-level permissions.
- Autonomous production deployments without owner approval.
- Autonomous purchasing of any paid service.
- Replacing the existing portfolio's public content, design system, or
  routes.
- Analytics, i18n, or a visual page-builder (consistent with
  `ADMIN_SPEC.md` §6's existing non-goals for the also-unbuilt admin CMS).
