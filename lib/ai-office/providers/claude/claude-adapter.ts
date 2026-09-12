import "server-only";
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, RateLimitError, InternalServerError } from "@anthropic-ai/sdk";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AIProviderAdapter, AgentTaskInput, AgentTaskResult, CostEstimate } from "../types.ts";
import { buildPrompt, malformedResult, parseStructuredOutput } from "../shared/structured-output-contract.ts";
import { getClaudePricingConfig, calculateClaudeCostUsd } from "./pricing.ts";

/**
 * The paid, real-money provider — controlled Claude LIVE pilot. Uses
 * the exact same prompt-building and structured-output contract as
 * OllamaAdapter (`../shared/structured-output-contract.ts`) — Claude
 * never gets a weaker path, and every provider-independent gate
 * downstream (structured-output validation, workspace path safety,
 * the development deliverable contract, workspace-integrity
 * validation, retry-drift protection, real Playwright QA, intent
 * consistency, code review, release readiness) treats its output
 * identically to a local model's.
 *
 * This adapter never touches the filesystem, never runs a shell
 * command, never mutates the database, never decides spending is
 * authorized, and never approves anything itself — agent-runner.ts
 * remains the sole authority for all of that, exactly as it already is
 * for OllamaAdapter. Budget authorization (a real
 * `budget_reservations` row) happens *before* this adapter is ever
 * called, and reconciliation happens *after* — see
 * agent-runner.ts's Claude-routing block.
 *
 * `usage.costUsd` is computed from the API's own returned token counts
 * against the configured pricing (`./pricing.ts`) — never a hardcoded
 * or guessed number, and never silently $0 for a real call.
 */

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_TIMEOUT_MS = 120_000;
/** A generous but bounded ceiling — both the real request parameter and the worst-case figure `estimateCost()` reserves against, per Part 8's "estimate the MAXIMUM allowed/reserved cost" requirement. */
const MAX_OUTPUT_TOKENS = 8192;

/** Strips anything that looks like a real Anthropic API key from a string before it is ever used as a failure reason / persisted anywhere — defense in depth on top of the SDK's own error messages, which do not normally echo the key back. */
function sanitizeErrorText(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");
}

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return sanitizeErrorText(raw);
}

function isTransientError(error: unknown): boolean {
  return (
    error instanceof APIConnectionError ||
    error instanceof APIConnectionTimeoutError ||
    error instanceof RateLimitError ||
    error instanceof InternalServerError
  );
}

/** Whether the server has enough configuration to actually attempt a real Claude call — both the API key AND explicit pricing must be present. Checked by agent-runner.ts *before* ever constructing a ClaudeAdapter, so "not configured" is always a clean, honest failure, never a thrown exception deep inside a task execution. */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && getClaudePricingConfig() !== null;
}

export interface ClaudeAdapterOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  /** Test-injection point — same pattern as OllamaAdapterOptions.fetchImpl. Lets a test double the whole Anthropic client without a real network call or a real API key. */
  client?: Pick<Anthropic, "messages">;
}

export class ClaudeAdapter implements AIProviderAdapter {
  readonly name = "claude";
  readonly model: string;
  private readonly timeoutMs: number;
  private readonly client: Pick<Anthropic, "messages">;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.ANTHROPIC_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ClaudeAdapter constructed with no ANTHROPIC_API_KEY configured — callers must check isClaudeConfigured() first.");
      }
      this.client = new Anthropic({ apiKey });
    }
  }

  estimateCost(input: AgentTaskInput): CostEstimate {
    const pricing = getClaudePricingConfig();
    const prompt = buildPrompt(input);
    // A conservative chars-per-token heuristic (rounded up) — this only
    // ever feeds a budget *reservation* ceiling, never the actual
    // recorded cost, which always comes from the API's own real usage
    // counts once the call completes.
    const estimatedInputTokens = Math.ceil(prompt.length / 4);
    const estimatedOutputTokens = MAX_OUTPUT_TOKENS;
    const estimatedCostUsd = pricing ? calculateClaudeCostUsd(pricing, estimatedInputTokens, estimatedOutputTokens) : 0;
    return { estimatedInputTokens, estimatedOutputTokens, estimatedCostUsd };
  }

  async runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const prompt = buildPrompt(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let message: Awaited<ReturnType<Anthropic["messages"]["create"]>>;
    try {
      message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: prompt }],
        },
        { signal: controller.signal, timeout: this.timeoutMs },
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Operational: Claude request timed out after ${this.timeoutMs}ms (model "${this.model}").`);
      }
      if (isTransientError(error)) {
        throw new Error(`Operational: Claude request failed transiently (${describeError(error)}).`);
      }
      throw new Error(`Claude request failed: ${describeError(error)}.`);
    } finally {
      clearTimeout(timer);
    }

    if (!("content" in message)) {
      return malformedResult("Claude's response had no content.");
    }
    const text = message.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");

    const inputTokens = message.usage.input_tokens ?? 0;
    const outputTokens = message.usage.output_tokens;
    const pricing = getClaudePricingConfig();
    // Reachable only if pricing configuration was removed *after*
    // isClaudeConfigured() was checked but before this call completed —
    // an honest $0 would misrepresent a real paid call, so this fails
    // the task instead of ever silently under-reporting cost.
    if (!pricing) {
      return malformedResult("Claude pricing configuration is missing — cannot safely record real usage cost for this call.");
    }
    const costUsd = calculateClaudeCostUsd(pricing, inputTokens, outputTokens);

    const parsed = parseStructuredOutput(text);
    if (!parsed.ok) {
      // The API call itself already completed and billed real tokens by
      // this point — a malformed/schema-mismatched response is still a
      // real, paid call, never a free one. Overriding malformedResult()'s
      // default zero usage here is what keeps this call's real cost from
      // silently vanishing from the ledger (Part 6's "never silently
      // report $0 for Claude").
      return { ...malformedResult(`Claude's model output ${parsed.reason}`), usage: { inputTokens, outputTokens, costUsd } };
    }

    const output = parsed.output;
    return {
      status: output.failure ? "FAILED" : "SUCCEEDED",
      output,
      usage: { inputTokens, outputTokens, costUsd },
      raw: { model: this.model },
    };
  }
}
