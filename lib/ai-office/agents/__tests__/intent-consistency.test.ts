import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkIntentConsistency } from "../intent-consistency.ts";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body } as unknown as Response;
}

describe("checkIntentConsistency", () => {
  test("returns consistent:true and the model's reason when the model reports consistent:true", async () => {
    const fetchImpl = async () => jsonResponse({ response: JSON.stringify({ consistent: true, reason: "The plan builds a webpage as requested." }) });
    const result = await checkIntentConsistency({
      authoritativeUserRequest: "Build a simple webpage with a heading and a button.",
      candidate: "Architecture: a static HTML page with a heading and a button.",
      checkpointLabel: "planned architecture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assert.equal(result.consistent, true);
    assert.equal(result.reason, "The plan builds a webpage as requested.");
  });

  test("returns consistent:false and the model's reason when the model reports a real mismatch", async () => {
    const fetchImpl = async () =>
      jsonResponse({ response: JSON.stringify({ consistent: false, reason: "The plan describes a Python API client, not a webpage." }) });
    const result = await checkIntentConsistency({
      authoritativeUserRequest: "Build a simple webpage with a heading and a button.",
      candidate: "Architecture: a Python client library that calls a remote API.",
      checkpointLabel: "planned architecture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assert.equal(result.consistent, false);
    assert.match(result.reason, /Python API client/);
  });

  test("is generic — not hardcoded to any specific title/idea pair (three unrelated cases)", async () => {
    const cases = [
      { request: "Create a simple webpage with a heading, description and button.", candidate: "A CLI tool that talks to a local LLM server.", expected: false },
      { request: "Create a static HTML landing page.", candidate: "A Flask backend with a REST API and a database.", expected: false },
      { request: "Create a calculator webpage.", candidate: "A calculator webpage with add/subtract buttons and a display.", expected: true },
    ];
    for (const c of cases) {
      const fetchImpl = async () => jsonResponse({ response: JSON.stringify({ consistent: c.expected, reason: "model judgment" }) });
      const result = await checkIntentConsistency({
        authoritativeUserRequest: c.request,
        candidate: c.candidate,
        checkpointLabel: "test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      assert.equal(result.consistent, c.expected);
    }
  });

  test("fails open (consistent:true) when Ollama is unreachable — never blocks the pipeline on its own reliability", async () => {
    const fetchImpl = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const result = await checkIntentConsistency({
      authoritativeUserRequest: "Build a webpage.",
      candidate: "A webpage.",
      checkpointLabel: "planned architecture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assert.equal(result.consistent, true);
    assert.match(result.reason, /could not run/);
  });

  test("fails open when the model's response is not valid JSON", async () => {
    const fetchImpl = async () => jsonResponse({ response: "sure, it looks consistent to me" });
    const result = await checkIntentConsistency({
      authoritativeUserRequest: "Build a webpage.",
      candidate: "A webpage.",
      checkpointLabel: "planned architecture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assert.equal(result.consistent, true);
  });

  test("fails open when the HTTP response is not ok", async () => {
    const fetchImpl = async () => jsonResponse({}, { ok: false, status: 500 });
    const result = await checkIntentConsistency({
      authoritativeUserRequest: "Build a webpage.",
      candidate: "A webpage.",
      checkpointLabel: "planned architecture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assert.equal(result.consistent, true);
  });

  test("skips the check (consistent:true) when either input is empty — nothing meaningful to compare yet", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return jsonResponse({ response: JSON.stringify({ consistent: true, reason: "x" }) });
    };
    const result = await checkIntentConsistency({
      authoritativeUserRequest: "",
      candidate: "something",
      checkpointLabel: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assert.equal(result.consistent, true);
    assert.equal(called, false, "must not call Ollama when there's nothing to compare");
  });
});
