-- Revoke-approval capability — purely additive. No CHECK constraint is
-- widened here: a real, empirical test against this exact migration
-- runner (seeding an `escalations` row with its real foreign key to
-- `approvals.id`, then attempting a create-copy-drop-rename rebuild to
-- add 'REVOKED' to the `approvals.status` CHECK list) failed with
-- "FOREIGN KEY constraint failed" — confirming, not just repeating, the
-- pattern already documented in migrations 005/006/009: widening an
-- existing table's CHECK constraint requires a table rebuild that this
-- transaction-wrapped migration runner cannot safely perform once other
-- tables hold real foreign keys into it. Revocation is instead modeled
-- as the existing 'REJECTED' status (reusing every already-correct
-- terminal/not-authorized code path for free) plus these new columns
-- that distinguish a revocation from an original owner rejection — see
-- lib/ai-office/approvals/approval-service.ts's `getEffectiveApprovalStatus()`,
-- which is what actually renders the literal "REVOKED" label anywhere
-- this is displayed, and agent-runner.ts's `hasRejectedClaudeApproval()`,
-- updated to treat a revoked approval as "not a rejection" so a revoked
-- project correctly gets a fresh PENDING approval next time, rather than
-- being permanently blocked the way a real owner rejection is.
ALTER TABLE approvals ADD COLUMN revokedAt INTEGER;
ALTER TABLE approvals ADD COLUMN revokedBy TEXT;
ALTER TABLE approvals ADD COLUMN revocationNote TEXT;
