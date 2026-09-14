import "server-only";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AIProviderAdapter, AgentTaskInput, AgentTaskResult, CostEstimate } from "../types.ts";
import { resolveFixture } from "./fixtures.ts";

/**
 * The only provider implementation that exists in Phase 4 — see
 * docs/ai-office/04-agent-architecture.md §4/§7. Deterministic: the
 * exact same `AgentTaskInput` (same role, same `task.scenario`) always
 * produces the exact same result. `estimateCost()` always returns zero,
 * per docs/ai-office/09-budget-and-cost-controls.md §7 — there is
 * nothing to cap in SIMULATED mode.
 */
export class SimulatedAdapter implements AIProviderAdapter {
  readonly name = "simulated";

  async runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const fixture = resolveFixture(input.role, input.task.scenario);
    if (!fixture) {
      throw new Error(
        `No simulated fixture for role "${input.role}" scenario "${input.task.scenario ?? "success"}". ` +
          `Every role must have at least a "success" and "failure" fixture — see lib/ai-office/providers/simulated/fixtures.ts.`,
      );
    }
    return fixture(input);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(input: AgentTaskInput): CostEstimate {
    return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
  }
}
