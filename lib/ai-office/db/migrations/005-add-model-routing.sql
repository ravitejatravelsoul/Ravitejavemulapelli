-- Local multi-model routing + benchmarking. Purely additive, matching
-- migrations 003/004's proven-safe pattern: plain ADD COLUMNs (no CHECK
-- constraint on any of them — validated in application code instead,
-- exactly like docs/ai-office's earlier discovery that widening an
-- existing CHECK constraint requires SQLite's create-copy-drop-rename
-- table rebuild, which fails inside this app's transaction-wrapped
-- migration runner) plus brand-new tables (a real CHECK constraint on a
-- *new* table is always safe — there's no existing data to migrate).
-- 001-004 are untouched.

-- Which real Ollama model actually produced this run — was previously
-- only ever the single globally-configured default, now the router may
-- pick a different model per role/attempt. Nullable: SimulatedAdapter
-- runs (and any historical row from before this migration) have no
-- model identity, which is honest, not a gap to backfill.
ALTER TABLE agent_runs ADD COLUMN model TEXT;

-- Owner-configurable per-project routing policy. No CHECK constraint on
-- modelPolicyMode (validated as one of AUTO/SINGLE_MODEL/CUSTOM in
-- lib/ai-office/agents/model-router.ts) for the same reason as above.
ALTER TABLE projects ADD COLUMN modelPolicyMode TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE projects ADD COLUMN singleModelOverride TEXT;
ALTER TABLE projects ADD COLUMN customRoleModelMapping TEXT; -- JSON: { [roleId]: modelName }

-- One row per (model, benchmark scenario) run — kept entirely separate
-- from real project/task/agent_run history so benchmark traffic never
-- pollutes production project statistics, budget views, or the office
-- floor. `status`'s CHECK constraint is safe here precisely because
-- this table is brand new.
CREATE TABLE benchmark_results (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  scenarioId TEXT NOT NULL,
  roleId TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS', 'PARTIAL', 'FAIL')),
  score INTEGER NOT NULL,
  latencyMs INTEGER NOT NULL,
  promptTokens INTEGER,
  outputTokens INTEGER,
  retries INTEGER NOT NULL DEFAULT 0,
  timedOut INTEGER NOT NULL DEFAULT 0,
  malformedJson INTEGER NOT NULL DEFAULT 0,
  intentConsistencyOutcome TEXT,
  fileOperationValid INTEGER,
  qaResult TEXT,
  defectDiagnosed INTEGER,
  matchesRequest INTEGER,
  details TEXT, -- JSON: full raw evidence for this run (summary, reasons, etc.)
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_benchmark_results_model ON benchmark_results (model);
CREATE INDEX idx_benchmark_results_scenarioId ON benchmark_results (scenarioId);

-- The current benchmark-derived recommendation, one row per capability
-- category (GENERAL/REASONING/CODING/REVIEW/FAST) — upserted every time
-- a new recommendation is generated; `appliedAt` is set only when the
-- owner explicitly approves it (Part L's "Apply Recommended Routing" —
-- never applied automatically/silently).
CREATE TABLE recommended_model_routing (
  capability TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  reason TEXT NOT NULL,
  generatedAt INTEGER NOT NULL,
  appliedAt INTEGER
);
