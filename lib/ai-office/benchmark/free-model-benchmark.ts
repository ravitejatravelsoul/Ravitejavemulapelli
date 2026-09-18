import "server-only";
import type { DatabaseSync } from "node:sqlite";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import { runBenchmarkSuite } from "./benchmark-runner.ts";
import { listBenchmarkResults } from "../domain/model-routing.ts";
import { BENCHMARK_SCENARIOS, FREE_MODEL_EXTRA_SCENARIOS, type BenchmarkScenarioId } from "./scenarios.ts";
import type { TaskCapability } from "../agents/free-model-capabilities.ts";
import { setModelBenchmarkScore, getModelRegistryEntry, isProviderEnabled, recordModelHealthCheck } from "../domain/model-registry.ts";
import { createFreeProviderAdapter } from "../providers/free/free-adapter-factory.ts";
import { isFreeModelAllowed, type FreeExternalProviderName } from "../providers/free/free-provider-config.ts";

/** Extend the existing scenario runner for qualified free/local models.
 * Full runs evaluate current results only; explicit focused reruns combine the
 * latest result per scenario. Historical failures remain in benchmark_results.
 * Credentials and provider construction stay server-side in the shared factory.
 */

export interface BenchmarkFreeModelResult {
  ok: boolean;
  modelKey?: string;
  score?: number;
  qualified?: boolean;
  error?: string;
}

/** Runs the full benchmark suite against one free-provider model and updates its `model_registry` row (Phase 8's "a newly added model starts UNQUALIFIED until health + minimum benchmark requirements pass" — `qualified` is only ever set true here, by real evidence). */
export async function benchmarkFreeProviderModel(
  db: DatabaseSync,
  input: { provider: FreeExternalProviderName | "ollama"; modelId: string; scenarioIds?: BenchmarkScenarioId[] },
): Promise<BenchmarkFreeModelResult> {
  const row = getModelRegistryEntry(db, input.provider, input.modelId);
  if (!row?.enabled || !row.freeTier || !isProviderEnabled(db, input.provider) || !isFreeModelAllowed(input.provider, input.modelId)) {
    return { ok: false, error: "Model must be discovered, enabled and verified free before benchmarking." };
  }
  const adapter = createFreeProviderAdapter(input.provider, input.modelId);
  if (!adapter) return { ok: false, error: `Provider "${input.provider}" is not configured (missing API key).` };

  const modelKey = `${input.provider}/${input.modelId}`;
  const currentResults = await runBenchmarkSuite(db, {
    models: [modelKey], scenarioIds: input.scenarioIds ?? [...BENCHMARK_SCENARIOS, ...FREE_MODEL_EXTRA_SCENARIOS].map(s => s.id),
    adapterFactory: () => adapter,
    intervalMs: input.provider === "ollama" ? 0 : 15_000, stopOnRateLimit: true,
  });
  const results = input.scenarioIds ? [...new Map(listBenchmarkResults(db, { model: modelKey }).reverse().map(r => [r.scenarioId, r])).values()] : currentResults;
  const passed = (id: string) => results.some(r => r.scenarioId === id && r.status === "PASS");
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const capabilities: TaskCapability[] = [];
  if (passed("instruction-json")) capabilities.push("STRUCTURED_OUTPUT", "FAST");
  if (passed("product-owner-basic")) capabilities.push("GENERAL");
  if (passed("reasoning-order")) capabilities.push("REASONING");
  if (passed("architect-static-page")) capabilities.push("ARCHITECTURE");
  if (passed("frontend-build") && passed("frontend-bug-fix")) capabilities.push("CODING");
  if (passed("code-review")) capabilities.push("REVIEW");
  if (passed("test-generation") && passed("qa-interpretation")) capabilities.push("TEST_GENERATION");
  if (passed("security-review")) capabilities.push("SECURITY");
  if (passed("research-evidence")) capabilities.push("RESEARCH");
  const qualified = passed("instruction-json") && capabilities.length >= 3;
  const healthy = currentResults.some(r => r.status === "PASS");
  recordModelHealthCheck(db, input.provider, input.modelId, { health: healthy ? "HEALTHY" : "UNAVAILABLE", latencyMs: results.reduce((n,r) => n+r.latencyMs,0)/results.length });
  db.prepare("UPDATE model_registry SET capabilities = ?, structuredOutput = ? WHERE id = ?")
    .run(JSON.stringify(capabilities), passed("instruction-json") ? 1 : 0, row.id);
  if (healthy) db.prepare("UPDATE model_registry SET recentFailureCount = 0, rateLimitedUntil = NULL WHERE id = ?").run(row.id);
  if (currentResults.some(r => /rate-limited/.test(r.details ?? ""))) db.prepare("UPDATE model_registry SET health = 'UNAVAILABLE', rateLimitedUntil = ? WHERE id = ?").run(Date.now() + 60_000, row.id);
  setModelBenchmarkScore(db, input.provider, input.modelId, { score: avgScore, qualified });
  return { ok: true, modelKey, score: avgScore, qualified };
}
