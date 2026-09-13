-- Security hardening follow-up to migration 008 (external review found the
-- phone DTMF flow incomplete and inbound SMS sender identity unverified).
-- Purely additive: plain ADD COLUMNs with no CHECK constraint on the
-- existing `escalations` table (validated in application code instead,
-- matching migrations 005/006's documented, proven-safe pattern — a CHECK
-- constraint is only ever added to a brand-new table, never bolted onto an
-- existing one, since SQLite would need a create-copy-drop-rename rebuild
-- to widen an existing table's constraints, which fails inside this app's
-- transaction-wrapped migration runner) plus one brand-new table. 001-008
-- are untouched.

-- `callToken`: a separate, opaque, single-use secret embedded in the
-- Twilio <Gather> callback URL for phone DTMF responses (Defect 1) — kept
-- distinct from `responseCode` (the shorter code texted to the owner for
-- SMS replies) because the two travel through very different channels
-- with very different guessability requirements.
ALTER TABLE escalations ADD COLUMN callToken TEXT;
ALTER TABLE escalations ADD COLUMN callTokenUsed INTEGER NOT NULL DEFAULT 0;

-- Per-escalation invalid-attempt counter (Section L anti-brute-force) —
-- once a real, still-open escalation is matched but the request is
-- otherwise rejected (e.g. a mismatched caller/sender), further attempts
-- against that same escalation are bounded.
ALTER TABLE escalations ADD COLUMN responseAttempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_escalations_callToken ON escalations (callToken);

-- Per-sender invalid-attempt log — the throttle that actually prevents
-- brute-forcing a response code/call token by guessing: independent of
-- which (if any) real escalation a guess happened to reference, since
-- most guesses reference none at all. `fromNumber` is the provider-
-- reported sender, kept only as a normalized phone string — never a full
-- webhook payload or provider credential.
CREATE TABLE escalation_response_attempts (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('SMS', 'CALL')),
  fromNumber TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_escalation_response_attempts_from ON escalation_response_attempts (fromNumber, createdAt);
