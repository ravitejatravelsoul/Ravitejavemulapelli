import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildComparisonTable } from "../comparison-table.ts";
import type { BenchmarkResultRow } from "../../domain/model-routing.ts";

function row(overrides: Partial<BenchmarkResultRow> & Pick<BenchmarkResultRow, "model" | "scenarioId" | "status" | "latencyMs" | "createdAt">): BenchmarkResultRow {
  return {
    id: `${overrides.model}-${overrides.scenarioId}-${overrides.createdAt}`,
    roleId: "product-owner",
    score: 90,
    promptTokens: null,
    outputTokens: null,
    retries: 0,
    timedOut: 0,
    malformedJson: 0,
    intentConsistencyOutcome: null,
    fileOperationValid: null,
    qaResult: null,
    defectDiagnosed: null,
    matchesRequest: null,
    details: null,
    ...overrides,
  };
}

describe("buildComparisonTable", () => {
  test("empty input produces an empty table", () => {
    assert.deepEqual(buildComparisonTable([]), []);
  });

  test("one model, one scenario — that cell is populated, all others empty", () => {
    const table = buildComparisonTable([
      row({ model: "gemma4:latest", scenarioId: "product-owner-basic", status: "PASS", latencyMs: 1000, createdAt: 100 }),
    ]);
    assert.equal(table.length, 1);
    assert.equal(table[0]!.model, "gemma4:latest");
    assert.deepEqual(table[0]!.cells["product-owner-basic"], { status: "PASS", latencyMs: 1000, runAt: 100 });
    assert.deepEqual(table[0]!.cells["code-review"], { status: null, latencyMs: null, runAt: null });
    assert.equal(table[0]!.avgLatencyMs, 1000);
    assert.equal(table[0]!.lastRunAt, 100);
  });

  test("only the most recent run per scenario is shown, not every historical run", () => {
    const table = buildComparisonTable([
      row({ model: "gemma4:latest", scenarioId: "product-owner-basic", status: "FAIL", latencyMs: 1000, createdAt: 100 }),
      row({ model: "gemma4:latest", scenarioId: "product-owner-basic", status: "PASS", latencyMs: 2000, createdAt: 200 }),
    ]);
    assert.deepEqual(table[0]!.cells["product-owner-basic"], { status: "PASS", latencyMs: 2000, runAt: 200 });
  });

  test("multiple models are each their own row, sorted alphabetically", () => {
    const table = buildComparisonTable([
      row({ model: "qwen3.6:latest", scenarioId: "product-owner-basic", status: "PASS", latencyMs: 5000, createdAt: 100 }),
      row({ model: "gemma4:latest", scenarioId: "product-owner-basic", status: "PASS", latencyMs: 1000, createdAt: 100 }),
    ]);
    assert.deepEqual(table.map((r) => r.model), ["gemma4:latest", "qwen3.6:latest"]);
  });

  test("avgLatencyMs averages across every stored run for that model, not just the latest per scenario", () => {
    const table = buildComparisonTable([
      row({ model: "gemma4:latest", scenarioId: "product-owner-basic", status: "PASS", latencyMs: 1000, createdAt: 100 }),
      row({ model: "gemma4:latest", scenarioId: "code-review", status: "PASS", latencyMs: 3000, createdAt: 100 }),
    ]);
    assert.equal(table[0]!.avgLatencyMs, 2000);
  });
});
