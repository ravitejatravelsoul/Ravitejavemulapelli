-- Provider is the STANDARD-mode default only; actual execution is recorded per run.
ALTER TABLE projects ADD COLUMN routingMode TEXT NOT NULL DEFAULT 'STANDARD'
  CHECK (routingMode IN ('STANDARD', 'FREE_MULTI_MODEL'));
UPDATE projects SET routingMode = 'FREE_MULTI_MODEL' WHERE freeModelOrchestration = 1;
