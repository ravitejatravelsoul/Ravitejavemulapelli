import { isFreeModelAllowed } from "../free/free-provider-config.ts";
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
 * Zero cost is conditional on explicit free eligibility checked before estimation
 * and every request. Groq/Gemini rely on owner-confirmed free-tier billing.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

export class OpenAICompatibleConnectionError extends Error {}
export class OpenAICompatibleTimeoutError extends Error {}
/** A distinct error type (not folded into ConnectionError) so agent-runner.ts's free-model fallback loop can recognize "this exact model is currently rate-limited" and mark it unavailable for a cooldown window rather than treating it as a generic transient blip worth an in-process retry on the SAME model. */
export class OpenAICompatibleRateLimitError extends Error {
  retryAfterMs: number;
  diagnostics?: ProviderLimitDiagnostics;
  constructor(message: string, retryAfter: string | null = null, diagnostics?: ProviderLimitDiagnostics) {
    super(message);
    this.diagnostics = diagnostics;
    const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
    const dateDelay = retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
      : Number.isFinite(dateDelay) && dateDelay > 0 ? dateDelay : 60_000;
    this.retryAfterMs = Math.max(1000, delay);
  }
}

/** Safe, numeric-only protocol evidence about a provider limit — never message text, prompts, keys or generated content. */
export interface ProviderLimitDiagnostics {
  httpStatus?: number;
  errorCode?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  tokenLimit?: number;
  tokensUsed?: number;
  tokensRequested?: number;
  remainingTokens?: number;
  resetMs?: number;
  maxOutputTokens?: number;
}

/** HTTP 413: this exact request is larger than the provider allows right now. Retrying the identical payload can never succeed, and it says nothing about the model's health — callers must shrink the request or choose another route, not count a model failure. */
export class OpenAICompatibleRequestTooLargeError extends Error {
  diagnostics: ProviderLimitDiagnostics;
  constructor(message: string, diagnostics: ProviderLimitDiagnostics) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

function parseResetMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  let total = 0;
  let matched = false;
  for (const m of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60_000 : n * 3_600_000;
  }
  return matched && Number.isFinite(total) ? Math.round(total) : undefined;
}

function finiteNumber(value: string | null | undefined): number | undefined {
  const n = value === null || value === undefined || value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Numeric protocol evidence from rate-limit headers plus (for errors) the digits of the provider's limit message. */
export function readProviderLimitDiagnostics(response: Response, errorBody?: { error?: { code?: unknown; message?: unknown } }, maxOutputTokens?: number): ProviderLimitDiagnostics {
  const h = response.headers;
  const message = typeof errorBody?.error?.message === "string" ? errorBody.error.message : "";
  const digits = (label: string) => {
    const m = new RegExp(label + String.raw`\s*[:=]?\s*(\d{1,9})`, "i").exec(message);
    return m ? Number(m[1]) : undefined;
  };
  return {
    httpStatus: response.status,
    errorCode: typeof errorBody?.error?.code === "string" ? errorBody.error.code.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) : undefined,
    requestId: safeIdentifier(h?.get("x-request-id")),
    retryAfterSeconds: finiteNumber(h?.get("retry-after")),
    tokenLimit: digits("Limit") ?? finiteNumber(h?.get("x-ratelimit-limit-tokens")),
    tokensUsed: digits("Used"),
    tokensRequested: digits("Requested"),
    remainingTokens: finiteNumber(h?.get("x-ratelimit-remaining-tokens")),
    resetMs: parseResetMs(h?.get("x-ratelimit-reset-tokens")),
    maxOutputTokens,
  };
}

/** Strips at most one surrounding markdown fence — the only wrapper deterministically safe to remove. */
function unfence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return m ? m[1]! : text;
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
  id?: string;
  error?: { code?: string };
  choices?: Array<{ finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : undefined;
}

