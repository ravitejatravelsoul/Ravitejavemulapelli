import { test } from "node:test";
import assert from "node:assert/strict";
import { getFreeEligibility } from "../free/free-provider-config.ts";
import { createFreeProviderAdapter } from "../free/free-adapter-factory.ts";
import { OpenAICompatibleAdapter } from "../openai-compatible/openai-compatible-adapter.ts";
import { GeminiAdapter } from "../gemini/gemini-adapter.ts";
import type { AgentTaskInput } from "../types.ts";

test("eligibility distinguishes local, provider route and owner attestation; revocation closes routing", () => {
  const old = { ...process.env };
  try {
    assert.equal(getFreeEligibility("ollama", "local"), "LOCAL_FREE");
    assert.equal(getFreeEligibility("openrouter", "model:free"), "PROVIDER_FREE_ROUTE");
    assert.equal(getFreeEligibility("openrouter", "unknown-price"), null);
    for (const provider of ["groq", "gemini"]) {
      const prefix = "AI_OFFICE_" + provider.toUpperCase();
      process.env[prefix + "_FREE_MODELS"] = "allowed";
      delete process.env[prefix + "_FREE_TIER_CONFIRMED"];
      assert.equal(getFreeEligibility(provider, "allowed"), null);
      process.env[prefix + "_FREE_TIER_CONFIRMED"] = "true";
      assert.equal(getFreeEligibility(provider, "allowed"), "OWNER_CONFIRMED_FREE_TIER");
      assert.equal(getFreeEligibility(provider, "unlisted"), null);
      process.env[prefix + "_FREE_TIER_CONFIRMED"] = "false";
      assert.equal(createFreeProviderAdapter(provider, "allowed"), null);
    }
    assert.equal(createFreeProviderAdapter("anthropic", "claude"), null);
  } finally { process.env = old; }
});

test("direct unknown-price adapters neither estimate zero nor make a request", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; throw new Error("Forbidden"); }) as typeof fetch;
  const adapters = [
    new OpenAICompatibleAdapter({ providerName: "openrouter", model: "paid", apiKey: "test", baseUrl: "https://example.invalid", fetchImpl }),
    new OpenAICompatibleAdapter({ providerName: "unknown", model: "unknown", apiKey: "test", baseUrl: "https://example.invalid", fetchImpl }),
    new GeminiAdapter({ model: "unlisted", apiKey: "test", fetchImpl }),
  ];
  for (const adapter of adapters) {
    assert.throws(() => adapter.estimateCost(), /not explicitly free-eligible/);
    await assert.rejects(adapter.runAgentTask({} as AgentTaskInput), /not explicitly free-eligible/);
  }
  assert.equal(calls, 0);
});
