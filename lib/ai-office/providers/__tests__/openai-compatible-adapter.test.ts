import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleAdapter, OpenAICompatibleRateLimitError, OpenAICompatibleTimeoutError, OpenAICompatibleConnectionError } from "../openai-compatible/openai-compatible-adapter.ts";
import type { TaskContext } from "../types.ts";

function context(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    projectId: "p1",
    taskId: "t1",
    roleId: "product-owner",
    taskTitle: "Define requirements",
    projectSummary: "Build a one-page todo application.",
    authoritativeUserRequest: "Build a one-page todo application.",
    projectTitle: "Todo App Project",
    relevantArtifacts: [],
    relevantDecisions: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return { ok: init.ok ?? true, status: init.status ?? 200, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response;
}

const VALID_STRUCTURED_OUTPUT = {
  summary: "Wrote requirements.",
  artifacts: [{ kind: "artifact", artifactType: "requirements", content: "# Requirements" }],
  decisions: [],
  testResults: [],
  events: [],
  recommendedNextActions: [],
};

describe("OpenAICompatibleAdapter — identity and cost", () => {
  test("name reflects the providerName passed in — covers both Groq and OpenRouter with one class", () => {
    const groq = new OpenAICompatibleAdapter({ providerName: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m1" });
    const openrouter = new OpenAICompatibleAdapter({ providerName: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m1" });
    assert.equal(groq.name, "groq");
    assert.equal(openrouter.name, "openrouter");
  });

  test("estimateCost always returns zero — free-tier by construction", () => {
    const adapter = new OpenAICompatibleAdapter({ providerName: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m1" });
    assert.deepEqual(adapter.estimateCost(), { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 });
  });
});

describe("OpenAICompatibleAdapter — successful structured response", () => {
  test("posts Bearer auth + response_format json_object, parses the chat completion content, usage.costUsd is always 0", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      capturedBody = JSON.parse(init.body as string);
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(VALID_STRUCTURED_OUTPUT) } }],
        usage: { prompt_tokens: 111, completion_tokens: 222 },
      });
    }) as unknown as typeof fetch;

    const adapter = new OpenAICompatibleAdapter({ providerName: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "secret-key", model: "llama-x", fetchImpl });
    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "do it" });

    assert.equal(capturedUrl, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(capturedHeaders.authorization, "Bearer secret-key");
    assert.equal(capturedBody.model, "llama-x");
    assert.deepEqual(capturedBody.response_format, { type: "json_object" });
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.usage.costUsd, 0);
    assert.equal(result.usage.inputTokens, 111);
    assert.equal(result.usage.outputTokens, 222);
    assert.equal(result.output.summary, "Wrote requirements.");
  });
});

describe("OpenAICompatibleAdapter — failure classification", () => {
  test("HTTP 429 throws OpenAICompatibleRateLimitError with an 'Operational:' prefixed, rate-limited message", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "rate limited" }, { ok: false, status: 429 })) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ providerName: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m1", fetchImpl });

    await assert.rejects(
      () => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }),
      (error: Error) => {
        assert.ok(error instanceof OpenAICompatibleRateLimitError);
        assert.match(error.message, /^Operational:/);
        assert.match(error.message, /rate-limited/i);
        return true;
      },
    );
  });

  test("a non-2xx, non-429 response throws OpenAICompatibleConnectionError, 'Operational:' prefixed", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "boom" }, { ok: false, status: 500 })) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ providerName: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m1", fetchImpl });

    await assert.rejects(
      () => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }),
      (error: Error) => {
        assert.ok(error instanceof OpenAICompatibleConnectionError);
        assert.match(error.message, /^Operational:/);
        return true;
      },
    );
  });

  test("an aborted (timed-out) fetch throws OpenAICompatibleTimeoutError, 'Operational:' prefixed", async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ providerName: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m1", timeoutMs: 10, fetchImpl });

    await assert.rejects(
      () => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }),
      (error: Error) => {
        assert.ok(error instanceof OpenAICompatibleTimeoutError);
        assert.match(error.message, /^Operational:/);
        return true;
      },
    );
  });

  test("malformed (non-JSON) model output returns a FAILED result via malformedResult, not a thrown error", async () => {
    const fetchImpl = (async () => jsonResponse({ choices: [{ message: { content: "not json at all" } }], usage: {} })) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ providerName: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m1", fetchImpl });

    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });
    assert.equal(result.status, "FAILED");
    assert.match(result.output.failure!.reason, /model output was not valid JSON/);
  });
});
