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
}

function parsePositiveNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Reads `ANTHROPIC_INPUT_PRICE_PER_MTOK`/`ANTHROPIC_OUTPUT_PRICE_PER_MTOK` (USD per 1,000,000 tokens) — both must be present and valid, or this returns `null`. Never guesses a default price. */
export function getClaudePricingConfig(): ClaudePricingConfig | null {
  const inputPricePerMillionTokensUsd = parsePositiveNumber(process.env.ANTHROPIC_INPUT_PRICE_PER_MTOK);
  const outputPricePerMillionTokensUsd = parsePositiveNumber(process.env.ANTHROPIC_OUTPUT_PRICE_PER_MTOK);
  if (inputPricePerMillionTokensUsd === null || outputPricePerMillionTokensUsd === null) return null;
  return { inputPricePerMillionTokensUsd, outputPricePerMillionTokensUsd };
}

export function calculateClaudeCostUsd(pricing: ClaudePricingConfig, inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillionTokensUsd;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillionTokensUsd;
  return inputCost + outputCost;
}
