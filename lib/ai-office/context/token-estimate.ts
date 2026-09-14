import "server-only";

/**
 * The one, single token-estimation heuristic used anywhere a paid-provider
 * cost/context decision is made — token economics phase, Part 6. Previously
 * `ClaudeAdapter.estimateCost()` had its own inline `Math.ceil(prompt.length
 * / 4)`; duplicating that formula in the new Context Budget Manager would
 * have created exactly the "scattered token rules" this phase explicitly
 * forbids. A conservative chars-per-token approximation (English text/code
 * averages ~3.5-4 chars/token) — never exact, but the same conservative
 * estimate is used consistently for both budgeting decisions and the real
 * cost *reservation* ceiling, so the two can never silently disagree.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
