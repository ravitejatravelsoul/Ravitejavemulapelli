import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  OpenAICompatibleAdapter,
  OpenAICompatibleRateLimitError,
  OpenAICompatibleRequestTooLargeError,
  OpenAICompatibleConnectionError,
} from "../openai-compatible/openai-compatible-adapter.ts";
import type { TaskContext } from "../types.ts";

process.env.AI_OFFICE_GROQ_FREE_TIER_CONFIRMED = "true";
process.env.AI_OFFICE_GROQ_FREE_MODELS = "m1";

const context: TaskContext = {
  projectId: "p1", taskId: "t1", roleId: "product-owner", taskTitle: "Define requirements", projectSummary: "s",
  authoritativeUserRequest: "Build a page.", projectTitle: "T", relevantArtifacts: [], relevantDecisions: [],
};
const VALID = { summary: "ok", artifacts: [{ kind: "artifact", artifactType: "requirements", content: "# R" }], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [] };
const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const adapter = (fetchImpl: typeof fetch) => new OpenAICompatibleAdapter({ providerName: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m1", fetchImpl });
const run = (a: OpenAICompatibleAdapter) => a.runAgentTask({ role: "product-owner", task: context, instructions: "x", maxOutputTokens: 4096 });

describe("provider limit handling", () => {
  test("HTTP 413 is a typed request-too-large error carrying only numeric limit evidence, and is not a rate-limit", async () => {
    const message = "Request too large for model `m1` in organization `org_secret123` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 9100, please reduce your message size and try again.";
    await assert.rejects(
      () => run(adapter((async () => respond(413, { error: { code: "rate_limit_exceeded", message } }, { "retry-after": "12", "x-request-id": "req_abc123" })) as typeof fetch)),
      (error: unknown) => {
        assert.ok(error instanceof OpenAICompatibleRequestTooLargeError);
        assert.ok(!(error instanceof OpenAICompatibleRateLimitError));
        assert.match(error.message, /^Operational: groq request too large/);
        assert.match(error.message, /token limit 8000, requested 9100/);
        assert.ok(!/rate-limited/i.test(error.message), "must not match the rate-limit cooldown classifier");
        assert.ok(!error.message.includes("org_secret123"), "provider message text (and org ids) are never propagated");
        assert.deepEqual(
          { s: error.diagnostics.httpStatus, c: error.diagnostics.errorCode, l: error.diagnostics.tokenLimit, r: error.diagnostics.tokensRequested, ra: error.diagnostics.retryAfterSeconds, id: error.diagnostics.requestId, m: error.diagnostics.maxOutputTokens },
          { s: 413, c: "rate_limit_exceeded", l: 8000, r: 9100, ra: 12, id: "req_abc123", m: 4096 },
        );
        return true;
      },
    );
  });

  test("HTTP 429 keeps Retry-After handling and now also carries token-window diagnostics", async () => {
    await assert.rejects(
      () => run(adapter((async () => respond(429, { error: { code: "rate_limit_exceeded", message: "Rate limit reached ... Limit 8000, Used 7000, Requested 2000" } }, { "retry-after": "13", "x-ratelimit-remaining-tokens": "962", "x-ratelimit-reset-tokens": "52.785s" })) as typeof fetch)),
      (error: unknown) => {
        assert.ok(error instanceof OpenAICompatibleRateLimitError);
        assert.equal(error.retryAfterMs, 13_000);
        assert.deepEqual({ l: error.diagnostics?.tokenLimit, u: error.diagnostics?.tokensUsed, r: error.diagnostics?.tokensRequested, rem: error.diagnostics?.remainingTokens, reset: error.diagnostics?.resetMs }, { l: 8000, u: 7000, r: 2000, rem: 962, reset: 52785 });
        return true;
      },
    );
  });

  test("other HTTP failures stay generic operational errors", async () => {
    await assert.rejects(() => run(adapter((async () => respond(500, { error: { code: "server_error" } })) as typeof fetch)), OpenAICompatibleConnectionError);
  });

  test("a successful response records the provider's token window headers as numeric diagnostics", async () => {
    const result = await run(adapter((async () => respond(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(VALID) } }], usage: { prompt_tokens: 6863, completion_tokens: 10 } }, { "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": "962", "x-ratelimit-reset-tokens": "1m26.4s" })) as typeof fetch));
    const d = (result.raw as { responseDiagnostics: Record<string, unknown> }).responseDiagnostics;
    assert.equal(result.status, "SUCCEEDED");
    assert.deepEqual({ l: d.tokenLimit, rem: d.remainingTokens, reset: d.resetMs }, { l: 8000, rem: 962, reset: 86400 });
  });
});

describe("json_validate_failed handling (narrow, deterministic, no model repair)", () => {
  const rejected = (failed: unknown) => respond(400, { error: { code: "json_validate_failed", message: "Failed to generate JSON.", failed_generation: failed } });

  test("provider-rejected text that is strict JSON and passes our full schema is accepted, flagged as recovered", async () => {
    const result = await run(adapter((async () => rejected(JSON.stringify(VALID))) as typeof fetch));
    assert.equal(result.status, "SUCCEEDED");
    const d = (result.raw as { responseDiagnostics: Record<string, unknown> }).responseDiagnostics;
    assert.equal(d.recoveredFromRejectedGeneration, true);
    assert.equal(d.errorCode, "json_validate_failed");
  });

  test("a single surrounding markdown fence is the only wrapper removed", async () => {
    const result = await run(adapter((async () => rejected("```json\n" + JSON.stringify(VALID) + "\n```")) as typeof fetch));
    assert.equal(result.status, "SUCCEEDED");
  });

  test("truncated / non-JSON / prose-wrapped text is NEVER accepted, and only safe metadata is kept", async () => {
    for (const bad of ['{"summary":"cut off', 'Here is the JSON: ' + JSON.stringify(VALID), "```json\n{oops}\n```"]) {
      const result = await run(adapter((async () => rejected(bad)) as typeof fetch));
      assert.equal(result.status, "FAILED", bad);
      const d = (result.raw as { responseDiagnostics: Record<string, unknown> }).responseDiagnostics;
      assert.equal(d.strictJsonAndSchemaValid, false);
      assert.equal(d.failedGenerationLength, bad.length);
      assert.ok(!JSON.stringify(result.raw).includes("cut off") && !JSON.stringify(result.raw).includes("oops"), "raw generated text must not be persisted");
      assert.match(result.output.failure!.reason, /^Operational: groq model output did not match the requested JSON schema/);
    }
  });

  test("valid JSON that violates the structured schema (wrong artifact type) is rejected, not repaired", async () => {
    const wrong = { ...VALID, artifacts: [{ kind: "artifact", artifactType: "not-a-real-type", content: "x" }] };
    const result = await run(adapter((async () => rejected(JSON.stringify(wrong))) as typeof fetch));
    assert.equal(result.status, "FAILED");
  });

  test("no failed_generation at all is an ordinary failed structured-output result", async () => {
    const result = await run(adapter((async () => respond(400, { error: { code: "json_validate_failed" } })) as typeof fetch));
    assert.equal(result.status, "FAILED");
    assert.equal((result.raw as { responseDiagnostics: Record<string, unknown> }).responseDiagnostics.failedGenerationPresent, false);
  });
});
