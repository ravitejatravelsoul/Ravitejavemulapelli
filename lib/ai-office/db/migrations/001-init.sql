-- AI Office initial schema. One file, applied once, tracked in
-- schema_migrations (see lib/ai-office/db/migrate.ts). Matches
-- docs/ai-office/06-data-model.md §2 exactly, plus the execution-lease
-- columns from §8 and the project-memory cache from §7.
--
-- Foreign keys use SQLite's default NO ACTION (no CASCADE anywhere) —
-- this is a single-owner tool where rows are archived via a status
-- column, not hard-deleted; an accidental cascade could silently destroy
-- history. Deleting a referenced parent row is expected to fail loudly.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Singleton: exactly one row, id is always the literal 'singleton'. The
-- PRIMARY KEY constraint alone already makes a second insert with the
-- same id fail; the CHECK additionally stops any *other* id ever being
-- used for this table, so "the" row is always trivially findable.
CREATE TABLE office_status (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED')),
  changedAt INTEGER NOT NULL,
  changedBy TEXT REFERENCES users (id),
  reason TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'PLANNING', 'IN_PROGRESS', 'BLOCKED', 'PAUSED', 'READY_FOR_REVIEW', 'APPROVED', 'FAILED', 'ARCHIVED')
  ),
  aiMode TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (aiMode IN ('SIMULATED', 'LIVE')),
  monthlyBudgetCapUsd REAL,
  ownerId TEXT NOT NULL REFERENCES users (id),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_ownerId ON projects (ownerId);

