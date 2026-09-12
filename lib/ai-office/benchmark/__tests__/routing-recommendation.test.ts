import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { recordBenchmarkResult, listRecommendedRouting, getAppliedRouting } from "../../domain/model-routing.ts";
import { generateRecommendedRouting } from "../routing-recommendation.ts";

function seed(db: ReturnType<typeof createTestDb>["db"], model: string, scenarioId: string, roleId: string, status: "PASS" | "FAIL", latencyMs: number) {
  recordBenchmarkResult(db, { model, scenarioId, roleId, status, score: status === "PASS" ? 90 : 10, latencyMs });
}

describe("generateRecommendedRouting", () => {
  test("recommends the model with the higher success rate for a capability", () => {
    const t = createTestDb();
    seed(t.db, "gemma4:latest", "frontend-build", "frontend-developer", "FAIL", 5000);
    seed(t.db, "gemma4:latest", "frontend-bug-fix", "frontend-developer", "FAIL", 5000);
    seed(t.db, "qwen3.6:latest", "frontend-build", "frontend-developer", "PASS", 20000);
    seed(t.db, "qwen3.6:latest", "frontend-bug-fix", "frontend-developer", "PASS", 20000);

    const { generated, skipped } = generateRecommendedRouting(t.db);
    const coding = generated.find((r) => r.capability === "CODING");
    assert.equal(coding?.model, "qwen3.6:latest");
    assert.ok(!skipped.includes("CODING" as never));
    t.close();
  });

  test("breaks a success-rate tie by lower average latency", () => {
    const t = createTestDb();
    seed(t.db, "gemma4:latest", "product-owner-basic", "product-owner", "PASS", 3000);
    seed(t.db, "qwen3.6:latest", "product-owner-basic", "product-owner", "PASS", 15000);

    const { generated } = generateRecommendedRouting(t.db);
    const general = generated.find((r) => r.capability === "GENERAL");
    assert.equal(general?.model, "gemma4:latest", "same success rate — the faster model should win the tie-break");
    t.close();
  });

  test("a capability with zero benchmark evidence is skipped, never guessed at", () => {
    const t = createTestDb();
    const { generated, skipped } = generateRecommendedRouting(t.db);
    assert.equal(generated.length, 0);
    assert.ok(skipped.includes("GENERAL"));
    assert.ok(skipped.includes("CODING"));
    t.close();
  });

  test("FAST is always skipped — no benchmark scenario currently covers it", () => {
    const t = createTestDb();
    seed(t.db, "gemma4:latest", "product-owner-basic", "product-owner", "PASS", 1000);
    const { skipped } = generateRecommendedRouting(t.db);
    assert.ok(skipped.includes("FAST"));
    t.close();
  });

  test("regenerating a recommendation never marks it applied — that stays the owner's explicit action alone", () => {
    const t = createTestDb();
    seed(t.db, "gemma4:latest", "product-owner-basic", "product-owner", "PASS", 1000);
    generateRecommendedRouting(t.db);

    const rows = listRecommendedRouting(t.db);
    assert.ok(rows.length > 0);
    for (const row of rows) assert.equal(row.appliedAt, null);
    assert.equal(getAppliedRouting(t.db).length, 0);
    t.close();
  });
});
