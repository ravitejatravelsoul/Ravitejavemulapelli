# 01 — Product Spec

## 1. Vision

Raviteja types (or pastes) an application idea — one sentence is enough —
into Teja's AI Office. A coordinated team of specialized AI agents takes
it from idea to a reviewed, tested, documented project ready for his
approval, without him having to manage every step. He stays the single
point of judgment for anything risky, costly, or irreversible; the agents
handle the repetitive research/plan/build/test/review loop.

## 2. Primary user

One user: Raviteja Vemulapelli, the owner. There is no second role, no
team, no client-facing account. Every feature in this spec is designed
for an audience of one.

## 3. Core user journeys

### 3.1 Public visitor (unauthenticated)

1. Lands on the portfolio, discovers a "Teja's AI Office" nav entry or
   homepage section.
2. Visits `/ai-office` — a visually striking, read-only preview: what it
   is, the agent roles, high-level capabilities, high-level architecture,
   and an explicit statement that this is a privately operated workspace
   belonging to Raviteja Vemulapelli.
3. Clicks "Enter AI Office" → routed to `/office`, which (unauthenticated)
   redirects to `/office/login` — a restricted, clearly-owner-only login
   screen. No sign-up flow exists; there is nothing to sign up for.
4. Sees nothing further. No project data, code, costs, or logs are ever
   reachable without a valid owner session.

### 3.2 Owner, new project

1. Logs in at `/office/login`.
2. From the dashboard, chooses "Start New Project," types an idea
   (e.g. "Build a tool where manual testers capture screenshots and
   automatically generate professional test reports").
3. Submits. A `Project` is created in `DRAFT` status; a `ProjectIdea`
   record captures the raw input.
4. The Orchestrator assesses complexity, decides which agent roles are
   required (not all projects need all roles), and produces a task plan.
5. Tasks execute — simulated or live, depending on the current AI mode —
   with visible status on the project page: current task, agent, and
   activity feed. Execution continues on its own, in the background,
   whether or not Raviteja keeps `/office` open — he can close the tab,
   close the laptop, and check back later to find work has advanced (see
   [03-system-architecture.md](./03-system-architecture.md) §9).
6. QA failures route back to the responsible agent automatically, up to a
   configured retry limit, then escalate to the owner if still failing.
7. Security review and code review gates run before the project can reach
   `READY_FOR_REVIEW`.
8. Raviteja gets a notification (in-app activity feed at minimum;
   real-time delivery mechanism is a later-phase decision, see
   [14-open-questions.md](./14-open-questions.md)) that the project is
   ready.
9. He reviews artifacts, decisions, and test results, then approves,
   requests changes, or archives the project.

### 3.3 Owner, office control

- **Open/Close Office**: a single global switch. Closed = no new agent
  runs start, no scheduled AI work fires, project data stays intact,
  reopening resumes from saved state.
- **Pause/Resume Project**: same idea, scoped to one project instead of
  the whole Office.
- **Budget controls**: view current spend vs. monthly cap, per-project
  caps, adjust warning thresholds, raise/lower the hard limit (raising it
  is itself an approval-gated action — see
  [08-security-plan.md](./08-security-plan.md)).

## 4. Feature list

### 4.1 Public (`/ai-office`)

- Hero explaining the concept in plain language.
- Agent roles gallery (name, one-line responsibility, icon/visual).
- High-level capability list (idea → plan → build → test → review →
  approval).
- High-level architecture diagram (conceptual, not implementation detail
  — no file paths, no stack internals beyond "Next.js app," no cost
  figures).
- Ownership disclosure statement (required by the brief, verbatim intent:
  this is a privately operated workspace belonging to Raviteja
  Vemulapelli; not a product, not for public use).
- "Enter AI Office" call to action.

### 4.2 Private (`/office/**`, owner-only)

- **Dashboard**: office status, budget summary, active/paused/completed
  project counts, agent status board, live activity feed, pending
  approvals, failed tasks needing attention, recent decisions,
  notifications, "Start New Project" entry point.
- **Project detail**: idea, requirements, architecture decisions, task
  board (by agent/status), artifacts, test results, approval history,
  pause/resume controls.
- **Agent workstations view**: each role's current task (if any), recent
  runs, retry/escalation state — the "office/department" visual metaphor
  from [07-ui-ux-spec.md](./07-ui-ux-spec.md).
- **Approvals**: queue of items awaiting owner decision, each with enough
  context to decide without leaving the page.
- **Budget & settings**: monthly cap, per-project caps, warning
  thresholds, AI provider/mode (simulated vs. live) selection, office
  open/close.
- **Audit log**: chronological, filterable record of every
  security-relevant or budget-relevant action.

## 5. Explicitly out of scope for the product itself

- No public project browsing, even read-only — public sees concept only.
- No team/multi-user accounts.
- No autonomous production deploys, purchases, or destructive database
  actions — every one of those requires an explicit owner approval (see
  [08-security-plan.md](./08-security-plan.md) for the full gate list).
- No mobile app — responsive web only (see
  [07-ui-ux-spec.md](./07-ui-ux-spec.md) §5).

## 6. Success criteria for the eventual working system

1. A one-sentence idea can reach `READY_FOR_REVIEW` using **only**
   simulated agents, at $0 cost, exercising the full state machine
   (idea → project → tasks → QA failure → retry → QA pass → security
   review → approval).
2. The same flow works with a live Claude-backed run for at least one
   real mini-project, within budget.
3. Closing the Office provably stops all AI spend (verified in
   [10-testing-strategy.md](./10-testing-strategy.md)).
4. The existing public portfolio has zero regressions at every phase.
