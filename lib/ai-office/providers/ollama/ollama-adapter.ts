import "server-only";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AIProviderAdapter, AgentTaskInput, AgentTaskResult, CostEstimate } from "../types.ts";
import { buildPrompt, malformedResult, parseStructuredOutput } from "../shared/structured-output-contract.ts";

/**
 * The local, free provider — a real LLM via a locally-running Ollama
 * server, for testing the actual agent pipeline without spending Claude
 * API money. Implements the same `AIProviderAdapter` interface as
 * `SimulatedAdapter`; nothing outside this module ever makes an HTTP call
 * to Ollama (docs/ai-office/04-agent-architecture.md §4's "adding a
 * provider never touches AgentRunner" still holds).
 *
 * `usage.costUsd` is always 0 — Ollama is local inference, never LIVE
 * spend, and this adapter's usage rows must never enter the LIVE budget
 * ledger (see lib/ai-office/domain/budget.ts's FREE_PROVIDERS exclusion).
 *
 * No shell/exec of any kind happens here or as a result of a model's
 * output — this adapter only does an HTTP POST and JSON parsing; the
 * model produces structured *data*, and existing agent/runner code (this
 * file's only caller) decides what to do with it, identically to how it
 * already treats SimulatedAdapter's fixture output.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "gemma4:latest";
const DEFAULT_TIMEOUT_MS = 120_000;

export class OllamaConnectionError extends Error {}
export class OllamaTimeoutError extends Error {}

export interface OllamaAdapterOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  /** Test-injection point — same pattern as agent-runner.ts's `options.provider`. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class OllamaAdapter implements AIProviderAdapter {
  readonly name = "ollama";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.OLLAMA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(input: AgentTaskInput): CostEstimate {
    return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
  }

  async runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const prompt = buildPrompt(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt, stream: false, format: "json" }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OllamaTimeoutError(`Ollama request timed out after ${this.timeoutMs}ms (model "${this.model}" at ${this.baseUrl}).`);
      }
      throw new OllamaConnectionError(
        `Could not reach Ollama at ${this.baseUrl} — is it running? (${error instanceof Error ? error.message : String(error)})`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new OllamaConnectionError(`Ollama responded with HTTP ${response.status} at ${this.baseUrl}.`);
    }

    let body: { response?: string; prompt_eval_count?: number; eval_count?: number };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return malformedResult("Ollama's HTTP response body was not valid JSON.");
    }

    const parsed = parseStructuredOutput(body.response ?? "");
    if (!parsed.ok) {
      return malformedResult(`Ollama's model output ${parsed.reason}`);
    }

    const output = parsed.output;
    return {
      status: output.failure ? "FAILED" : "SUCCEEDED",
      output,
      usage: { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0, costUsd: 0 },
      raw: { model: this.model },
    };
  }
}
