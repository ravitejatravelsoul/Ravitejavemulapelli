import type { Metadata } from "next";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { checkOllamaHealth } from "@/lib/ai-office/providers/ollama/health";
import { listBenchmarkResults, listRecommendedRouting, getAppliedRouting } from "@/lib/ai-office/domain/model-routing";
import { buildComparisonTable } from "@/lib/ai-office/benchmark/comparison-table";
import { BENCHMARK_SCENARIOS } from "@/lib/ai-office/benchmark/scenarios";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { BenchmarkControls } from "@/components/ai-office/benchmark/benchmark-controls";

export const metadata: Metadata = { title: "Local Models" };

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive"> = { PASS: "secondary", PARTIAL: "default", FAIL: "destructive" };

export default async function LocalModelsPage() {
  const db = getAppDatabase();
  const health = await checkOllamaHealth();
  const results = listBenchmarkResults(db);
  const comparison = buildComparisonTable(results);
  const recommendations = listRecommendedRouting(db);
  const applied = getAppliedRouting(db);
  const appliedCapabilities = new Set(applied.map((r) => r.capability));

  return (
    <div className="flex flex-col gap-6">
      <GlassCard>
        <h1 className="text-lg font-semibold tracking-tight">Local Models</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Diagnostic benchmarking for locally-installed Ollama models — never affects a real project until you explicitly apply a recommendation.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant={health.online ? "secondary" : "destructive"}>{health.online ? "OLLAMA ONLINE" : "OLLAMA OFFLINE"}</Badge>
          {health.models.map((m) => (
            <Badge key={m} variant="outline" className="font-mono text-[0.65rem]">
              {m}
            </Badge>
          ))}
          {health.online && health.models.length === 0 && <span className="text-xs text-muted-foreground">No models installed.</span>}
        </div>

        <div className="mt-4">
          <BenchmarkControls hasResults={results.length > 0} />
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Comparison</h2>
        <p className="mt-1 text-xs text-muted-foreground">Most recent result per scenario. Only actual stored runs are shown — never a fabricated result.</p>
        {comparison.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No benchmark results yet — click &ldquo;Run Benchmark&rdquo; above.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  {BENCHMARK_SCENARIOS.map((s) => (
                    <th key={s.id} className="py-2 px-3 font-medium">
                      {s.title.split("—")[0]?.trim()}
                    </th>
                  ))}
                  <th className="py-2 pl-3 font-medium">Avg Time</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.model} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3 font-mono">{row.model}</td>
                    {BENCHMARK_SCENARIOS.map((s) => {
                      const cell = row.cells[s.id];
                      return (
                        <td key={s.id} className="py-2 px-3">
                          {cell.status ? <Badge variant={STATUS_BADGE[cell.status]}>{cell.status}</Badge> : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                    <td className="py-2 pl-3">{row.avgLatencyMs !== null ? `${(row.avgLatencyMs / 1000).toFixed(1)}s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Recommended Routing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Generated from the comparison above — never applied automatically. A capability with no benchmark evidence has no recommendation.
        </p>
        {recommendations.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No recommendation generated yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {recommendations.map((rec) => (
              <li key={rec.capability} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2 last:border-0">
                <Badge variant="outline" className="font-mono">
                  {rec.capability}
                </Badge>
                <span className="font-mono">{rec.model}</span>
                <span className="text-muted-foreground">{rec.reason}</span>
                <Badge variant={appliedCapabilities.has(rec.capability) ? "secondary" : "outline"}>
                  {appliedCapabilities.has(rec.capability) ? "APPLIED" : "NOT APPLIED"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {results.length > 0 && (
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">Raw Runs</h2>
          <ul className="mt-3 flex flex-col gap-1.5 text-xs">
            {results.slice(0, 40).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-border/30 pb-1.5 last:border-0">
                <span className="text-muted-foreground">{formatDate(r.createdAt)}</span>
                <span className="font-mono">{r.model}</span>
                <span>{r.scenarioId}</span>
                <Badge variant={STATUS_BADGE[r.status]}>{r.status}</Badge>
                <span className="text-muted-foreground">{(r.latencyMs / 1000).toFixed(1)}s</span>
                {r.timedOut === 1 && <Badge variant="destructive">TIMED OUT</Badge>}
                {r.malformedJson === 1 && <Badge variant="destructive">MALFORMED JSON</Badge>}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </div>
  );
}
