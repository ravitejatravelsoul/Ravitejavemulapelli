-- Office Engineer — the platform's own self-healing maintenance agent
-- (platform-hardening phase, Parts 9-11). A new table, not a new
-- project-scoped role: this agent is never part of a project's own
-- task DAG (agent_roles/tasks), it monitors the platform itself.
--
-- Deliberately minimal: one row per detected incident, its lifecycle
-- (WATCHING -> INVESTIGATING -> REPAIRING -> VERIFYING -> RESOLVED, or
-- -> ESCALATED whenever a repair needs owner judgment/approval/budget
-- this agent must never grant itself), and enough detail to explain
-- what happened without a separate events/audit table — real audit
-- trail entries for anything this agent actually DOES (a real repair
-- action) still go through the existing events/audit_log tables, same
-- as every other actor in this system.
CREATE TABLE office_incidents (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('WATCHING', 'INVESTIGATING', 'REPAIRING', 'VERIFYING', 'ESCALATED', 'RESOLVED')),
  symptom TEXT NOT NULL,
  projectId TEXT REFERENCES projects (id),
  taskId TEXT REFERENCES tasks (id),
  diagnosis TEXT,
  repairAction TEXT,
  repairProvider TEXT,
  repairCostUsd REAL,
  retryResult TEXT,
  detectedAt INTEGER NOT NULL,
  resolvedAt INTEGER,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX idx_office_incidents_status ON office_incidents (status);
