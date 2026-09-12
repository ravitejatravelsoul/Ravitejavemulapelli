import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { OllamaAdapter, OllamaConnectionError, OllamaTimeoutError } from "../ollama/ollama-adapter.ts";
import type { TaskContext } from "../types.ts";

function context(): TaskContext {
  return {
    projectId: "p1",
    taskId: "t1",
    roleId: "product-owner",
    taskTitle: "Define requirements",
    projectSummary: "Build a one-page todo application.",
    relevantArtifacts: [],
    relevantDecisions: [],
  };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

const VALID_STRUCTURED_OUTPUT = {
  summary: "Wrote requirements for a one-page todo app.",
  artifacts: [{ kind: "artifact", artifactType: "requirements", content: "# Requirements\n- Add a todo\n- Mark complete" }],
  decisions: [{ kind: "decision", type: "assumption", summary: "No accounts — single-user local app." }],
  testResults: [],
  events: [],
  recommendedNextActions: ["Hand off to Solution Architect"],
};

describe("OllamaAdapter — identity and cost", () => {
  test("name is 'ollama'", () => {
    assert.equal(new OllamaAdapter().name, "ollama");
  });

  test("estimateCost always returns zero", () => {
    const adapter = new OllamaAdapter();
    assert.deepEqual(adapter.estimateCost({ role: "product-owner", task: context(), instructions: "x" }), {
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      estimatedCostUsd: 0,
    });
  });
});

describe("OllamaAdapter — successful structured response", () => {
  test("parses a valid JSON structured response into SUCCEEDED, with $0 cost and mapped token/duration metadata", async () => {
    let capturedBody: unknown;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return jsonResponse({ response: JSON.stringify(VALID_STRUCTURED_OUTPUT), prompt_eval_count: 120, eval_count: 340 });
    };

    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "http://test.invalid", model: "test-model" });
    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "Write requirements." });

    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.output.summary, VALID_STRUCTURED_OUTPUT.summary);
    assert.equal(result.output.artifacts.length, 1);
    assert.equal(result.usage.inputTokens, 120);
    assert.equal(result.usage.outputTokens, 340);
    assert.equal(result.usage.costUsd, 0, "Ollama usage must never carry a nonzero cost");

    assert.equal((capturedBody as { model: string }).model, "test-model");
    assert.equal((capturedBody as { format: string }).format, "json");
    assert.equal((capturedBody as { stream: boolean }).stream, false);
    assert.match(
      (capturedBody as { prompt: string }).prompt,
      /artifactType": "requirements"/,
      "the prompt should tell the model exactly which artifactType this role must use",
    );
  });

  test("a model-reported failure field produces a FAILED result, not SUCCEEDED", async () => {
    const failurePayload = { ...VALID_STRUCTURED_OUTPUT, failure: { reason: "The idea was too ambiguous to spec." } };
    const fetchImpl = async () => jsonResponse({ response: JSON.stringify(failurePayload) });
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });
    assert.equal(result.status, "FAILED");
    assert.equal(result.output.failure?.reason, "The idea was too ambiguous to spec.");
    assert.equal(result.usage.costUsd, 0);
  });
});

describe("OllamaAdapter — malformed responses never throw, always a clear FAILED result", () => {
  test("non-JSON HTTP body", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }) as unknown as Response;
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });
    assert.equal(result.status, "FAILED");
    assert.match(result.output.failure!.reason, /not valid JSON/);
  });

  test("model output that isn't JSON at all", async () => {
    const fetchImpl = async () => jsonResponse({ response: "Sure, here are the requirements: ..." });
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });
    assert.equal(result.status, "FAILED");
    assert.match(result.output.failure!.reason, /model output was not valid JSON/);
  });

  test("syntactically valid JSON that doesn't match the expected shape", async () => {
    const fetchImpl = async () => jsonResponse({ response: JSON.stringify({ hello: "world" }) });
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });
    assert.equal(result.status, "FAILED");
    assert.match(result.output.failure!.reason, /did not match the expected structured shape/);
  });

  // Regression test — found via a real local Ollama run: a model that
  // returns a plausible-but-not-exact artifactType (e.g. "requirements-doc"
  // instead of "requirements") used to produce a SUCCEEDED result that
  // then crashed deep inside persistence with a raw SQL CHECK constraint
  // error, because artifacts.type in the DB only accepts an exact enum.
  // artifactType is now validated against that same enum here, so an
  // off-spec value is a clean FAILED result instead.
  test("an artifactType outside the DB's allowed enum produces a clean FAILED result, never a value that would later violate the artifacts.type CHECK constraint", async () => {
    const badPayload = { ...VALID_STRUCTURED_OUTPUT, artifacts: [{ kind: "artifact", artifactType: "requirements-doc", content: "..." }] };
    const fetchImpl = async () => jsonResponse({ response: JSON.stringify(badPayload) });
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });
    assert.equal(result.status, "FAILED");
    assert.match(result.output.failure!.reason, /did not match the expected structured shape/);
  });
});

describe("OllamaAdapter — connection and HTTP errors throw (agent-runner's existing catch-all converts these to FAILED)", () => {
  test("a rejected fetch (connection refused) throws OllamaConnectionError", async () => {
    const fetchImpl = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    };
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "http://127.0.0.1:11434" });
    await assert.rejects(
      () => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }),
      OllamaConnectionError,
    );
  });

  test("a non-OK HTTP status throws OllamaConnectionError", async () => {
    const fetchImpl = async () => jsonResponse({}, { ok: false, status: 500 });
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await assert.rejects(() => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }), OllamaConnectionError);
  });

  test("an aborted (timed-out) request throws OllamaTimeoutError, not a generic error", async () => {
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")));
      });
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 });
    await assert.rejects(() => adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" }), OllamaTimeoutError);
  });
});

describe("OllamaAdapter — configuration", () => {
  test("defaults come from environment variables when not passed explicitly", async () => {
    const prevUrl = process.env.OLLAMA_BASE_URL;
    const prevModel = process.env.OLLAMA_MODEL;
    process.env.OLLAMA_BASE_URL = "http://env-configured.invalid";
    process.env.OLLAMA_MODEL = "env-model";

    let capturedUrl = "";
    let capturedModel = "";
    const fetchImpl = async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedModel = (JSON.parse(init.body as string) as { model: string }).model;
      return jsonResponse({ response: JSON.stringify(VALID_STRUCTURED_OUTPUT) });
    };

    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });

    assert.ok(capturedUrl.startsWith("http://env-configured.invalid"));
    assert.equal(capturedModel, "env-model");

    if (prevUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = prevUrl;
    if (prevModel === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = prevModel;
  });

  test("explicit constructor options take precedence over environment variables", async () => {
    process.env.OLLAMA_BASE_URL = "http://should-not-be-used.invalid";
    let capturedUrl = "";
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ response: JSON.stringify(VALID_STRUCTURED_OUTPUT) });
    };
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "http://explicit.invalid" });
    await adapter.runAgentTask({ role: "product-owner", task: context(), instructions: "x" });
    assert.ok(capturedUrl.startsWith("http://explicit.invalid"));
    delete process.env.OLLAMA_BASE_URL;
  });
});
