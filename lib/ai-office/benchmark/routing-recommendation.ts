import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { listBenchmarkResults, upsertRecommendedRouting, type RecommendedRoutingRow } from "../domain/model-routing.ts";
import type { ModelCapability } from "../agents/model-router.ts";
import type { BenchmarkScenarioId } from "./scenarios.ts";

/**
 * Turns raw `benchmark_results` evidence into a per-capability
 * recommendation (local multi-model routing follow-up, Part L) —
 * deterministic configuration derived from stored scores, never
 * self-modifying AI logic. Only ever *upserts a recommendation*; nothing
 * here ever calls `applyRecommendedRouting`, so a fresh benchmark can
 * never silently change what AUTO mode actually uses — only the owner's
 * explicit "Apply Recommended Routing" action does that.
 */

/** Which benchmark scenarios speak to which capability — FAST has no dedicated scenario yet (no role-specific benchmark covers release-agent's summary work), so it's deliberately never auto-recommended; the default chain in model-router.ts still governs it until one exists. */
const CAPABILITY_SCENARIOS: Record<ModelCapability, readonly BenchmarkScenarioId[]> = {
  GENERAL: ["product-owner-basic"],
  REASONING: ["architect-static-page"],
  CODING: ["frontend-build", "frontend-bug-fix"],
  REVIEW: ["code-review", "qa-interpretation"],
  FAST: [],
};

interface ModelStats {
  model: string;
  successRate: number;
  avgLatencyMs: number;
  sampleCount: number;
}

function statsForCapability(db: DatabaseSync, scenarioIds: readonly BenchmarkScenarioId[]): ModelStats[] {
  const byModel = new Map<string, { pass: number; total: number; latencySum: number }>();
  for (const scenarioId of scenarioIds) {
    for (const row of listBenchmarkResults(db, { scenarioId })) {
      const entry = byModel.get(row.model) ?? { pass: 0, total: 0, latencySum: 0 };
      entry.total += 1;
      entry.latencySum += row.latencyMs;
      if (row.status === "PASS") entry.pass += 1;
      byModel.set(row.model, entry);
    }
  }
  return [...byModel.entries()].map(([model, s]) => ({
    model,
    successRate: s.total > 0 ? s.pass / s.total : 0,
    avgLatencyMs: s.total > 0 ? s.latencySum / s.total : Infinity,
    sampleCount: s.total,
  }));
}

/** Highest success rate wins; a tie is broken by lower average latency (Part L's exact tie-break rule for CODING, applied uniformly to every capability for consistency). */
function pickBest(stats: ModelStats[]): ModelStats | undefined {
  return stats.sort((a, b) => (b.successRate !== a.successRate ? b.successRate - a.successRate : a.avgLatencyMs - b.avgLatencyMs))[0];
}

export interface GenerateRecommendedRoutingResult {
  generated: RecommendedRoutingRow[];
  skipped: ModelCapability[];
}

/** Regenerates a recommendation for every capability that has at least one benchmark result — a capability with zero evidence is skipped honestly rather than guessed at. */
export function generateRecommendedRouting(db: DatabaseSync): GenerateRecommendedRoutingResult {
  const generated: RecommendedRoutingRow[] = [];
  const skipped: ModelCapability[] = [];

  for (const capability of Object.keys(CAPABILITY_SCENARIOS) as ModelCapability[]) {
    const scenarioIds = CAPABILITY_SCENARIOS[capability];
    if (scenarioIds.length === 0) {
      skipped.push(capability);
      continue;
    }
    const stats = statsForCapability(db, scenarioIds);
    const best = pickBest(stats);
    if (!best || best.sampleCount === 0) {
      skipped.push(capability);
      continue;
    }
    const reason = `${(best.successRate * 100).toFixed(0)}% success across ${best.sampleCount} benchmark run(s) for ${capability.toLowerCase()} scenarios (${scenarioIds.join(", ")}), avg latency ${Math.round(best.avgLatencyMs)}ms.`;
    generated.push(upsertRecommendedRouting(db, { capability, model: best.model, reason }));
  }

  return { generated, skipped };
}
