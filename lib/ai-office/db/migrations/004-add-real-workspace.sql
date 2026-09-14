-- Phase 8: real per-project development workspaces. Purely additive —
-- two nullable ADD COLUMNs (same proven-safe pattern as migration 003)
-- plus three brand-new tables. No CHECK constraint is widened, so this
-- never needs the risky create-copy-drop-rename table-rebuild that a
-- naive `projects.aiMode` widening would (see 003's own comment).
--
-- `workspaces.deliveryState` is a new, orthogonal concept from
-- `projects.status` — it answers "does a real, verified deliverable
-- exist," which `projects.status` (workflow completion) cannot express
-- without touching its own CHECK constraint. A project with no row
-- here is a legacy/pure-text project; the UI treats that as
-- NOT_STARTED and never implies a real deliverable exists for it.

ALTER TABLE test_results ADD COLUMN durationMs INTEGER;
ALTER TABLE test_results ADD COLUMN targetUrl TEXT;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL UNIQUE REFERENCES projects (id),
  deliveryState TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (deliveryState IN ('NOT_STARTED', 'BUILDING', 'VERIFYING', 'VERIFIED', 'FAILED')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- One row per file that currently exists in a project's workspace —
-- content lives on disk exactly once (lib/ai-office/workspace/workspace-service.ts
-- is the only thing that reads/writes it); this table only indexes
-- metadata/attribution ("which agent last touched this file") that the
-- filesystem itself has no way to answer.
CREATE TABLE workspace_files (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects (id),
  path TEXT NOT NULL,
  sizeBytes INTEGER NOT NULL,
  lastModifiedByRoleId TEXT REFERENCES agent_roles (id),
  lastModifiedByTaskId TEXT REFERENCES tasks (id),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE (projectId, path)
);
CREATE INDEX idx_workspace_files_projectId ON workspace_files (projectId);

-- A real online/offline signal for the standalone runner process,
-- replacing the dashboard's previous "last activity within 2 minutes"
-- heuristic (lib/ai-office/dashboard/dashboard-data.ts's
-- getRunnerActivityView) with an actual liveness row the runner
-- upserts every poll tick.
CREATE TABLE runner_heartbeats (
  runnerId TEXT PRIMARY KEY,
  startedAt INTEGER NOT NULL,
  lastSeenAt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IDLE', 'WORKING'))
);