/** Only final text parts are answer content. Never promote reasoning/tool/refusal parts. */
function finalText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return null;
  if (!content.every(part => part && part.type === "text" && typeof part.text === "string")) return null;
  return content.map(part => part.text).join("");
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

  private assertFreeEligibility(): void {
    if (!isFreeModelAllowed(this.name, this.model)) throw new Error("Route is not explicitly free-eligible; unknown/paid pricing is refused.");
  }

  estimateCost(): CostEstimate {
    this.assertFreeEligibility();
    return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
  }

  async runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    this.assertFreeEligibility();
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
          ...(process.env[`AI_OFFICE_${this.name.toUpperCase()}_REASONING_EFFORT`] ? (this.name === "openrouter"
            ? { reasoning: { effort: process.env.AI_OFFICE_OPENROUTER_REASONING_EFFORT } }
            : { reasoning_effort: process.env[`AI_OFFICE_${this.name.toUpperCase()}_REASONING_EFFORT`] }) : {}),
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
    if (response.status === 429 || !response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as { error?: { code?: unknown; message?: unknown; failed_generation?: unknown } };
      const diagnostics = readProviderLimitDiagnostics(response, errorBody, input.maxOutputTokens);
      if (response.status === 429) {
        throw new OpenAICompatibleRateLimitError(`Operational: ${this.name} rate-limited this request (HTTP 429) for model "${this.model}".`, response.headers?.get("retry-after"), diagnostics);
      }
      const code = diagnostics.errorCode ?? "";
      if (response.status === 413) {
        // Never retry the identical payload and never blame the model: the
        // request itself exceeds what the provider accepts right now.
        const detail = [diagnostics.tokenLimit !== undefined ? `token limit ${diagnostics.tokenLimit}` : "", diagnostics.tokensRequested !== undefined ? `requested ${diagnostics.tokensRequested}` : ""].filter(Boolean).join(", ");
        throw new OpenAICompatibleRequestTooLargeError(
          `Operational: ${this.name} request too large for model "${this.model}" (HTTP 413${code ? `, ${code}` : ""}${detail ? `, ${detail}` : ""}).`,
          diagnostics,
        );
      }
      if (code === "json_validate_failed") {
        // Deterministic, narrow recovery only: the provider's own rejected
        // text is accepted solely if it is strict JSON that passes our full
        // structured-output schema (the same validation any success gets).
        // No repair, no reformatting beyond one markdown fence, no model.
        const failed = errorBody.error?.failed_generation;
        const evidence: Record<string, unknown> = { failedGenerationPresent: typeof failed === "string", failedGenerationLength: typeof failed === "string" ? failed.length : undefined };
        if (typeof failed === "string" && failed.trim()) {
          const recovered = parseStructuredOutput(unfence(failed));
          evidence.strictJsonAndSchemaValid = recovered.ok;
          if (recovered.ok) {
            return {
              status: recovered.output.failure ? "FAILED" : "SUCCEEDED",
              output: recovered.output,
              usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
              raw: { model: this.model, provider: this.name, responseDiagnostics: { ...diagnostics, recoveredFromRejectedGeneration: true, ...evidence } },
            };
          }
        }
        return { ...malformedResult(`Operational: ${this.name} model output did not match the requested JSON schema.`), raw: { malformed: true, responseDiagnostics: { ...diagnostics, ...evidence } } };
      }

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

    const usage = { inputTokens: body?.usage?.prompt_tokens ?? 0, outputTokens: body?.usage?.completion_tokens ?? 0, costUsd: 0 };
    const choice = body?.choices?.[0];
    // Persist only protocol metadata, never prompts, answers, hidden reasoning,
    // provider error messages, authorization headers, or failed_generation.
    const responseDiagnostics = {
      httpStatus: response.status,
      requestId: safeIdentifier(response.headers?.get("x-request-id")),
      responseId: safeIdentifier(body?.id),
      finishReason: safeIdentifier(choice?.finish_reason),
      errorCode: safeIdentifier(body?.error?.code),
      maxOutputTokens: input.maxOutputTokens,
      reasoningTokens: body?.usage?.completion_tokens_details?.reasoning_tokens,
      // Provider token-window headers, only when the provider sent them.
      ...Object.fromEntries(Object.entries({
        tokenLimit: finiteNumber(response.headers?.get("x-ratelimit-limit-tokens")),
        remainingTokens: finiteNumber(response.headers?.get("x-ratelimit-remaining-tokens")),
        resetMs: parseResetMs(response.headers?.get("x-ratelimit-reset-tokens")),
      }).filter(([, v]) => v !== undefined)),
    };
    const fail = (reason: string): AgentTaskResult => ({
      ...malformedResult(`Operational: ${this.name} ${reason}`), usage,
      raw: { malformed: true, responseDiagnostics },
    });
    if (body?.error) return fail("response included a provider error.");
    if (choice?.finish_reason === "length") return fail("model output was truncated at the output token limit.");
    if (choice?.finish_reason && choice.finish_reason !== "stop") return fail("response did not finish with a complete answer.");
    if (choice?.message?.refusal) return fail("response refused the requested output.");
    const content = finalText(choice?.message?.content);
    if (!content?.trim()) return fail("response included no message.");
    const parsed = parseStructuredOutput(content);
    if (!parsed.ok) return fail(`model output ${parsed.reason}`);

    return {
      status: parsed.output.failure ? "FAILED" : "SUCCEEDED",
      output: parsed.output,
      usage,
      raw: { model: this.model, provider: this.name, responseDiagnostics },
    };
    } finally {
      clearTimeout(timer);
    }
  }
}
