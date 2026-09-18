import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import {
  upsertModelRegistryEntry,
  getModelRegistryEntry,
  listModelRegistryEntries,
  setModelEnabled,
  recordModelHealthCheck,
  recordModelOutcome,
  setModelBenchmarkScore,
  isProviderEnabled,
  setProviderEnabled,
  recordRoutingDecision,
  listRoutingDecisions,
} from "../model-registry.ts";

describe("model_registry persistence", () => {
  test("upsert creates a row; a second upsert refreshes metadata without resetting live state", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["CODING"] });
    recordModelOutcome(t.db, "groq", "m1", { succeeded: true, latencyMs: 500 });

    const afterOutcome = getModelRegistryEntry(t.db, "groq", "m1")!;
    assert.equal(afterOutcome.tasksCompleted, 1);

    // Re-sync with a display name change — live state (tasksCompleted) must survive.
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1 (updated)", capabilities: ["CODING", "REVIEW"] });
    const afterResync = getModelRegistryEntry(t.db, "groq", "m1")!;
    assert.equal(afterResync.displayName, "m1 (updated)");
    assert.deepEqual(JSON.parse(afterResync.capabilities), ["CODING", "REVIEW"]);
    assert.equal(afterResync.tasksCompleted, 1, "live state must not reset on a metadata-only resync");
    t.close();
  });

  test("setModelEnabled toggles a specific model without affecting others", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["CODING"] });
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m2", displayName: "m2", capabilities: ["CODING"] });
    setModelEnabled(t.db, "groq", "m1", false);

    assert.equal(getModelRegistryEntry(t.db, "groq", "m1")!.enabled, 0);
    assert.equal(getModelRegistryEntry(t.db, "groq", "m2")!.enabled, 1);
    assert.deepEqual(
      listModelRegistryEntries(t.db, { enabledOnly: true }).map((r) => r.modelId),
      ["m2"],
    );
    t.close();
  });

  test("recordModelOutcome tracks success/failure counts, resets recentFailureCount on success, degrades health after repeated failures", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["CODING"] });

    recordModelOutcome(t.db, "groq", "m1", { succeeded: false, latencyMs: 100 });
    recordModelOutcome(t.db, "groq", "m1", { succeeded: false, latencyMs: 100 });
    recordModelOutcome(t.db, "groq", "m1", { succeeded: false, latencyMs: 100 });
    let row = getModelRegistryEntry(t.db, "groq", "m1")!;
    assert.equal(row.tasksFailed, 3);
    assert.equal(row.recentFailureCount, 3);
    assert.equal(row.health, "UNAVAILABLE");

    recordModelOutcome(t.db, "groq", "m1", { succeeded: true, latencyMs: 100 });
    row = getModelRegistryEntry(t.db, "groq", "m1")!;
    assert.equal(row.tasksCompleted, 1);
    assert.equal(row.recentFailureCount, 0, "a success resets the consecutive-failure streak");
    assert.equal(row.health, "HEALTHY");
    t.close();
  });

  test("a rate-limited outcome marks the model UNAVAILABLE with a future rateLimitedUntil", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["CODING"] });
    const before = Date.now();
    recordModelOutcome(t.db, "groq", "m1", { succeeded: false, rateLimitedForMs: 60_000 });
    const row = getModelRegistryEntry(t.db, "groq", "m1")!;
    assert.equal(row.health, "UNAVAILABLE");
    assert.ok(row.rateLimitedUntil! >= before + 60_000 - 1000);
    t.close();
  });

  test("recordModelHealthCheck and setModelBenchmarkScore update their respective fields only", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "gemini", modelId: "g1", displayName: "g1", capabilities: ["GENERAL"] });
    recordModelHealthCheck(t.db, "gemini", "g1", { health: "HEALTHY", latencyMs: 250 });
    setModelBenchmarkScore(t.db, "gemini", "g1", { score: 83, qualified: true });

    const row = getModelRegistryEntry(t.db, "gemini", "g1")!;
    assert.equal(row.health, "HEALTHY");
    assert.equal(row.avgLatencyMs, 250);
    assert.equal(row.benchmarkScore, 83);
    assert.equal(row.qualified, 1);
    t.close();
  });

  test("provider_configs: no row means enabled by default; setProviderEnabled(false) is respected", () => {
    const t = createTestDb();
    assert.equal(isProviderEnabled(t.db, "groq"), true);
    setProviderEnabled(t.db, "groq", false);
    assert.equal(isProviderEnabled(t.db, "groq"), false);
    setProviderEnabled(t.db, "groq", true);
    assert.equal(isProviderEnabled(t.db, "groq"), true);
    t.close();
  });

  test("model_routing_decisions round-trips a full record and lists most-recent-first", () => {
    const t = createTestDb();
    recordRoutingDecision(t.db, {
      roleId: "frontend-developer",
      requiredCapability: "CODING",
      candidateModels: [{ provider: "groq", modelId: "m1", score: 80 }],
      selectedProvider: "groq",
      selectedModel: "m1",
      selectionReason: "highest score",
      attempts: 1,
      result: "SUCCEEDED",
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0,
    });
    const rows = listRoutingDecisions(t.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.selectedModel, "m1");
    assert.deepEqual(JSON.parse(rows[0]!.candidateModels), [{ provider: "groq", modelId: "m1", score: 80 }]);
    t.close();
  });
});
