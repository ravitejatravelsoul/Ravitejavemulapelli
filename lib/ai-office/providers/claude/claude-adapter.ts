import "server-only";
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, RateLimitError, InternalServerError } from "@anthropic-ai/sdk";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AIProviderAdapter, AgentTaskInput, AgentTaskResult, CostEstimate } from "../types.ts";
import { buildPromptSegments, malformedResult, parseStructuredOutput } from "../shared/structured-output-contract.ts";
import { getClaudePricingConfig, calculateClaudeCostUsd } from "./pricing.ts";
import { estimateTokens } from "../../context/token-estimate.ts";

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
/**
 * Fallback only — reachable when a caller doesn't pass `AgentTaskInput
 * .maxOutputTokens` (every real call from agent-runner.ts does, sourced
 * from the Context Budget Manager's capability-specific ceiling —
 * token-economics phase, Part 7; this used to be one flat number for
 * every role). Kept generous since it's the *worst-case* reservation
 * figure for a caller that skipped the budget manager (e.g. a direct
 * unit test), never the typical real request size.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

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

/**
 * Free multi-model orchestration phase — a global kill-switch,
 * independent of whether credentials are even configured.
 * `AI_OFFICE_CLAUDE_ENABLED=false` disables Claude selection/calls
 * entirely, regardless of a project's `aiPolicyMode` (even
 * `CLAUDE_ONLY`) — `agents/provider-router.ts::routeProvider()` checks
 * this FIRST, before any policy/evidence logic, so a disabled office
 * never even evaluates whether Claude would otherwise have been chosen.
 * Defaults to enabled (`true`) so the existing, already-approved
 * controlled Claude LIVE pilot behavior is completely unaffected unless
 * an owner explicitly opts out — this phase's local free-multi-model
 * testing sets it to `false` in `.env.local` only, never in production.
 */
export function isClaudeEnabledByConfig(): boolean {
  return process.env.AI_OFFICE_CLAUDE_ENABLED !== "false";
}

/** The model name a real Claude call would use right now (`ANTHROPIC_MODEL` or the built-in default) — never a secret, safe to display in the owner UI (Living AI Office UI transformation, Section 25). Does not require a credential to be configured. */
export function getConfiguredClaudeModel(): string {
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
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
    const { systemText, userText } = buildPromptSegments(input);
    // The shared, single token-estimation heuristic (token economics
    // phase, Part 6) — this only ever feeds a budget *reservation*
    // ceiling, never the actual recorded cost, which always comes from
    // the API's own real usage counts once the call completes. Cache
    // tokens are never estimated here (no way to know a cache hit will
    // occur before the call happens) — a worst-case reservation
    // conservatively assumes every input token is billed at the full
    // rate, which is always >= the real cache-discounted cost.
    const estimatedInputTokens = estimateTokens(systemText) + estimateTokens(userText);
    const estimatedOutputTokens = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const estimatedCostUsd = pricing ? calculateClaudeCostUsd(pricing, estimatedInputTokens, estimatedOutputTokens) : 0;
    return { estimatedInputTokens, estimatedOutputTokens, estimatedCostUsd };
  }

  async runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    if (!isClaudeEnabledByConfig()) {
      throw new Error("Claude is disabled by configuration (AI_OFFICE_CLAUDE_ENABLED=false).");
    }
    // Token economics phase, Part 9 — real Anthropic prompt caching via
    // the officially supported mechanism: `system` as a content-block
    // array with a `cache_control` breakpoint on the stable block (role
    // contract + structured-output format + the project's authoritative
    // request, all of which repeat verbatim across a project's retries/
    // multiple-role calls), and the genuinely per-call content
    // (remediation/failure detail, task metadata, prior artifacts/
    // decisions, relevant files) in the volatile `messages` array, never
    // cached. See structured-output-contract.ts's `buildPromptSegments`
    // docblock for the full reasoning.
    const { systemText, userText } = buildPromptSegments(input);
    const maxOutputTokens = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let message: Awaited<ReturnType<Anthropic["messages"]["create"]>>;
    try {
      message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: maxOutputTokens,
          system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userText }],
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
    // Real, as returned by the API — `null` (no cache activity reported)
    // becomes `undefined` here (see UsageInfo's docblock), never 0
    // ("cache was checked and found empty" is a different, false claim).
    // Token economics phase, Part 9 — never fabricated.
    const cacheCreationInputTokens = message.usage.cache_creation_input_tokens ?? undefined;
    const cacheReadInputTokens = message.usage.cache_read_input_tokens ?? undefined;
    const pricing = getClaudePricingConfig();
    // Reachable only if pricing configuration was removed *after*
    // isClaudeConfigured() was checked but before this call completed —
    // an honest $0 would misrepresent a real paid call, so this fails
    // the task instead of ever silently under-reporting cost.
    if (!pricing) {
      return malformedResult("Claude pricing configuration is missing — cannot safely record real usage cost for this call.");
    }
    const costUsd = calculateClaudeCostUsd(pricing, inputTokens, outputTokens, { cacheCreationInputTokens, cacheReadInputTokens });
    const usage = { inputTokens, outputTokens, costUsd, cacheCreationInputTokens, cacheReadInputTokens };

    const parsed = parseStructuredOutput(text);
    if (!parsed.ok) {
      // The API call itself already completed and billed real tokens by
      // this point — a malformed/schema-mismatched response is still a
      // real, paid call, never a free one. Overriding malformedResult()'s
      // default zero usage here is what keeps this call's real cost from
      // silently vanishing from the ledger (Part 6's "never silently
      // report $0 for Claude").
      return { ...malformedResult(`Claude's model output ${parsed.reason}`), usage };
    }

    const output = parsed.output;
    return {
      status: output.failure ? "FAILED" : "SUCCEEDED",
      output,
      usage,
      raw: { model: this.model },
    };
  }
}
