import "server-only";

/**
 * Stub for `BudgetService.authorize()` — docs/ai-office/09-budget-and-cost-controls.md
 * §2 names this the single enforcement point, called by AgentRunner
 * before invoking any non-simulated provider adapter. Phase 6 replaces
 * this function's body with the real cap/warn-threshold logic; the call
 * site in agent-runner.ts does not need to change when that happens —
 * that's the whole point of keeping this boundary in place now instead
 * of inlining a check later.
 *
 * SIMULATED mode always authorizes (nothing to cap — see
 * docs/ai-office/09-budget-and-cost-controls.md §7). LIVE mode has no
 * adapter to run until Phase 7, so it's refused here defensively rather
 * than silently allowed through an unimplemented gate.
 */

export interface BudgetGateResult {
  authorized: boolean;
  reason?: string;
}

export function authorizeBudget(input: { aiMode: "SIMULATED" | "LIVE" }): BudgetGateResult {
  if (input.aiMode === "SIMULATED") {
    return { authorized: true };
  }
  return { authorized: false, reason: "LIVE mode has no provider adapter until Phase 7." };
}
