import type { Metadata } from "next";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { checkOllamaHealth } from "@/lib/ai-office/providers/ollama/health";
import { listBenchmarkResults, listRecommendedRouting, getAppliedRouting } from "@/lib/ai-office/domain/model-routing";
import { buildComparisonTable } from "@/lib/ai-office/benchmark/comparison-table";
import { BENCHMARK_SCENARIOS } from "@/lib/ai-office/benchmark/scenarios";
import { NO_QUALIFIED_MODEL } from "@/lib/ai-office/benchmark/routing-recommendation";
import { MODEL_CAPABILITIES } from "@/lib/ai-office/agents/model-router";
import { isClaudeConfigured, getConfiguredClaudeModel } from "@/lib/ai-office/providers/claude/claude-adapter";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { BenchmarkControls } from "@/components/ai-office/benchmark/benchmark-controls";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";
import { isClaudeEnabledByConfig } from "@/lib/ai-office/providers/claude/claude-adapter";
import { listAllFreeProviderConfigs, getFreeEligibility } from "@/lib/ai-office/providers/free/free-provider-config";
import { listModelRegistryEntries, isProviderEnabled, isCurrentlyRateLimited, listRoutingDecisions } from "@/lib/ai-office/domain/model-registry";
import { remoteClientFromEnv, readOfficeState, hydrateEphemeralDb } from "@/lib/ai-office/remote/remote-state-store";
import { readModelCatalog } from "@/lib/ai-office/remote/model-catalog";
import {
  ProviderStatusRow,
  RefreshCatalogButton,
  ModelRegistryTable,
  RoutingHistoryTable,
  type ProviderStatusView,
  type ModelRegistryRowView,
  type RoutingDecisionView,
} from "@/components/ai-office/model-control-center/model-control-center";

export const metadata: Metadata = { title: "AI Models & Routing" };

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive"> = { PASS: "secondary", PARTIAL: "default", FAIL: "destructive" };

