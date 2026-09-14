import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../users.ts";
import { createProjectWithIdea } from "../projects.ts";
import {
  getProjectModelPolicy,
  setProjectModelPolicy,
  recordBenchmarkResult,
  listBenchmarkResults,
  listBenchmarkedModels,
  upsertRecommendedRouting,
  listRecommendedRouting,
  applyRecommendedRouting,
  getAppliedRouting,
} from "../model-routing.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  return project;
}

describe("project model policy", () => {
  test("defaults to AUTO with no overrides for a freshly-created project", () => {
    const t = createTestDb();
    const project = setupProject(t);
    assert.deepEqual(getProjectModelPolicy(t.db, project.id), { mode: "AUTO", singleModel: null, customMapping: null });
    t.close();
  });

  test("SINGLE_MODEL round-trips the chosen model", () => {
    const t = createTestDb();
    const project = setupProject(t);
    setProjectModelPolicy(t.db, project.id, { mode: "SINGLE_MODEL", singleModel: "qwen3.6:latest", customMapping: null });
    assert.deepEqual(getProjectModelPolicy(t.db, project.id), { mode: "SINGLE_MODEL", singleModel: "qwen3.6:latest", customMapping: null });
    t.close();
  });

  test("CUSTOM round-trips a role->model mapping", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const customMapping = { "frontend-developer": "qwen3.6:latest", "code-reviewer": "gemma4:latest" };
    setProjectModelPolicy(t.db, project.id, { mode: "CUSTOM", singleModel: null, customMapping });
    assert.deepEqual(getProjectModelPolicy(t.db, project.id), { mode: "CUSTOM", singleModel: null, customMapping });
    t.close();
  });

  test("rejects an invalid mode rather than persisting it", () => {
    const t = createTestDb();
    const project = setupProject(t);
    assert.throws(() => setProjectModelPolicy(t.db, project.id, { mode: "NOT_A_REAL_MODE" as never, singleModel: null, customMapping: null }));
    t.close();
  });

  test("a nonexistent project returns the safe AUTO default rather than throwing", () => {
    const t = createTestDb();
    assert.deepEqual(getProjectModelPolicy(t.db, "does-not-exist"), { mode: "AUTO", singleModel: null, customMapping: null });
    t.close();
  });
});

describe("benchmark_results", () => {
  test("recordBenchmarkResult persists every field and round-trips booleans as 0/1", () => {
    const t = createTestDb();
    const result = recordBenchmarkResult(t.db, {
      model: "gemma4:latest",
      scenarioId: "frontend-bug-fix",
      roleId: "frontend-developer",
      status: "FAIL",
      score: 20,
      latencyMs: 45000,
      promptTokens: 500,
      outputTokens: 200,
      retries: 1,
      timedOut: false,
      malformedJson: true,
      intentConsistencyOutcome: "consistent",
      fileOperationValid: true,
      qaResult: "FAIL",
      defectDiagnosed: false,
      matchesRequest: true,
      details: { note: "did not add the missing <script> tag" },
    });
    assert.equal(result.model, "gemma4:latest");
    assert.equal(result.status, "FAIL");
    assert.equal(result.malformedJson, 1);
    assert.equal(result.timedOut, 0);
    assert.equal(result.defectDiagnosed, 0);
    assert.equal(result.fileOperationValid, 1);
    assert.ok(result.details?.includes("script"));
    t.close();
  });

  test("listBenchmarkResults filters by model and scenario independently", () => {
    const t = createTestDb();
    recordBenchmarkResult(t.db, { model: "gemma4:latest", scenarioId: "product-owner-basic", roleId: "product-owner", status: "PASS", score: 90, latencyMs: 1000 });
    recordBenchmarkResult(t.db, { model: "qwen3.6:latest", scenarioId: "product-owner-basic", roleId: "product-owner", status: "PASS", score: 95, latencyMs: 2000 });
    recordBenchmarkResult(t.db, { model: "gemma4:latest", scenarioId: "frontend-bug-fix", roleId: "frontend-developer", status: "FAIL", score: 10, latencyMs: 3000 });

    assert.equal(listBenchmarkResults(t.db, { model: "gemma4:latest" }).length, 2);
    assert.equal(listBenchmarkResults(t.db, { scenarioId: "product-owner-basic" }).length, 2);
    assert.equal(listBenchmarkResults(t.db, { model: "gemma4:latest", scenarioId: "frontend-bug-fix" }).length, 1);
    assert.equal(listBenchmarkResults(t.db).length, 3);
    t.close();
  });

  test("listBenchmarkedModels returns every distinct benchmarked model", () => {
    const t = createTestDb();
    recordBenchmarkResult(t.db, { model: "gemma4:latest", scenarioId: "s1", roleId: "product-owner", status: "PASS", score: 90, latencyMs: 1000 });
    recordBenchmarkResult(t.db, { model: "qwen3.6:latest", scenarioId: "s1", roleId: "product-owner", status: "PASS", score: 95, latencyMs: 2000 });
    recordBenchmarkResult(t.db, { model: "gemma4:latest", scenarioId: "s2", roleId: "frontend-developer", status: "PASS", score: 80, latencyMs: 1500 });
    const models = listBenchmarkedModels(t.db);
    assert.deepEqual([...models].sort(), ["gemma4:latest", "qwen3.6:latest"]);
    t.close();
  });
});

describe("recommended_model_routing", () => {
  test("upsertRecommendedRouting creates then updates the same capability's recommendation, resetting appliedAt on every regeneration", () => {
    const t = createTestDb();
    const first = upsertRecommendedRouting(t.db, { capability: "CODING", model: "gemma4:latest", reason: "only option benchmarked so far" });
    assert.equal(first.model, "gemma4:latest");
    assert.equal(first.appliedAt, null);

    applyRecommendedRouting(t.db);
    assert.ok(getAppliedRouting(t.db).some((r) => r.capability === "CODING"));

    const second = upsertRecommendedRouting(t.db, { capability: "CODING", model: "qwen3.6:latest", reason: "higher coding/bug-fix score" });
    assert.equal(second.model, "qwen3.6:latest");
    assert.equal(second.appliedAt, null, "regenerating a recommendation must never silently keep it applied");
    assert.equal(getAppliedRouting(t.db).length, 0, "an un-approved recommendation must not appear as applied");

    t.close();
  });

  test("applyRecommendedRouting only ever runs when the owner explicitly calls it — never implicitly", () => {
    const t = createTestDb();
    upsertRecommendedRouting(t.db, { capability: "GENERAL", model: "gemma4:latest", reason: "x" });
    assert.equal(getAppliedRouting(t.db).length, 0);

    const applied = applyRecommendedRouting(t.db);
    assert.equal(applied.length, 1);
    assert.ok(applied[0]!.appliedAt !== null);
    assert.equal(getAppliedRouting(t.db).length, 1);

    t.close();
  });

  test("listRecommendedRouting returns every capability's current recommendation regardless of applied state", () => {
    const t = createTestDb();
    upsertRecommendedRouting(t.db, { capability: "GENERAL", model: "gemma4:latest", reason: "x" });
    upsertRecommendedRouting(t.db, { capability: "CODING", model: "qwen3.6:latest", reason: "y" });
    assert.equal(listRecommendedRouting(t.db).length, 2);
    t.close();
  });
});
