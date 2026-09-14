-- Phase 6: exact-scope approval enforcement + budget reservation/concurrency
-- safety. 001-init.sql is immutable; this migration only adds nullable
-- columns and one new table, so every Phase 1-5 row remains valid as-is —
-- no backfill needed, no existing data touched.

-- `taskId` lets an approval scope itself to exactly one task (rather than
-- the whole project) — see lib/ai-office/runner/eligibility.ts's
-- approval-blocking join and docs/ai-office/11-implementation-phases.md's
-- Phase 6 status note ("exact-scope enforcement"). NULL means
-- project-wide, matching the existing Phase 5 idea-level approval
-- behavior unchanged.
-- `decidedBy` / `decisionNote` record who decided a PENDING approval and
-- why — both nullable since every pre-existing approval row was decided
-- (or is still pending) with neither piece of information.
ALTER TABLE approvals ADD COLUMN taskId TEXT REFERENCES tasks (id);
ALTER TABLE approvals ADD COLUMN decidedBy TEXT REFERENCES users (id);
ALTER TABLE approvals ADD COLUMN decisionNote TEXT;
CREATE INDEX idx_approvals_taskId ON approvals (taskId);

-- Budget reservations — the concurrency-safety mechanism for future LIVE
-- provider calls (docs/ai-office/09-budget-and-cost-controls.md §5,
-- implemented for real in Phase 6's BudgetService). A reservation is
-- created atomically with its authorization check, before any provider
-- call happens, so two concurrent authorizations can never both succeed
-- against the same stale "amount already spent" snapshot. `projectId`
-- NULL is never used today (every reservation is for a specific
-- project's task) but is left nullable to mirror `ai_usage.projectId`'s
-- NOT NULL choice deliberately loosened here in case a future
-- office-level-only charge (with no single owning project) ever needs
-- one — safer to allow NULL now than to migrate again later for that.
CREATE TABLE budget_reservations (
  id TEXT PRIMARY KEY,
  projectId TEXT REFERENCES projects (id),
  provider TEXT NOT NULL,
  estimatedCostUsd REAL NOT NULL,
  actualCostUsd REAL,
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'RECONCILED', 'RELEASED')),
  periodStart INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_budget_reservations_periodStart ON budget_reservations (periodStart);
CREATE INDEX idx_budget_reservations_status ON budget_reservations (status);
CREATE INDEX idx_budget_reservations_projectId ON budget_reservations (projectId);
