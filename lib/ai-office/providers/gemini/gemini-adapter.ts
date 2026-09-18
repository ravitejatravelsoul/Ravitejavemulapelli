import "server-only";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AIProviderAdapter, AgentTaskInput, AgentTaskResult, CostEstimate } from "../types.ts";
import { buildPrompt, malformedResult, parseStructuredOutput } from "../shared/structured-output-contract.ts";

/**
 * Free multi-model orchestration phase — Google's Generative Language
 * API (Gemini free tier via https://aistudio.google.com/apikey), a
 * distinct wire format from the OpenAI-compatible providers (request
 * shape is `contents`/`generationConfig`, not `messages`), so it gets
 * its own adapter rather than being squeezed into
 * OpenAICompatibleAdapter. Same contract, same reuse: `buildPrompt`/
 * `parseStructuredOutput`/`malformedResult` from
 * structured-output-contract.ts, identical to every other provider.
 *
 * `usage.costUsd` is always 0 — this adapter is only ever constructed
 * for Gemini's free tier; its usage rows must never enter the LIVE
 * budget ledger (domain/budget.ts's FREE_PROVIDERS exclusion, extended
 * by this phase to include "gemini").
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 60_000;

export class GeminiConnectionError extends Error {}
export class GeminiTimeoutError extends Error {}
export class GeminiRateLimitError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfter: string | null = null) {
    super(message);
    const seconds = Number(retryAfter);
    this.retryAfterMs = retryAfter && Number.isFinite(seconds) ? Math.max(1000, seconds * 1000)
      : Math.max(1000, (retryAfter ? Date.parse(retryAfter) - Date.now() : 60_000) || 60_000);
  }
}

export interface GeminiAdapterOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Test-injection point — same pattern as every other adapter in this codebase. */
  fetchImpl?: typeof fetch;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiAdapter implements AIProviderAdapter {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  estimateCost(): CostEstimate {
    return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
  }

  async runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const prompt = buildPrompt(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
    let response: Response;
    try {
      // Keep the credential in the request header, out of URLs and error messages.
      response = await this.fetchImpl(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
          },
        }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new GeminiTimeoutError(`Operational: gemini request timed out after ${this.timeoutMs}ms (model "${this.model}").`);
      }
      throw new GeminiConnectionError(`Operational: Could not reach Gemini: connection failed`);
    }

    // "Operational:" prefix — see openai-compatible-adapter.ts's identical note.
    if (response.status === 429) {
      throw new GeminiRateLimitError(`Operational: gemini rate-limited this request (HTTP 429) for model "${this.model}".`, response.headers?.get("retry-after"));
    }
    if (!response.ok) {

      throw new GeminiConnectionError(
        `Operational: gemini responded with HTTP ${response.status} for model "${this.model}".`,
      );
    }

    let body: GeminiGenerateContentResponse;
    try {
      body = (await response.json()) as GeminiGenerateContentResponse;
    } catch {
      return malformedResult("Operational: gemini's HTTP response body was not valid JSON.");
    }

    const usage = { inputTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0, costUsd: 0 };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (typeof text !== "string" || text.length === 0) {
      return { ...malformedResult("Operational: gemini response included no content."), usage };
    }

    const parsed = parseStructuredOutput(text);
    if (!parsed.ok) {
      return { ...malformedResult(`Operational: gemini model output ${parsed.reason}`), usage };
    }

    return {
      status: parsed.output.failure ? "FAILED" : "SUCCEEDED",
      output: parsed.output,
      usage,
      raw: { model: this.model, provider: "gemini" },
    };
    } finally {
      clearTimeout(timer);
    }
  }
}
