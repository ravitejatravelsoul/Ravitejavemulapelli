import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { listInstalledOllamaModels, listInstalledOllamaModelsDetailed } from "../ollama-inventory.ts";

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response) as unknown as typeof fetch;
}

describe("listInstalledOllamaModelsDetailed", () => {
  test("parses a real /api/tags-shaped response into name + size", async () => {
    const result = await listInstalledOllamaModelsDetailed({
      fetchImpl: fetchReturning({
        models: [
          { name: "gemma4:latest", size: 9_600_000_000 },
          { name: "qwen3.6:latest", size: 22_000_000_000 },
        ],
      }),
    });
    assert.deepEqual(result, [
      { name: "gemma4:latest", sizeBytes: 9_600_000_000 },
      { name: "qwen3.6:latest", sizeBytes: 22_000_000_000 },
    ]);
  });

  test("an empty installed-model list is honestly reported as empty, not an error", async () => {
    const result = await listInstalledOllamaModelsDetailed({ fetchImpl: fetchReturning({ models: [] }) });
    assert.deepEqual(result, []);
  });

  test("a missing models array defaults to empty rather than throwing", async () => {
    const result = await listInstalledOllamaModelsDetailed({ fetchImpl: fetchReturning({}) });
    assert.deepEqual(result, []);
  });

  test("throws an Operational-prefixed error on a connection failure — never silently returns an empty list to mask an unreachable server", async () => {
    const throwingFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await assert.rejects(() => listInstalledOllamaModelsDetailed({ fetchImpl: throwingFetch }), /Operational:.*Could not reach Ollama/);
  });

  test("throws an Operational-prefixed error on a non-2xx HTTP response", async () => {
    await assert.rejects(() => listInstalledOllamaModelsDetailed({ fetchImpl: fetchReturning({}, 500) }), /Operational:.*HTTP 500/);
  });

  test("throws an Operational-prefixed error on malformed JSON", async () => {
    const malformedFetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      }) as unknown as Response) as unknown as typeof fetch;
    await assert.rejects(() => listInstalledOllamaModelsDetailed({ fetchImpl: malformedFetch }), /Operational:.*not valid JSON/);
  });

  test("throws an Operational-prefixed error when the response doesn't match the expected shape", async () => {
    await assert.rejects(
      () => listInstalledOllamaModelsDetailed({ fetchImpl: fetchReturning({ models: [{ notAName: true }] }) }),
      /Operational:.*did not match the expected shape/,
    );
  });
});

describe("listInstalledOllamaModels", () => {
  test("returns just the model names", async () => {
    const result = await listInstalledOllamaModels({
      fetchImpl: fetchReturning({ models: [{ name: "gemma4:latest" }, { name: "qwen3.6:latest" }] }),
    });
    assert.deepEqual(result, ["gemma4:latest", "qwen3.6:latest"]);
  });
});
