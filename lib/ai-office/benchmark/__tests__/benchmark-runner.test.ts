import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { runBenchmarkScenario, runBenchmarkSuite } from "../benchmark-runner.ts";
import { listBenchmarkResults } from "../../domain/model-routing.ts";
import { countLocalRunsForOffice, sumLocalCostForOffice } from "../../domain/budget.ts";

function fetchReturningStructuredOutput(output: Record<string, unknown>): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify(output) }) }) as unknown as Response) as unknown as typeof fetch;
}

const GOOD_HELLO_WORLD_OUTPUT = {
  summary: "Requirements: a heading, a short description, and a button.",
  artifacts: [],
  decisions: [],
  testResults: [],
  events: [],
  fileOperations: [],
  recommendedNextActions: [],
};

describe("runBenchmarkScenario", () => {
  test("a successful real-shaped response is scored and persisted to benchmark_results", async () => {
    const t = createTestDb();
    const row = await runBenchmarkScenario(t.db, {
      model: "gemma4:latest",
      scenarioId: "product-owner-basic",
      fetchImpl: fetchReturningStructuredOutput(GOOD_HELLO_WORLD_OUTPUT),
    });

    assert.equal(row.model, "gemma4:latest");
    assert.equal(row.scenarioId, "product-owner-basic");
    assert.equal(row.roleId, "product-owner");
    assert.equal(row.status, "PASS");
    assert.equal(row.timedOut, 0);
    assert.ok(row.latencyMs >= 0);

    const stored = listBenchmarkResults(t.db, { model: "gemma4:latest" });
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.id, row.id);
    t.close();
  });

  test("a connection failure is recorded as a real FAIL result, never thrown out of the runner", async () => {
    const t = createTestDb();
    const throwingFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const row = await runBenchmarkScenario(t.db, { model: "gemma4:latest", scenarioId: "product-owner-basic", fetchImpl: throwingFetch });
    assert.equal(row.status, "FAIL");
    assert.equal(row.timedOut, 0);
    t.close();
  });

  test("malformed JSON from the model is flagged distinctly from a semantic FAIL", async () => {
    const t = createTestDb();
    const malformedFetch = (async () => ({ ok: true, status: 200, json: async () => ({ response: "not valid json" }) }) as unknown as Response) as unknown as typeof fetch;

    const row = await runBenchmarkScenario(t.db, { model: "gemma4:latest", scenarioId: "product-owner-basic", fetchImpl: malformedFetch });
    assert.equal(row.status, "FAIL");
    assert.equal(row.malformedJson, 1);
    t.close();
  });

  test("the frontend-bug-fix scenario against a model that fixes the linkage scores PASS with defectDiagnosed", async () => {
    const t = createTestDb();
    const fixedHtml =
      '<!doctype html><html><body><h1>Hello, World!</h1><p id="message">Welcome.</p><button id="changeBtn">Click me</button><script src="script.js"></script></body></html>';
    const row = await runBenchmarkScenario(t.db, {
      model: "qwen3.6:latest",
      scenarioId: "frontend-bug-fix",
      fetchImpl: fetchReturningStructuredOutput({
        summary: "Fixed.",
        artifacts: [],
        decisions: [],
        testResults: [],
        events: [],
        fileOperations: [{ kind: "file-operation", action: "write", path: "index.html", content: fixedHtml }],
        recommendedNextActions: [],
      }),
    });
    assert.equal(row.status, "PASS");
    assert.equal(row.defectDiagnosed, 1);
    t.close();
  });
});

describe("runBenchmarkSuite", () => {
  test("runs every scenario against every model, strictly serially, and persists one row per (model, scenario) pair", async () => {
    const t = createTestDb();
    const callOrder: string[] = [];
    const sequencingFetch = (async (url: string, init: RequestInit) => {
      callOrder.push(String((JSON.parse(String(init.body)) as { model: string }).model));
      return { ok: true, status: 200, json: async () => ({ response: JSON.stringify(GOOD_HELLO_WORLD_OUTPUT) }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const results = await runBenchmarkSuite(t.db, {
      models: ["gemma4:latest", "qwen3.6:latest"],
      scenarioIds: ["product-owner-basic", "architect-static-page"],
      fetchImpl: sequencingFetch,
    });

    assert.equal(results.length, 4);
    // Serial, model-outer-loop order: every gemma4 call happens before any qwen3.6 call.
    assert.deepEqual(callOrder, ["gemma4:latest", "gemma4:latest", "qwen3.6:latest", "qwen3.6:latest"]);

    assert.equal(listBenchmarkResults(t.db, { model: "gemma4:latest" }).length, 2);
    assert.equal(listBenchmarkResults(t.db, { model: "qwen3.6:latest" }).length, 2);
    t.close();
  });
});

describe("benchmark runs never touch real budget/ai_usage history (Part U regression)", () => {
  test("running a full benchmark suite leaves the office's LOCAL/LIVE usage ledger completely untouched", async () => {
    const t = createTestDb();
    const before = { runs: countLocalRunsForOffice(t.db), cost: sumLocalCostForOffice(t.db) };

    await runBenchmarkSuite(t.db, {
      models: ["gemma4:latest"],
      scenarioIds: ["product-owner-basic", "frontend-bug-fix"],
      fetchImpl: fetchReturningStructuredOutput(GOOD_HELLO_WORLD_OUTPUT),
    });

    assert.equal(countLocalRunsForOffice(t.db), before.runs, "a benchmark run must never be counted as a real local run");
    assert.equal(sumLocalCostForOffice(t.db), before.cost, "a benchmark run must never contribute to real cost tracking, even though Ollama is $0");
    t.close();
  });
});
