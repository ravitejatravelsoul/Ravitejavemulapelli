import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkOllamaHealth } from "../ollama/health.ts";

describe("checkOllamaHealth", () => {
  test("reports online with the model list on a successful response", async () => {
    const fetchImpl = async () =>
      ({ ok: true, json: async () => ({ models: [{ name: "gemma4:latest" }, { name: "qwen3.6:latest" }] }) }) as unknown as Response;
    const health = await checkOllamaHealth({ fetchImpl: fetchImpl as unknown as typeof fetch });
    assert.equal(health.online, true);
    assert.deepEqual(health.models, ["gemma4:latest", "qwen3.6:latest"]);
  });

  test("reports offline on a non-OK HTTP status", async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) }) as unknown as Response;
    const health = await checkOllamaHealth({ fetchImpl: fetchImpl as unknown as typeof fetch });
    assert.equal(health.online, false);
    assert.deepEqual(health.models, []);
  });

  test("reports offline when the connection is refused", async () => {
    const fetchImpl = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const health = await checkOllamaHealth({ fetchImpl: fetchImpl as unknown as typeof fetch });
    assert.equal(health.online, false);
    assert.deepEqual(health.models, []);
  });

  test("reports offline on timeout, never throws", async () => {
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")));
      });
    const health = await checkOllamaHealth({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 });
    assert.equal(health.online, false);
  });
});
