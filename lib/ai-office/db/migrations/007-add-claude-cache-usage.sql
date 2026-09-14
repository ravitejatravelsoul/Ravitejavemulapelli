-- Token economics phase — real Anthropic prompt-cache accounting. Purely
-- additive (same proven-safe ADD COLUMN pattern as migrations 003-006),
-- both nullable: NULL means "not applicable/not reported" (every existing
-- row, and every non-Claude provider's row, forever), distinct from 0
-- ("cache was used for this call but this particular figure was zero") —
-- never guessed, never backfilled, never faked (see
-- lib/ai-office/providers/claude/claude-adapter.ts's cache-usage handling).
ALTER TABLE ai_usage ADD COLUMN cacheCreationInputTokens INTEGER;
ALTER TABLE ai_usage ADD COLUMN cacheReadInputTokens INTEGER;
