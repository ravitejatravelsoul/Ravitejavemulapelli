process.env.AI_OFFICE_GEMINI_FREE_TIER_CONFIRMED = "true";
process.env.AI_OFFICE_GEMINI_FREE_MODELS = "gemini-2.0-flash";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GeminiAdapter, GeminiRateLimitError, GeminiTimeoutError, GeminiConnectionError } from "../gemini/gemini-adapter.ts";
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

describe("GeminiAdapter — identity and cost", () => {
  test("name is 'gemini'; estimateCost always returns zero", () => {
    const adapter = new GeminiAdapter({ apiKey: "k", model: "gemini-2.0-flash" });
    assert.equal(adapter.name, "gemini");
    assert.deepEqual(adapter.estimateCost(), { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 });
  });
});

describe("GeminiAdapter — successful structured response", () => {
  test("posts to the generateContent endpoint with the api key in a header, parses candidates[0].content.parts text, usage.costUsd is always 0", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      assert.equal((init.headers as Record<string,string>)["x-goog-api-key"], "secret");
      capturedBody = JSON.parse(init.body as string);
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_STRUCTURED_OUTPUT) }] } }],
        usageMetadata: { promptTokenCount: 55, candidatesTokenCount: 77 },
      });
    }) as unknown as typeof fetch;

    const adapter = new GeminiAdapter({ apiKey: "secret", model: "gemini-2.0-flash", fetchImpl });
    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "do it" });

    assert.match(capturedUrl, /\/models\/gemini-2\.0-flash:generateContent$/);
    assert.equal((capturedBody.generationConfig as Record<string, unknown>).responseMimeType, "application/json");
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.usage.costUsd, 0);
    assert.equal(result.usage.inputTokens, 55);
    assert.equal(result.usage.outputTokens, 77);
  });
});

describe("GeminiAdapter — failure classification", () => {
  test("HTTP 429 throws GeminiRateLimitError with an 'Operational:' prefixed, rate-limited message", async () => {
    const fetchImpl = (async () => jsonResponse({}, { ok: false, status: 429 })) as unknown as typeof fetch;
    const adapter = new GeminiAdapter({ apiKey: "k", model: "gemini-2.0-flash", fetchImpl });

    await assert.rejects(
      () => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }),
      (error: Error) => {
        assert.ok(error instanceof GeminiRateLimitError);
        assert.match(error.message, /^Operational:/);
        assert.match(error.message, /rate-limited/i);
        return true;
      },
    );
  });

  test("a non-2xx, non-429 response throws GeminiConnectionError, 'Operational:' prefixed", async () => {
    const fetchImpl = (async () => jsonResponse({}, { ok: false, status: 500 })) as unknown as typeof fetch;
    const adapter = new GeminiAdapter({ apiKey: "k", model: "gemini-2.0-flash", fetchImpl });

    await assert.rejects(
      () => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }),
      (error: Error) => {
        assert.ok(error instanceof GeminiConnectionError);
        assert.match(error.message, /^Operational:/);
        return true;
      },
    );
  });

  test("an aborted (timed-out) fetch throws GeminiTimeoutError, 'Operational:' prefixed", async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;
    const adapter = new GeminiAdapter({ apiKey: "k", model: "gemini-2.0-flash", timeoutMs: 10, fetchImpl });

    await assert.rejects(
      () => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }),
      (error: Error) => {
        assert.ok(error instanceof GeminiTimeoutError);
        assert.match(error.message, /^Operational:/);
        return true;
      },
    );
  });

  test("a response with no candidates (e.g. safety-filtered) returns a FAILED result via malformedResult, not a thrown error", async () => {
    const fetchImpl = (async () => jsonResponse({ candidates: [] })) as unknown as typeof fetch;
    const adapter = new GeminiAdapter({ apiKey: "k", model: "gemini-2.0-flash", fetchImpl });

    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });
    assert.equal(result.status, "FAILED");
    assert.match(result.output.failure!.reason, /included no content/);
  });
});
