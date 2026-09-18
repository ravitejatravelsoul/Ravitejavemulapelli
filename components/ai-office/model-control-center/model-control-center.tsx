"use client";

import { ActionButton } from "@/components/ai-office/action-button";
import { Badge } from "@/components/ui/badge";
import {
  refreshFreeModelCatalogAction,
  setProviderEnabledAction,
  setModelEnabledAction,
  benchmarkFreeModelAction,
} from "@/app/office/actions/model-registry";

/**
 * Free multi-model orchestration phase — the Model Control Center
 * (Phase 9), an extension of the existing "AI Models & Routing" page,
 * not a redesign of it. Every row here reflects real, currently-stored
 * `model_registry`/`provider_configs` state — nothing is fabricated for
 * display.
 */

export interface ProviderStatusView {
  provider: "groq" | "gemini" | "openrouter" | "ollama";
  configured: boolean;
  enabled: boolean;
}

export interface ModelRegistryRowView {
  provider: string;
  modelId: string;
  displayName: string;
  freeTier: boolean;
  enabled: boolean;
  capabilities: string[];
  health: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
  rateLimited: boolean;
  benchmarkScore: number | null;
  qualified: boolean;
  avgLatencyMs: number | null;
  tasksCompleted: number;
  tasksFailed: number;
  lastUsedAt: number | null;
}

export interface RoutingDecisionView {
  id: string;
  roleId: string;
  taskId: string | null;
  projectId: string | null;
  requiredCapability: string;
  selectedProvider: string;
  selectedModel: string;
  selectionReason: string;
  fallbacksUsed: { provider: string; modelId: string }[] | null;
  attempts: number;
  result: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  createdAt: number;
}

const HEALTH_TONE: Record<ModelRegistryRowView["health"], "secondary" | "default" | "destructive" | "outline"> = {
  HEALTHY: "secondary",
  DEGRADED: "default",
  UNAVAILABLE: "destructive",
  UNKNOWN: "outline",
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ProviderStatusRow({ status }: { status: ProviderStatusView }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 px-3 py-2">
      <span className="w-24 font-mono text-xs font-medium uppercase">{status.provider}</span>
      {!status.configured ? (
        <Badge variant="destructive" className="font-mono text-[0.6rem] uppercase">
          Not Configured
        </Badge>
      ) : (
        <>
          <Badge variant={status.enabled ? "secondary" : "outline"} className="font-mono text-[0.6rem] uppercase">
            {status.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <ActionButton action={setProviderEnabledAction.bind(null, status.provider, !status.enabled)} variant="outline" size="sm">
            {status.enabled ? "Disable" : "Enable"}
          </ActionButton>
        </>
      )}
    </div>
  );
}

export function RefreshCatalogButton() {
  return (
    <ActionButton action={refreshFreeModelCatalogAction} variant="default" size="sm" successMessage="Free-model catalog refreshed.">
      Refresh Catalog
    </ActionButton>
  );
}

export function ModelRegistryTable({ rows }: { rows: ModelRegistryRowView[] }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No free models discovered yet — configure a provider&apos;s API key and click &ldquo;Refresh Catalog&rdquo;.</p>;
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/60 text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Provider</th>
            <th className="py-2 px-3 font-medium">Model</th>
            <th className="py-2 px-3 font-medium">Capabilities</th>
            <th className="py-2 px-3 font-medium">Health</th>
            <th className="py-2 px-3 font-medium">Benchmark</th>
            <th className="py-2 px-3 font-medium">Success</th>
            <th className="py-2 px-3 font-medium">Latency</th>
            <th className="py-2 px-3 font-medium">Last used</th>
            <th className="py-2 pl-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const totalRuns = row.tasksCompleted + row.tasksFailed;
            return (
              <tr key={`${row.provider}:${row.modelId}`} className="border-b border-border/40 last:border-0">
                <td className="py-2 pr-3 font-mono uppercase">{row.provider}</td>
                <td className="py-2 px-3 font-mono">
                  {row.modelId}
                  {row.freeTier && (
                    <Badge variant="outline" className="ml-1.5 font-mono text-[0.55rem]">
                      {row.provider === "ollama" ? "LOCAL" : "FREE"}
                    </Badge>
                  )}
                </td>
                <td className="py-2 px-3">
                  <div className="flex flex-wrap gap-1">
                    {row.capabilities.map((c) => (
                      <Badge key={c} variant="outline" className="font-mono text-[0.55rem]">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="py-2 px-3">
                  <Badge variant={HEALTH_TONE[row.health]} className="font-mono text-[0.6rem] uppercase">
                    {row.rateLimited ? "RATE LIMITED" : row.health}
                  </Badge>
                </td>
                <td className="py-2 px-3">
                  {row.benchmarkScore !== null ? (
                    <span className={row.qualified ? "text-accent-2" : "text-destructive"}>
                      {row.benchmarkScore.toFixed(0)}/100 {row.qualified ? "QUALIFIED" : "UNQUALIFIED"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not benchmarked</span>
                  )}
                </td>
                <td className="py-2 px-3">{totalRuns > 0 ? `${Math.round((row.tasksCompleted / totalRuns) * 100)}% (${totalRuns})` : "—"}</td>
                <td className="py-2 px-3">{row.avgLatencyMs !== null ? `${(row.avgLatencyMs / 1000).toFixed(1)}s` : "—"}</td>
                <td className="py-2 px-3 text-muted-foreground">{row.lastUsedAt ? formatDate(row.lastUsedAt) : "Never"}</td>
                <td className="py-2 pl-3">
                  <div className="flex flex-wrap gap-1.5">
                    <ActionButton action={setModelEnabledAction.bind(null, row.provider, row.modelId, !row.enabled)} variant="outline" size="sm">
                      {row.enabled ? "Disable" : "Enable"}
                    </ActionButton>
                    {(
                      <ActionButton
                        action={benchmarkFreeModelAction.bind(null, row.provider, row.modelId)}
                        variant="outline"
                        size="sm"
                        successMessage="Benchmark complete."
                        confirmMessage="Run the full benchmark suite against this model? This makes several real (free-tier) API calls."
                      >
                        Benchmark
                      </ActionButton>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RoutingHistoryTable({ decisions }: { decisions: RoutingDecisionView[] }) {
  if (decisions.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No free-model routing decisions recorded yet.</p>;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2 text-xs">
      {decisions.map((d) => (
        <li key={d.id} className="rounded-lg border border-border/40 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{formatDate(d.createdAt)}</span>
            <Badge variant="outline" className="font-mono">
              {d.roleId}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {d.requiredCapability}
            </Badge>
            <span className="font-mono">
              {d.selectedProvider}/{d.selectedModel}
            </span>
            <Badge variant={d.result === "SUCCEEDED" ? "secondary" : d.result === "ESCALATED" ? "default" : "destructive"} className="font-mono text-[0.6rem] uppercase">
              {d.result}
            </Badge>
            <span className="text-muted-foreground">
              {d.attempts} attempt{d.attempts === 1 ? "" : "s"} · {(d.inputTokens ?? 0) + (d.outputTokens ?? 0)} tokens · ${d.costUsd.toFixed(2)}
            </span>
          </div>
          {d.projectId && <a className="mt-1 block underline" href={`/office/projects/${d.projectId}`}>Task: {d.taskId}</a>}
          <p className="mt-1 text-muted-foreground">{d.selectionReason}</p>
          {d.fallbacksUsed && d.fallbacksUsed.length > 0 && (
            <p className="mt-1 text-destructive">Fell back from: {d.fallbacksUsed.map((f) => `${f.provider}/${f.modelId}`).join(", ")}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
