import "server-only";

/**
 * Free multi-model orchestration phase — server-side-only resolution of
 * which free external providers are configured. API keys are read from
 * environment variables ONLY (never a client-supplied value, never
 * persisted to the database, never returned to any client-visible
 * response) — matching the brief's "API keys must remain server-side."
 * Missing a key means "not configured," never a crash (Phase 10).
 */

export type FreeExternalProviderName = "groq" | "gemini" | "openrouter";

export interface FreeProviderConfig {
  name: FreeExternalProviderName;
  configured: boolean;
  apiKey?: string;
}

export function getGroqConfig(): FreeProviderConfig {
  const apiKey = process.env.GROQ_API_KEY;
  return apiKey ? { name: "groq", configured: true, apiKey } : { name: "groq", configured: false };
}

export function getGeminiConfig(): FreeProviderConfig {
  const apiKey = process.env.GEMINI_API_KEY;
  return apiKey ? { name: "gemini", configured: true, apiKey } : { name: "gemini", configured: false };
}

export function getOpenRouterConfig(): FreeProviderConfig {
  const apiKey = process.env.OPENROUTER_API_KEY;
  return apiKey ? { name: "openrouter", configured: true, apiKey } : { name: "openrouter", configured: false };
}

export function getFreeProviderConfig(name: FreeExternalProviderName): FreeProviderConfig {
  if (name === "groq") return getGroqConfig();
  if (name === "gemini") return getGeminiConfig();
  return getOpenRouterConfig();
}

/** Every free external provider this office knows about, configured or not — drives the Model Control Center's "NOT CONFIGURED" rows (Phase 10). */
export function listAllFreeProviderConfigs(): FreeProviderConfig[] {
  return [getGroqConfig(), getGeminiConfig(), getOpenRouterConfig()];
}

export function listConfiguredFreeProviders(): FreeProviderConfig[] {
  return listAllFreeProviderConfigs().filter((p) => p.configured);
}

/** Groq/Gemini discovery cannot attest billing. The owner must confirm a free account
 * and configure eligible chat-model IDs; an API key alone never authorizes inference. */
export type FreeEligibility = "LOCAL_FREE" | "PROVIDER_FREE_ROUTE" | "OWNER_CONFIRMED_FREE_TIER";

export function getFreeEligibility(provider: string, modelId: string): FreeEligibility | null {
  if (provider === "ollama") return "LOCAL_FREE";
  if (provider === "openrouter") return modelId.endsWith(":free") || modelId === "openrouter/free" ? "PROVIDER_FREE_ROUTE" : null;
  if (provider !== "groq" && provider !== "gemini") return null;
  const prefix = provider.toUpperCase();
  return process.env[`AI_OFFICE_${prefix}_FREE_TIER_CONFIRMED`] === "true"
    && (process.env[`AI_OFFICE_${prefix}_FREE_MODELS`] ?? "").split(",").map(s => s.trim()).includes(modelId) ? "OWNER_CONFIRMED_FREE_TIER" : null;
}

export function isFreeModelAllowed(provider: string, modelId: string): boolean {
  return getFreeEligibility(provider, modelId) !== null;
}
