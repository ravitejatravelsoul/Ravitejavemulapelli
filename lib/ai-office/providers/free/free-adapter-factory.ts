import "server-only";
import type { AIProviderAdapter } from "../types.ts";
import { OllamaAdapter } from "../ollama/ollama-adapter.ts";
import { GeminiAdapter } from "../gemini/gemini-adapter.ts";
import { OpenAICompatibleAdapter } from "../openai-compatible/openai-compatible-adapter.ts";
import { getFreeProviderConfig, isFreeModelAllowed } from "./free-provider-config.ts";

/** Shared by the existing task runner and benchmark runner. Adding an
 * OpenAI-compatible provider changes provider configuration here, not orchestration. */
export function createFreeProviderAdapter(provider: string, modelId: string, options: { fetchImpl?: typeof fetch; ollamaFetchImpl?: typeof fetch } = {}): AIProviderAdapter | null {
  if (!isFreeModelAllowed(provider, modelId)) return null;
  if (provider === "ollama") return new OllamaAdapter({ model: modelId, fetchImpl: options.ollamaFetchImpl });
  if (provider !== "groq" && provider !== "gemini" && provider !== "openrouter") return null;
  const config = getFreeProviderConfig(provider);
  if (!config.configured) return null;
  if (provider === "gemini") return new GeminiAdapter({ apiKey: config.apiKey!, model: modelId, fetchImpl: options.fetchImpl });
  const endpoints = { groq: "https://api.groq.com/openai/v1", openrouter: "https://openrouter.ai/api/v1" };
  return new OpenAICompatibleAdapter({ providerName: provider, baseUrl: endpoints[provider], apiKey: config.apiKey!, model: modelId, fetchImpl: options.fetchImpl });
}