-- One idea per project (the ERD's "started from" is zero-or-one).
CREATE TABLE project_ideas (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL UNIQUE REFERENCES projects (id),
  rawText TEXT NOT NULL,
  submittedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Seeded catalog only (docs/ai-office/04-agent-architecture.md §1) — not
-- created by end users at runtime.
CREATE TABLE agent_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  responsibilities TEXT NOT NULL, -- JSON array
  allowedInputs TEXT NOT NULL, -- JSON array
  allowedOutputs TEXT NOT NULL, -- JSON array
  permittedActions TEXT NOT NULL, -- JSON array
  maxRetries INTEGER NOT NULL DEFAULT 3,
  escalatesTo TEXT NOT NULL CHECK (escalatesTo IN ('orchestrator', 'owner')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects (id),
  roleId TEXT NOT NULL REFERENCES agent_roles (id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'FAILED', 'BLOCKED')
  ),
  attemptCount INTEGER NOT NULL DEFAULT 0,
  -- Durable Runner persistence primitives (Phase 5 uses these; the
  -- runner itself is not implemented in this phase). See
  -- docs/ai-office/06-data-model.md §8.
  leaseOwnerId TEXT,
  leaseExpiresAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_tasks_projectId ON tasks (projectId);
CREATE INDEX idx_tasks_roleId ON tasks (roleId);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_leaseExpiresAt ON tasks (leaseExpiresAt);

CREATE TABLE task_dependencies (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks (id),
  dependsOnTaskId TEXT NOT NULL REFERENCES tasks (id),
  createdAt INTEGER NOT NULL,
  CHECK (taskId != dependsOnTaskId),
  UNIQUE (taskId, dependsOnTaskId)
);
CREATE INDEX idx_task_dependencies_taskId ON task_dependencies (taskId);
CREATE INDEX idx_task_dependencies_dependsOnTaskId ON task_dependencies (dependsOnTaskId);

-- task_attempts <-> agent_runs is a deliberate circular reference (one
-- attempt has at most one run; a run belongs to exactly one attempt).
-- task_attempts.agentRunId starts NULL and is filled in after the
-- corresponding agent_runs row is created — see
-- lib/ai-office/domain/tasks.ts.
CREATE TABLE task_attempts (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks (id),
  attemptNumber INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  agentRunId TEXT REFERENCES agent_runs (id),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE (taskId, attemptNumber)
);
CREATE INDEX idx_task_attempts_taskId ON task_attempts (taskId);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  taskAttemptId TEXT NOT NULL REFERENCES task_attempts (id),
  roleId TEXT NOT NULL REFERENCES agent_roles (id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (
    status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ESCALATED')
  ),
  startedAt INTEGER NOT NULL,
  finishedAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_agent_runs_taskAttemptId ON agent_runs (taskAttemptId);
CREATE INDEX idx_agent_runs_roleId ON agent_runs (roleId);

-- High-volume activity feed. See docs/ai-office/06-data-model.md §4 for
-- why this is a separate table from audit_log.
CREATE TABLE messages_events (
  id TEXT PRIMARY KEY,
  projectId TEXT REFERENCES projects (id),
  type TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  actor TEXT NOT NULL,
  occurredAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_messages_events_projectId ON messages_events (projectId);
CREATE INDEX idx_messages_events_occurredAt ON messages_events (occurredAt);

CREATE TABLE project_decisions (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects (id),
  type TEXT NOT NULL CHECK (type IN ('decision', 'assumption')),
  summary TEXT NOT NULL,
  rationale TEXT,
  madeBy TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_project_decisions_projectId ON project_decisions (projectId);

-- 'research-notes' extends the type list beyond what
-- docs/ai-office/06-data-model.md §2 originally enumerated, to match
-- docs/ai-office/04-agent-architecture.md §1's "Research notes
-- (artifact)" output — a small documented gap between the two planning
-- docs, resolved here rather than left blocking. See the Phase 3 status
-- note in docs/ai-office/11-implementation-phases.md.
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects (id),
  taskId TEXT REFERENCES tasks (id),
  type TEXT NOT NULL CHECK (
    type IN ('requirements', 'architecture', 'ux-spec', 'code', 'test-report', 'security-report', 'review-notes', 'release-summary', 'research-notes')
  ),
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_projectId ON artifacts (projectId);
CREATE INDEX idx_artifacts_taskId ON artifacts (taskId);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  projectId TEXT REFERENCES projects (id),
  kind TEXT NOT NULL CHECK (
    kind IN ('production_deploy', 'paid_service_purchase', 'budget_increase', 'destructive_db_action', 'repository_deletion', 'major_architecture_replacement', 'external_account_creation', 'secrets_access', 'production_credentials', 'irreversible_operation')
  ),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requestedBy TEXT NOT NULL,
  context TEXT NOT NULL, -- JSON
  decidedAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_approvals_projectId ON approvals (projectId);
CREATE INDEX idx_approvals_status ON approvals (status);

-- scopeId uses the literal sentinel 'office' (never NULL) for
-- scope='office' rows specifically so the UNIQUE constraint below can
-- actually prevent duplicates — SQLite treats every NULL as distinct
-- from every other NULL, so a NULL scopeId would not collide with
-- another NULL scopeId the way two 'office' strings do.
CREATE TABLE budget_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('office', 'project')),
  scopeId TEXT NOT NULL,
  periodStart INTEGER NOT NULL,
  capUsd REAL NOT NULL,
  warnAtPercent INTEGER NOT NULL DEFAULT 80,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE (scope, scopeId, periodStart)
);

CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY,
  agentRunId TEXT NOT NULL REFERENCES agent_runs (id),
  projectId TEXT NOT NULL REFERENCES projects (id),
  provider TEXT NOT NULL,
  inputTokens INTEGER NOT NULL DEFAULT 0,
  outputTokens INTEGER NOT NULL DEFAULT 0,
  costUsd REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_ai_usage_agentRunId ON ai_usage (agentRunId);
CREATE INDEX idx_ai_usage_projectId ON ai_usage (projectId);

CREATE TABLE test_results (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects (id),
  taskId TEXT NOT NULL REFERENCES tasks (id),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
  summary TEXT NOT NULL,
  details TEXT, -- JSON, nullable
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_test_results_projectId ON test_results (projectId);
CREATE INDEX idx_test_results_taskId ON test_results (taskId);

CREATE TABLE failures (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects (id),
  taskId TEXT NOT NULL REFERENCES tasks (id),
  agentRunId TEXT REFERENCES agent_runs (id),
  reason TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_failures_projectId ON failures (projectId);
CREATE INDEX idx_failures_taskId ON failures (taskId);
CREATE INDEX idx_failures_resolved ON failures (resolved);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  targetType TEXT,
  targetId TEXT,
  occurredAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_audit_log_occurredAt ON audit_log (occurredAt);

-- Project-memory read-time cache. See docs/ai-office/06-data-model.md §7.
CREATE TABLE project_memory_cache (
  projectId TEXT PRIMARY KEY REFERENCES projects (id),
  summary TEXT NOT NULL DEFAULT '',
  fileMap TEXT, -- JSON, nullable
  knownIssues TEXT NOT NULL DEFAULT '[]', -- JSON array
  lastUpdatedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
