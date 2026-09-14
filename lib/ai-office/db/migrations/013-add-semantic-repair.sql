-- Office Engineer — semantic repair / implementation reconciliation.
--
-- A repeated intent-consistency/code-review/QA rejection for the same
-- task is a fundamentally different problem than an operational
-- (transient) failure office-engineer.ts already retries automatically
-- (see runOfficeEngineerCycle) — it needs a real diagnosis and a
-- structured, owner-reviewable repair plan before anything is ever
-- touched, never a blind retry.
--
-- Kept as its own table rather than widening office_incidents: this
-- flow's UI states (PLANNING REPAIR, WAITING FOR APPROVAL, ...) don't
-- fit inside office_incidents.status's existing CHECK constraint
-- (WATCHING/INVESTIGATING/REPAIRING/VERIFYING/ESCALATED/RESOLVED), and
-- SQLite has no in-place way to widen a CHECK constraint short of a full
-- table rebuild — a real, previously-hit risk in this codebase (see the
-- Phase 8 plan's note on the aiMode widening that broke a naive attempt).
-- A `semantic-repair-required` office_incidents row (using its EXISTING
-- statuses) still exists per detected loop, one-to-one with a row here,
-- so every existing incident-listing/health-status reader keeps working
-- unchanged; this table holds the additional structure specific to a
-- semantic repair (classification, the structured plan, cost, result).
CREATE TABLE semantic_repair_plans (
  id TEXT PRIMARY KEY,
  incidentId TEXT NOT NULL REFERENCES office_incidents (id),
  projectId TEXT NOT NULL REFERENCES projects (id),
  taskId TEXT NOT NULL REFERENCES tasks (id),
  roleId TEXT NOT NULL,
  -- Deterministic fingerprint of the failure pattern this plan responds
  -- to (see computeFailureSignature) — lets a repeated failure with the
  -- SAME signature be recognized as "already tried and failed" rather
  -- than spawning an unbounded new repair cycle each time.
  failureSignature TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('IMPLEMENTATION_WRONG', 'ARCHITECTURE_STALE', 'BOTH_INCONSISTENT', 'OWNER_CLARIFICATION_REQUIRED')),
  rootCause TEXT NOT NULL,
  authoritativeContract TEXT NOT NULL,
  affectedFiles TEXT NOT NULL, -- JSON string[]
  requiredChanges TEXT NOT NULL, -- JSON string[]
  mustPreserve TEXT NOT NULL, -- JSON string[]
  verification TEXT NOT NULL, -- JSON string[]
  -- PROPOSED: plan built, not yet reviewed. APPROVED: owner signed off,
  -- eligible to attempt the one bounded repair call. REJECTED: owner
  -- declined. REPAIRING: the one bounded call is in flight. APPLIED: the
  -- repair call succeeded and its fileOperations were written. VERIFIED:
  -- the original task reached DONE off the repaired files. ESCALATED:
  -- terminal failure state (repair call failed, drifted again, ceiling
  -- reached, OWNER_CLARIFICATION_REQUIRED, or a repeat of an
  -- already-ESCALATED signature) — never auto-retried from here.
  status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'REPAIRING', 'APPLIED', 'VERIFIED', 'ESCALATED')),
  estimatedRepairCostUsd REAL,
  actualRepairCostUsd REAL,
  repairProvider TEXT,
  repairResult TEXT,
  -- Set only for classification = ARCHITECTURE_STALE (Section 6): the
  -- real `approvals` row (kind 'major_architecture_replacement', the
  -- existing enum value this reuses rather than adding a new one — see
  -- agent-runner.ts's own CLAUDE_APPROVAL_KIND docblock for why this
  -- codebase prefers reusing an existing kind over widening the enum)
  -- that must be APPROVED before the architecture artifact is ever
  -- rewritten.
  architectureApprovalId TEXT REFERENCES approvals (id),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX idx_semantic_repair_plans_taskId ON semantic_repair_plans (taskId);
CREATE INDEX idx_semantic_repair_plans_incidentId ON semantic_repair_plans (incidentId);
CREATE INDEX idx_semantic_repair_plans_status ON semantic_repair_plans (status);