export default async function LocalModelsPage() {
  // Remote Mode (production) has no local Ollama to benchmark, but it
  // DOES support real FREE_MULTI_MODEL execution via a GitHub-hosted
  // model catalog — this used to unconditionally claim "there is nothing
  // to benchmark or route here", which stopped being true the moment
  // real free-model execution started working in Remote Mode. An owner
  // with no code access had no way to tell whether real execution was
  // configured, whether the catalog was stale, or which provider env
  // var was missing — exactly the gap that made the earlier
  // "No eligible qualified free model" / "Remote routing evidence is
  // unavailable" errors undiagnosable from the UI alone.
  if (isRemoteExecutionMode()) {
    return <RemoteModelDiagnostics />;
  }

  const db = getAppDatabase();
  const health = await checkOllamaHealth();
  const results = listBenchmarkResults(db);
  const comparison = buildComparisonTable(results);
  const recommendations = listRecommendedRouting(db);
  const applied = getAppliedRouting(db);
  const appliedCapabilities = new Set(applied.map((r) => r.capability));
  const appliedModelByCapability = new Map(applied.map((r) => [r.capability, r.model]));
  const claudeConfigured = isClaudeConfigured();
  const claudeModel = getConfiguredClaudeModel();
  const claudeEnabled = isClaudeEnabledByConfig();

  // Free multi-model orchestration phase — Model Control Center data.
  const freeProviderConfigs = listAllFreeProviderConfigs();
  const providerStatuses: ProviderStatusView[] = freeProviderConfigs.map((p) => ({
    provider: p.name,
    configured: p.configured,
    enabled: isProviderEnabled(db, p.name),
  }));

  providerStatuses.push({ provider: "ollama", configured: true, enabled: isProviderEnabled(db, "ollama") });

  const registryRows: ModelRegistryRowView[] = listModelRegistryEntries(db).map((r) => ({
    provider: r.provider,
    modelId: r.modelId,
    displayName: r.displayName,
    freeEligibility: r.freeTier ? getFreeEligibility(r.provider, r.modelId) : null,
    enabled: r.enabled === 1,
    capabilities: JSON.parse(r.capabilities) as string[],
    health: r.health,
    rateLimited: isCurrentlyRateLimited(r.rateLimitedUntil),
    benchmarkScore: r.benchmarkScore,
    qualified: r.qualified === 1,
    avgLatencyMs: r.avgLatencyMs,
    tasksCompleted: r.tasksCompleted,
    tasksFailed: r.tasksFailed,
    lastUsedAt: r.lastUsedAt,
  }));

  const routingDecisions: RoutingDecisionView[] = listRoutingDecisions(db, { limit: 30 }).map((d) => ({
    id: d.id,
    roleId: d.roleId,
    taskId: d.taskId, projectId: d.projectId,
    requiredCapability: d.requiredCapability,
    selectedProvider: d.selectedProvider,
    selectedModel: d.selectedModel,
    selectionReason: d.selectionReason,
    fallbacksUsed: d.fallbacksUsed ? (JSON.parse(d.fallbacksUsed) as { provider: string; modelId: string }[]) : null,
    attempts: d.attempts,
    result: d.result,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    costUsd: d.costUsd,
    createdAt: d.createdAt,
  }));

  return (
    <div className="flex flex-col gap-6">
      <GlassCard>
        <h1 className="text-lg font-semibold tracking-tight">AI Models &amp; Routing</h1>
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
        <h2 className="text-sm font-semibold tracking-tight">Claude</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant={claudeConfigured ? "secondary" : "destructive"} className="font-mono text-[0.65rem] uppercase">
            {claudeConfigured ? "Configured" : "Not configured"}
          </Badge>
          <Badge variant={claudeEnabled ? "outline" : "destructive"} className="font-mono text-[0.65rem] uppercase">
            Claude: {claudeEnabled ? "Enabled" : "Disabled"}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{claudeModel}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          No API key is ever shown here, and viewing this page never makes a billable request — this reflects only whether a credential and
          pricing configuration are present on the server.
          {!claudeEnabled && " AI_OFFICE_CLAUDE_ENABLED=false is set — Claude is never selected or called regardless of any project's AI policy."}
        </p>
      </GlassCard>

      <GlassCard>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Free Multi-Model Providers</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Dynamically-discovered free models (Groq/Gemini/OpenRouter/Ollama) — the Orchestrator picks the best available one per task by
              capability, health, and benchmark evidence. Missing a provider&apos;s API key just means it stays &ldquo;Not configured&rdquo;; nothing
              crashes.
            </p>
          </div>
          <RefreshCatalogButton />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {providerStatuses.map((status) => (
            <ProviderStatusRow key={status.provider} status={status} />
          ))}
        </div>
        <ModelRegistryTable rows={registryRows} />
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Free-Model Routing History</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every real routing decision a `freeModelOrchestration` project has made — agent, required capability, selected model, why, and any
          fallback used.
        </p>
        <RoutingHistoryTable decisions={routingDecisions} />
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Routing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          What a HYBRID-policy project would route each capability to, based on real benchmark evidence — LOCAL_ONLY projects always stay
          local regardless; CLAUDE_ONLY projects route to Claude only when it is enabled; free-model projects exclude paid providers.
        </p>
        <ul className="mt-3 flex flex-col gap-1.5 text-xs">
          {MODEL_CAPABILITIES.map((capability) => {
            const appliedModel = appliedModelByCapability.get(capability);
            const requiresClaudePaid = appliedModel === NO_QUALIFIED_MODEL;
            return (
              <li key={capability} className="flex flex-wrap items-center gap-2 border-b border-border/30 pb-1.5 last:border-0">
                <Badge variant="outline" className="w-24 justify-center font-mono">
                  {capability}
                </Badge>
                {requiresClaudePaid ? (
                  claudeConfigured ? (
                    <span className="font-mono">CLAUDE · {claudeModel}</span>
                  ) : (
                    <span className="font-mono text-destructive">CLAUDE REQUIRED · NOT CONFIGURED</span>
                  )
                ) : (
                  <span className="font-mono">LOCAL{appliedModel ? ` · ${appliedModel}` : ""}</span>
                )}
              </li>
            );
          })}
        </ul>
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
            {recommendations.map((rec) => {
              const isUnqualified = rec.model === NO_QUALIFIED_MODEL;
              return (
                <li key={rec.capability} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2 last:border-0">
                  <Badge variant="outline" className="font-mono">
                    {rec.capability}
                  </Badge>
                  <span className={isUnqualified ? "font-mono text-destructive" : "font-mono"}>{rec.model}</span>
                  <span className="text-muted-foreground">{rec.reason}</span>
                  {!isUnqualified && (
                    <Badge variant={appliedCapabilities.has(rec.capability) ? "secondary" : "outline"}>
                      {appliedCapabilities.has(rec.capability) ? "APPLIED" : "NOT APPLIED"}
                    </Badge>
                  )}
                </li>
              );
            })}
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

function ageLabel(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Remote Mode's real-execution health view — reads the SAME GitHub-hosted
 * model catalog `app/office/actions/remote-projects.ts` reads before
 * creating a FREE_MULTI_MODEL project, and reuses the exact same
 * `hydrateEphemeralDb`/`listModelRegistryEntries`/`isProviderEnabled`
 * domain functions and `ModelRegistryTable`/`ProviderStatusRow`
 * components the local page already uses — this is the same data, just
 * sourced from the runtime repo's catalog file instead of a local
 * `office.db`. Never shows a credential value, only presence/absence
 * (matching the existing Claude section's privacy pattern below).
 */
async function RemoteModelDiagnostics() {
  let configError: string | null = null;
  let catalog: Awaited<ReturnType<typeof readModelCatalog>>["catalog"] = null;
  let catalogSha: string | null = null;
  try {
    const remoteConfig = remoteClientFromEnv();
    const [{ state: office }, catalogResult] = await Promise.all([readOfficeState(remoteConfig), readModelCatalog(remoteConfig)]);
    catalog = catalogResult.catalog;
    catalogSha = catalogResult.sha;
    void office;
  } catch (error) {
    configError = error instanceof Error ? error.message : "Remote Mode is not configured.";
  }

  const freeProviderConfigs = listAllFreeProviderConfigs();
  const freeTierConfirmed = (provider: "groq" | "gemini") =>
    process.env[`AI_OFFICE_${provider.toUpperCase()}_FREE_TIER_CONFIRMED`] === "true" && !!process.env[`AI_OFFICE_${provider.toUpperCase()}_FREE_MODELS`];

  let registryRows: ModelRegistryRowView[] = [];
  let providerStatuses: ProviderStatusView[] = [];
  if (catalog) {
    const ephemeralDb = hydrateEphemeralDb({ state: "OPEN", changedAt: null, changedBy: null, reason: null, officeBudget: { capUsd: 30, warnAtPercent: 80 }, updatedAt: new Date(0).toISOString() }, null, catalog);
    registryRows = listModelRegistryEntries(ephemeralDb).map((r) => ({
      provider: r.provider,
      modelId: r.modelId,
      displayName: r.displayName,
      freeEligibility: r.freeTier ? getFreeEligibility(r.provider, r.modelId) : null,
      enabled: r.enabled === 1,
      capabilities: JSON.parse(r.capabilities) as string[],
      health: r.health,
      rateLimited: isCurrentlyRateLimited(r.rateLimitedUntil),
      benchmarkScore: r.benchmarkScore,
      qualified: r.qualified === 1,
      avgLatencyMs: r.avgLatencyMs,
      tasksCompleted: r.tasksCompleted,
      tasksFailed: r.tasksFailed,
      lastUsedAt: r.lastUsedAt,
    }));
    providerStatuses = freeProviderConfigs.map((p) => ({
      provider: p.name,
      configured: p.configured,
      enabled: isProviderEnabled(ephemeralDb, p.name),
    }));
  }

  const qualifiedEnabledCount = registryRows.filter((r) => r.qualified && r.enabled).length;
  const ready = !configError && !!catalog && !catalog.lease && qualifiedEnabledCount > 0;

  return (
    <div className="flex flex-col gap-6">
      <GlassCard>
        <h1 className="text-lg font-semibold tracking-tight">AI Models &amp; Routing — Remote Mode</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Whether a real FREE_MULTI_MODEL project can actually run right now — the exact same checks a new project&apos;s creation makes, so a
          failure there can be diagnosed here first.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant={ready ? "secondary" : "destructive"}>{ready ? "REAL EXECUTION READY" : "REAL EXECUTION NOT READY"}</Badge>
          {configError && <Badge variant="destructive">GITHUB CONNECTION: {configError}</Badge>}
          {!configError && !catalog && <Badge variant="destructive">CATALOG NOT SYNCHRONIZED</Badge>}
          {!configError && catalog?.lease && <Badge variant="default">CATALOG LEASED — WORKER ACTIVE</Badge>}
          {!configError && catalog && !catalog.lease && (
            <Badge variant="outline" className="font-mono text-[0.65rem]">
              revision {catalog.revision} · synced {ageLabel(catalog.updatedAt)}
            </Badge>
          )}
          {!configError && catalog && (
            <Badge variant={qualifiedEnabledCount > 0 ? "secondary" : "destructive"}>{qualifiedEnabledCount} qualified &amp; enabled model(s)</Badge>
          )}
        </div>
        {!ready && (
          <p className="mt-3 text-xs text-muted-foreground">
            {configError
              ? "AI_OFFICE_REMOTE_GITHUB_TOKEN / AI_OFFICE_REMOTE_REPO_OWNER / AI_OFFICE_REMOTE_REPO_NAME must all be set for this deployment to reach the runtime repo at all — this affects every remote project, not just FREE_MULTI_MODEL ones."
              : !catalog
                ? "No model catalog has ever been synchronized to this runtime's default branch. Run scripts/ai-office-remote-sync-models.ts against a database with real, owner-reviewed qualified-model evidence, including the exact AI_OFFICE_<PROVIDER>_FREE_TIER_CONFIRMED / AI_OFFICE_<PROVIDER>_FREE_MODELS values this deployment uses — otherwise the synced catalog's eligibility data won't match what this process checks, and every model will come back disabled."
                : catalog.lease
                  ? "A worker currently holds the catalog lease (reading or writing real routing evidence). This clears on its own once that worker's cycle finishes."
                  : "The catalog exists but no model is both qualified and enabled — check each provider's row below for why (not free-tier-confirmed here, unhealthy, or rate-limited)."}
          </p>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Free Multi-Model Providers</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          &ldquo;Configured&rdquo; means this deployment has the provider&apos;s API key set; &ldquo;enabled&rdquo; reflects the synced catalog&apos;s
          own provider_configs row. No credential value is ever shown here, and viewing this page never makes a billable request.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {providerStatuses.length === 0 && catalog === null && !configError && (
            <p className="text-xs text-muted-foreground">Provider status is read from the synced catalog — nothing to show until one exists.</p>
          )}
          {providerStatuses.map((status) => (
            <ProviderStatusRow key={status.provider} status={status} />
          ))}
        </div>
        <ul className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
          {(["groq", "gemini"] as const).map((p) => (
            <li key={p}>
              <span className="font-mono uppercase">{p}</span>: free-tier confirmation env vars{" "}
              {freeTierConfirmed(p) ? <span className="text-accent-2">present</span> : <span className="text-destructive">missing</span>} on this
              deployment.
            </li>
          ))}
        </ul>
        {registryRows.length > 0 && <ModelRegistryTable rows={registryRows} />}
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Claude</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant={isClaudeEnabledByConfig() ? "outline" : "destructive"} className="font-mono text-[0.65rem] uppercase">
            Claude: {isClaudeEnabledByConfig() ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Remote Mode forces the Claude kill switch regardless of this flag — Claude is never selected or called for any remote project.
        </p>
      </GlassCard>

      {catalogSha && (
        <p className="text-[0.65rem] text-muted-foreground">
          Catalog blob sha <span className="font-mono">{catalogSha.slice(0, 12)}</span>
        </p>
      )}
    </div>
  );
}
