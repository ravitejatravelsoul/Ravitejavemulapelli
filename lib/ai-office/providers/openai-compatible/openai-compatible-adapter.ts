import "server-only";
import { z } from "zod";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AIProviderAdapter, AgentTaskInput, AgentTaskResult, CostEstimate } from "../types.ts";
import { buildPrompt, malformedResult, parseStructuredOutput, structuredOutputSchema } from "../shared/structured-output-contract.ts";

/**
 * Free multi-model orchestration phase — a single generic adapter for
 * any provider that speaks the OpenAI Chat Completions wire format
 * (`POST {baseUrl}/chat/completions`, Bearer auth, `response_format:
 * {type:"json_object"}` for structured JSON). Both Groq and OpenRouter's
 * free-tier models speak this exact shape, so one class covers both
 * (and any future OpenAI-compatible free provider) purely via
 * constructor options — no orchestration code needs to change to add
 * another one. Reuses the exact same provider-agnostic prompt/parsing
 * contract OllamaAdapter/ClaudeAdapter already use
 * (structured-output-contract.ts), so a free external API gets the
 * identical instructions/response-format contract as every other
 * provider.
 *
 * `usage.costUsd` is always 0 — every provider this adapter is
 * constructed for is a free-tier API; its usage rows must never enter
 * the LIVE budget ledger (see domain/budget.ts's FREE_PROVIDERS
 * exclusion, which this phase extends to include these provider names).
 */

const DEFAULT_TIMEOUT_MS = 60_000;

export class OpenAICompatibleConnectionError extends Error {}
export class OpenAICompatibleTimeoutError extends Error {}
/** A distinct error type (not folded into ConnectionError) so agent-runner.ts's free-model fallback loop can recognize "this exact model is currently rate-limited" and mark it unavailable for a cooldown window rather than treating it as a generic transient blip worth an in-process retry on the SAME model. */
export class OpenAICompatibleRateLimitError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfter: string | null = null) {
    super(message);
    const seconds = Number(retryAfter);
    this.retryAfterMs = retryAfter && Number.isFinite(seconds) ? Math.max(1000, seconds * 1000)
      : Math.max(1000, (retryAfter ? Date.parse(retryAfter) - Date.now() : 60_000) || 60_000);
  }
}

export interface OpenAICompatibleAdapterOptions {
  /** e.g. "groq", "openrouter" — becomes `AIProviderAdapter.name` and the `ai_usage.provider`/`model_registry.provider` value. */
  providerName: string;
  /** e.g. "https://api.groq.com/openai/v1" — no trailing slash. */
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** Test-injection point — same pattern as every other adapter in this codebase. */
  fetchImpl?: typeof fetch;
  /** OpenRouter recommends (not requires) `HTTP-Referer`/`X-Title`; Groq needs none. Omitted for providers that don't use them. */
  extraHeaders?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAICompatibleAdapter implements AIProviderAdapter {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.name = options.providerName;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.extraHeaders = options.extraHeaders ?? {};
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
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify({
          model: this.model,
          ...(process.env[`AI_OFFICE_${this.name.toUpperCase()}_REASONING_EFFORT`] ? { reasoning_effort: process.env[`AI_OFFICE_${this.name.toUpperCase()}_REASONING_EFFORT`] } : {}),
          ...(this.name === "openrouter" ? { provider: { max_price: { prompt: 0, completion: 0 } } } : {}),
          messages: [{ role: "user", content: prompt }],
          response_format: (process.env[`AI_OFFICE_${this.name.toUpperCase()}_JSON_SCHEMA_MODELS`] ?? "").split(",").includes(this.model)
            ? { type: "json_schema", json_schema: { name: "agent_output", strict: false, schema: z.toJSONSchema(structuredOutputSchema) } }
            : { type: "json_object" },
          ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
        }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new OpenAICompatibleTimeoutError(`Operational: ${this.name} request timed out after ${this.timeoutMs}ms (model "${this.model}").`);
      }
      throw new OpenAICompatibleConnectionError(
        `Operational: Could not reach ${this.name} at ${this.baseUrl}: connection failed`,
      );
    }

    // "Operational:" prefix — see failure-classification.ts's
    // isOperationalFailureReason(): a rate-limit or non-2xx HTTP status
    // is a transient/protocol failure, not a semantic content/logic
    // problem, so it must absorb a bounded in-process retry (and, for
    // this adapter specifically, trigger cross-model fallback in
    // agent-runner.ts's free-model execution path) rather than
    // consuming one of the task's real, counted retry attempts.
    if (response.status === 429) {
      throw new OpenAICompatibleRateLimitError(`Operational: ${this.name} rate-limited this request (HTTP 429) for model "${this.model}".`, response.headers?.get("retry-after"));
    }
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const code = String(errorBody?.error?.code ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
      if (code === "json_validate_failed") return malformedResult(`Operational: ${this.name} model output did not match the requested JSON schema.`);

      throw new OpenAICompatibleConnectionError(
        `Operational: ${this.name} responded with HTTP ${response.status} (${code || "request_failed"}) for model "${this.model}".`,
      );
    }

    let body: ChatCompletionResponse;
    try {
      body = (await response.json()) as ChatCompletionResponse;
    } catch {
      return malformedResult(`Operational: ${this.name}'s HTTP response body was not valid JSON.`);
    }

    const usage = { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0, costUsd: 0 };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { ...malformedResult(`Operational: ${this.name} response included no message.`), usage };
    }

    const parsed = parseStructuredOutput(content);
    if (!parsed.ok) {
      return { ...malformedResult(`Operational: ${this.name} model output ${parsed.reason}`), usage };
    }

    return {
      status: parsed.output.failure ? "FAILED" : "SUCCEEDED",
      output: parsed.output,
      usage,
      raw: { model: this.model, provider: this.name },
    };
    } finally {
      clearTimeout(timer);
    }
  }
}
