import "server-only";
import type { BenchmarkResultRow, BenchmarkStatus } from "../domain/model-routing.ts";
import { BENCHMARK_SCENARIOS, type BenchmarkScenarioId } from "./scenarios.ts";

/**
 * A pure projection of raw `benchmark_results` rows into the owner-facing
 * comparison table (Part K) — one row per model, one column per scenario
 * (its most recent run), plus an overall average latency. Shows only
 * actual stored runs, never a fabricated/interpolated result — a scenario
 * a model hasn't been benchmarked on yet renders as an empty cell
 * (`status: null`), not a guess.
 */

export interface ComparisonCell {
  status: BenchmarkStatus | null;
  latencyMs: number | null;
  runAt: number | null;
}

export interface ComparisonRow {
  model: string;
  cells: Record<BenchmarkScenarioId, ComparisonCell>;
  avgLatencyMs: number | null;
  lastRunAt: number | null;
}

export function buildComparisonTable(rows: readonly BenchmarkResultRow[]): ComparisonRow[] {
  const byModel = new Map<string, BenchmarkResultRow[]>();
  for (const row of rows) {
    const list = byModel.get(row.model) ?? [];
    list.push(row);
    byModel.set(row.model, list);
  }

  const result: ComparisonRow[] = [];
  for (const [model, modelRows] of byModel) {
    const cells = {} as Record<BenchmarkScenarioId, ComparisonCell>;
    for (const scenario of BENCHMARK_SCENARIOS) {
      const latest = modelRows.filter((r) => r.scenarioId === scenario.id).sort((a, b) => b.createdAt - a.createdAt)[0];
      cells[scenario.id] = latest ? { status: latest.status, latencyMs: latest.latencyMs, runAt: latest.createdAt } : { status: null, latencyMs: null, runAt: null };
    }
    const latencies = modelRows.map((r) => r.latencyMs);
    const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
    const lastRunAt = modelRows.length > 0 ? Math.max(...modelRows.map((r) => r.createdAt)) : null;
    result.push({ model, cells, avgLatencyMs, lastRunAt });
  }
  return result.sort((a, b) => a.model.localeCompare(b.model));
}
