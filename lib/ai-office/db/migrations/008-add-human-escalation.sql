-- Human Escalation phase — purely additive (same ADD-TABLE pattern as
-- migration 004's workspaces/workspace_files). Escalations reference the
-- existing `approvals` table (one source of truth for the actual
-- approve/reject decision — see lib/ai-office/domain/project-outputs.ts);
-- this table only tracks the external-communication attempt around it.
-- No provider credentials, webhook headers, or secrets are ever stored
-- here — only opaque provider-assigned ids (providerMessageId/
-- providerCallId) and a short-lived, single-use response code.
CREATE TABLE owner_notification_policy (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  mode TEXT NOT NULL DEFAULT 'OFF' CHECK (mode IN ('OFF', 'IN_APP', 'SMS', 'CALL_SMS_FALLBACK')),
  quietHoursEnabled INTEGER NOT NULL DEFAULT 0 CHECK (quietHoursEnabled IN (0, 1)),
  quietHoursStart TEXT NOT NULL DEFAULT '22:00',
  quietHoursEnd TEXT NOT NULL DEFAULT '07:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  callWindowStart TEXT NOT NULL DEFAULT '08:00',
  callWindowEnd TEXT NOT NULL DEFAULT '21:00',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE escalations (
  id TEXT PRIMARY KEY,
  projectId TEXT REFERENCES projects (id),
  approvalId TEXT REFERENCES approvals (id),
  agentRole TEXT,
  type TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('INFO', 'ACTION_REQUIRED', 'URGENT')),
  reason TEXT NOT NULL,
  estimatedCostUsd REAL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'CALLING', 'SMS_SENT', 'WAITING_FOR_RESPONSE', 'APPROVED', 'REJECTED', 'EXPIRED', 'FAILED', 'CANCELLED')
  ),
  channelAttempted TEXT, -- JSON string array, e.g. '["CALL","SMS"]'
  responseCode TEXT,
  responseCodeUsed INTEGER NOT NULL DEFAULT 0 CHECK (responseCodeUsed IN (0, 1)),
  expiresAt INTEGER NOT NULL,
  resolvedAt INTEGER,
  resolution TEXT,
  ownerResponse TEXT,
  providerMessageId TEXT,
  providerCallId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_escalations_projectId ON escalations (projectId);
CREATE INDEX idx_escalations_approvalId ON escalations (approvalId);
CREATE INDEX idx_escalations_status ON escalations (status);
CREATE INDEX idx_escalations_responseCode ON escalations (responseCode);
CREATE INDEX idx_escalations_createdAt ON escalations (createdAt);
