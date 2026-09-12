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

/**
 * Minimum-quality gate (local multi-model routing follow-up, Part 11) —
 * without this, "highest success rate wins" can recommend a model that
 * simply failed *less badly* than every alternative (a real run
 * recommended gemma4 for CODING despite a measured 0% success rate,
 * purely because qwen3.6 scored even lower). A benchmark recommendation
 * exists to be an honest signal, not a forced pick — below this
 * threshold, the honest answer is "no locally-tested model is good
 * enough yet," not "here's the least-bad option." 50% is a simple,
 * transparent line (per Part J, not meant to be scientifically precise):
 * a model that fails more often than it succeeds has not demonstrated
 * real capability for this work.
 */
export const MIN_QUALIFYING_SUCCESS_RATE = 0.5;

/** Sentinel "model" name for a capability where no tested model met the minimum threshold. Never matches a real installed model name, so LocalModelRouter's own `available.has(...)` check naturally treats an applied recommendation of this value as unusable and falls back to the default chain — no special-casing needed in the router itself. */
export const NO_QUALIFIED_MODEL = "NO QUALIFIED LOCAL MODEL";

function buildUnqualifiedReason(stats: ModelStats[], capability: ModelCapability): string {
  const perModel = [...stats]
    .sort((a, b) => b.successRate - a.successRate)
    .map((s) => `${s.model} produced ${(s.successRate * 100).toFixed(0)}% success across ${s.sampleCount} benchmark run(s)`);
  return `No locally-tested model met the ${(MIN_QUALIFYING_SUCCESS_RATE * 100).toFixed(0)}% minimum success threshold for ${capability.toLowerCase()}: ${perModel.join("; ")}.`;
}

export interface GenerateRecommendedRoutingResult {
  generated: RecommendedRoutingRow[];
  /** Capabilities with zero benchmark evidence at all (e.g. FAST, which has no scenario yet) — never guessed at. */
  skipped: ModelCapability[];
  /** Capabilities that DO have benchmark evidence, but no tested model met MIN_QUALIFYING_SUCCESS_RATE — recommended as NO_QUALIFIED_MODEL rather than the least-bad option. */
  unqualified: ModelCapability[];
}

/** Regenerates a recommendation for every capability that has at least one benchmark result — a capability with zero evidence is skipped honestly rather than guessed at, and a capability where nothing cleared the minimum-quality bar is recommended as NO_QUALIFIED_MODEL rather than the least-bad option. */
export function generateRecommendedRouting(db: DatabaseSync): GenerateRecommendedRoutingResult {
  const generated: RecommendedRoutingRow[] = [];
  const skipped: ModelCapability[] = [];
  const unqualified: ModelCapability[] = [];

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
    if (best.successRate < MIN_QUALIFYING_SUCCESS_RATE) {
      unqualified.push(capability);
      generated.push(upsertRecommendedRouting(db, { capability, model: NO_QUALIFIED_MODEL, reason: buildUnqualifiedReason(stats, capability) }));
      continue;
    }
    const reason = `${(best.successRate * 100).toFixed(0)}% success across ${best.sampleCount} benchmark run(s) for ${capability.toLowerCase()} scenarios (${scenarioIds.join(", ")}), avg latency ${Math.round(best.avgLatencyMs)}ms.`;
    generated.push(upsertRecommendedRouting(db, { capability, model: best.model, reason }));
  }

  return { generated, skipped, unqualified };
}
