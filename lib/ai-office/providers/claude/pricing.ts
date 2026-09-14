import "server-only";

/**
 * Centralized Claude pricing configuration (controlled Claude LIVE
 * pilot, Part 6) — the ONLY place a dollar figure is ever computed for
 * a Claude call. Deliberately configuration-driven, never a hardcoded
 * number in this file: Anthropic's per-model pricing changes over time
 * and differs by model, so a number baked into source would silently
 * go stale. If pricing isn't explicitly configured, this returns
 * `null` and the caller must fail safely (never silently report a $0
 * cost for real Claude usage — see claude-adapter.ts).
 */

export interface ClaudePricingConfig {
  inputPricePerMillionTokensUsd: number;
  outputPricePerMillionTokensUsd: number;
  /**
   * Token economics phase, Part 9 — Anthropic prices a cache write higher
   * than a normal input token (the model has to actually process and
   * store it) and a cache read far lower (a cheap lookup). Both optional:
   * if unset, `calculateClaudeCostUsd` conservatively costs cache tokens
   * at the regular input price — never silently free, and never a fake
   * "discount" the owner never actually configured.
   */
  cacheWritePricePerMillionTokensUsd: number | null;
  cacheReadPricePerMillionTokensUsd: number | null;
}

function parsePositiveNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Reads `ANTHROPIC_INPUT_PRICE_PER_MTOK`/`ANTHROPIC_OUTPUT_PRICE_PER_MTOK` (USD per 1,000,000 tokens) — both must be present and valid, or this returns `null`. Never guesses a default price. The two cache prices are independently optional (see `ClaudePricingConfig`'s docblock). */
export function getClaudePricingConfig(): ClaudePricingConfig | null {
  const inputPricePerMillionTokensUsd = parsePositiveNumber(process.env.ANTHROPIC_INPUT_PRICE_PER_MTOK);
  const outputPricePerMillionTokensUsd = parsePositiveNumber(process.env.ANTHROPIC_OUTPUT_PRICE_PER_MTOK);
  if (inputPricePerMillionTokensUsd === null || outputPricePerMillionTokensUsd === null) return null;
  return {
    inputPricePerMillionTokensUsd,
    outputPricePerMillionTokensUsd,
    cacheWritePricePerMillionTokensUsd: parsePositiveNumber(process.env.ANTHROPIC_CACHE_WRITE_PRICE_PER_MTOK),
    cacheReadPricePerMillionTokensUsd: parsePositiveNumber(process.env.ANTHROPIC_CACHE_READ_PRICE_PER_MTOK),
  };
}

export function calculateClaudeCostUsd(
  pricing: ClaudePricingConfig,
  inputTokens: number,
  outputTokens: number,
  cacheTokens: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } = {},
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillionTokensUsd;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillionTokensUsd;
  const cacheWriteRate = pricing.cacheWritePricePerMillionTokensUsd ?? pricing.inputPricePerMillionTokensUsd;
  const cacheReadRate = pricing.cacheReadPricePerMillionTokensUsd ?? pricing.inputPricePerMillionTokensUsd;
  const cacheWriteCost = ((cacheTokens.cacheCreationInputTokens ?? 0) / 1_000_000) * cacheWriteRate;
  const cacheReadCost = ((cacheTokens.cacheReadInputTokens ?? 0) / 1_000_000) * cacheReadRate;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}
