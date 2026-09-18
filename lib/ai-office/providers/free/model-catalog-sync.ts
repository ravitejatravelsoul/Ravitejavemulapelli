import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { upsertModelRegistryEntry, listModelRegistryEntries, recordModelHealthCheck } from "../../domain/model-registry.ts";
import { getFreeProviderConfig, isFreeModelAllowed, type FreeExternalProviderName } from "./free-provider-config.ts";
import { listInstalledOllamaModelsDetailed } from "../ollama/ollama-inventory.ts";
import type { TaskCapability } from "../../agents/free-model-capabilities.ts";

export interface ModelCatalogSyncResult {
  provider: string; configured: boolean; ok: boolean; modelsFound: number; error?: string;
}
// Discovery provides availability, not capability evidence. Benchmarks qualify models.
export function inferCapabilities(modelId: string): TaskCapability[] { void modelId; return []; }
type Discovered = { id: string; context?: number; structured?: boolean };

export async function syncAllFreeModelCatalogs(db: DatabaseSync, options: { fetchImpl?: typeof fetch } = {}): Promise<ModelCatalogSyncResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const results: ModelCatalogSyncResult[] = [];
  for (const provider of ["groq", "gemini", "openrouter", "ollama"] as const) {
    const config = provider === "ollama" ? null : getFreeProviderConfig(provider);
    if (config && !config.configured) {
      results.push({ provider, configured: false, ok: false, modelsFound: 0 }); continue;
    }
    try {
      let models: Discovered[] = [];
      if (provider === "ollama") {
        models = (await listInstalledOllamaModelsDetailed({ fetchImpl })).map(m => ({ id: m.name, structured: true }));
      } else {
        const urls: Record<FreeExternalProviderName, string> = {
          groq: "https://api.groq.com/openai/v1/models",
          gemini: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
          openrouter: "https://openrouter.ai/api/v1/models",
        };
        let url: string | undefined = urls[provider];
        do {
          const res: Response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: provider === "gemini"
            ? { "x-goog-api-key": config!.apiKey! } : { authorization: `Bearer ${config!.apiKey}` } });
          if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
          const body = await res.json();
          if (provider === "gemini") {
            models.push(...(body.models ?? []).filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
              .map((m: { name: string; inputTokenLimit: number }) => ({ id: m.name.replace(/^models\//, ""), context: m.inputTokenLimit, structured: true })));
            url = body.nextPageToken ? `${urls.gemini}&pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
          } else {
            models = (body.data ?? []).filter((m: { active?: boolean; pricing?: { prompt?: string; completion?: string } }) =>
              m.active !== false && (provider !== "openrouter" || (m.pricing?.prompt === "0" && m.pricing?.completion === "0")))
              .map((m: { id: string; context_window?: number; context_length?: number; supported_parameters?: string[] }) => ({
                id: m.id, context: m.context_window ?? m.context_length,
                structured: provider === "groq" || m.supported_parameters?.includes("response_format"),
              }));
            url = undefined;
          }
        } while (url);
      }
      models = models.filter(m => isFreeModelAllowed(provider, m.id));
      const existing = listModelRegistryEntries(db, { provider });
      for (const m of models) {
        const previous = existing.find(r => r.modelId === m.id);
        upsertModelRegistryEntry(db, { provider, modelId: m.id, displayName: m.id,
          capabilities: previous ? JSON.parse(previous.capabilities) : [],
          contextWindow: m.context ?? previous?.contextWindow, structuredOutput: m.structured, freeTier: true });
        // Listing a model does not prove successful inference. Preserve runtime health.
      }
      for (const row of existing) {
        if (!models.some(m => m.id === row.modelId)) recordModelHealthCheck(db, provider, row.modelId, { health: "UNAVAILABLE" });
      }
      results.push({ provider, configured: true, ok: true, modelsFound: models.length });
    } catch {
      // Never persist SDK/network messages: they can contain credentials or request URLs.
      results.push({ provider, configured: true, ok: false, modelsFound: 0, error: "Catalog unavailable; check credentials and connectivity." });
    }
  }
  return results;
}
