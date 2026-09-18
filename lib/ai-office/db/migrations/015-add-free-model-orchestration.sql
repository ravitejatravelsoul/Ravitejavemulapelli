-- Free multi-model orchestration phase — purely additive, same pattern
-- as every migration before it: one plain ADD COLUMN (default preserves
-- exact current behavior for every existing/new project unless a project
-- explicitly opts in) plus new, independent tables. No existing CHECK
-- constraint is widened.
--
-- `projects.freeModelOrchestration` is orthogonal to `provider` (still
-- 'simulated' | 'ollama', unchanged) and `aiPolicyMode` — it only applies
-- when `provider = 'ollama'` (a "use a real, free, non-simulated engine"
-- project) and, when set, tells agent-runner.ts to route each task
-- through the new capability-based multi-provider free-model router
-- (lib/ai-office/agents/free-model-router.ts) instead of going straight
-- to LocalModelRouter/OllamaAdapter. Default 0 — zero behavior change for
-- every project that existed before this migration, and for any new
-- project that doesn't explicitly opt in.
ALTER TABLE projects ADD COLUMN freeModelOrchestration INTEGER NOT NULL DEFAULT 0;

-- One row per (provider, modelId) the office knows about — seeded/synced
-- by lib/ai-office/providers/free/model-catalog-sync.ts, read by
-- lib/ai-office/agents/free-model-router.ts's deterministic scorer.
-- `capabilities` is a JSON array of TaskCapability strings (see
-- lib/ai-office/agents/free-model-capabilities.ts) — kept as TEXT rather
-- than a join table since it's small, read-heavy, and never queried by
-- individual capability at the SQL level (the scorer reads every enabled
-- row and filters in application code, matching the existing
-- `recommended_model_routing`/`benchmark_results` precedent of storing
-- capability as a plain string, not a foreign key).
CREATE TABLE model_registry (
  id TEXT PRIMARY KEY, -- "<provider>:<modelId>"
  provider TEXT NOT NULL,
  modelId TEXT NOT NULL,
  displayName TEXT NOT NULL,
  freeTier INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  capabilities TEXT NOT NULL,
  contextWindow INTEGER,
  structuredOutput INTEGER NOT NULL DEFAULT 0,
  health TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (health IN ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN')),
  rateLimitedUntil INTEGER,
  recentFailureCount INTEGER NOT NULL DEFAULT 0,
  benchmarkScore REAL,
  avgLatencyMs REAL,
  lastCheckedAt INTEGER,
  lastUsedAt INTEGER,
  tasksCompleted INTEGER NOT NULL DEFAULT 0,
  tasksFailed INTEGER NOT NULL DEFAULT 0,
  qualified INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE (provider, modelId)
);

-- Owner-controllable provider-level enable/disable (Phase 9/10) —
-- separate from `model_registry.enabled` (per-model). A missing row for
-- a provider means "enabled" (the default a fresh provider starts at
-- once configured) — see lib/ai-office/domain/model-registry.ts's
-- `isProviderEnabled`.
CREATE TABLE provider_configs (
  provider TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updatedAt INTEGER NOT NULL
);

-- Full routing-decision audit trail (Phase 6/9) — one row per real
-- free-model routing decision agent-runner.ts makes, independent of
-- `agent_runs` (which already records provider/model per run) so the
-- *why* (candidate scores, fallbacks actually used) survives even though
-- `agent_runs` only stores the final selection.
CREATE TABLE model_routing_decisions (
  id TEXT PRIMARY KEY,
  projectId TEXT REFERENCES projects (id),
  taskId TEXT REFERENCES tasks (id),
  roleId TEXT NOT NULL,
  requiredCapability TEXT NOT NULL,
  candidateModels TEXT NOT NULL, -- JSON array of {provider, modelId, score}
  selectedProvider TEXT NOT NULL,
  selectedModel TEXT NOT NULL,
  selectionReason TEXT NOT NULL,
  fallbacksUsed TEXT, -- JSON array of {provider, modelId, reason}, NULL if none
  attempts INTEGER NOT NULL DEFAULT 1,
  result TEXT NOT NULL CHECK (result IN ('SUCCEEDED', 'FAILED', 'ESCALATED')),
  latencyMs INTEGER,
  inputTokens INTEGER,
  outputTokens INTEGER,
  costUsd REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);

CREATE INDEX idx_model_routing_decisions_project ON model_routing_decisions (projectId, createdAt);
