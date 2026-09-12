import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { recordBenchmarkResult, listRecommendedRouting, getAppliedRouting } from "../../domain/model-routing.ts";
import { generateRecommendedRouting, NO_QUALIFIED_MODEL } from "../routing-recommendation.ts";

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

describe("generateRecommendedRouting — minimum-quality threshold (Part 11)", () => {
  test("refuses to nominate a model below the minimum success threshold — the real gemma4-CODING-0%-recommended-anyway problem", () => {
    const t = createTestDb();
    // Exactly the real observed evidence: gemma4 failed both coding
    // scenarios every time (0%); qwen3.6 also failed every time (0%).
    seed(t.db, "gemma4:latest", "frontend-build", "frontend-developer", "FAIL", 90000);
    seed(t.db, "gemma4:latest", "frontend-bug-fix", "frontend-developer", "FAIL", 25000);
    seed(t.db, "qwen3.6:latest", "frontend-build", "frontend-developer", "FAIL", 87000);
    seed(t.db, "qwen3.6:latest", "frontend-bug-fix", "frontend-developer", "FAIL", 44000);

    const { generated, unqualified } = generateRecommendedRouting(t.db);
    const coding = generated.find((r) => r.capability === "CODING");
    assert.equal(coding?.model, NO_QUALIFIED_MODEL, "must never recommend the least-bad 0%-quality model");
    assert.ok(unqualified.includes("CODING"));
    assert.match(coding!.reason, /gemma4:latest/);
    assert.match(coding!.reason, /qwen3\.6:latest/);
    t.close();
  });

  test("a model exactly at or above the 50% threshold is a real, qualified recommendation", () => {
    const t = createTestDb();
    seed(t.db, "gemma4:latest", "frontend-build", "frontend-developer", "PASS", 30000);
    seed(t.db, "gemma4:latest", "frontend-bug-fix", "frontend-developer", "FAIL", 25000);

    const { generated, unqualified } = generateRecommendedRouting(t.db);
    const coding = generated.find((r) => r.capability === "CODING");
    assert.equal(coding?.model, "gemma4:latest");
    assert.ok(!unqualified.includes("CODING"));
    t.close();
  });

  test("a capability where every candidate model qualifies still recommends normally, unaffected by the threshold", () => {
    const t = createTestDb();
    seed(t.db, "gemma4:latest", "product-owner-basic", "product-owner", "PASS", 30000);
    const { generated, unqualified } = generateRecommendedRouting(t.db);
    const general = generated.find((r) => r.capability === "GENERAL");
    assert.equal(general?.model, "gemma4:latest");
    assert.equal(unqualified.length, 0);
    t.close();
  });
});
