import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { upsertModelRegistryEntry as rawUpsert, getModelRegistryEntry, recordModelHealthCheck, setModelEnabled, recordModelOutcome, setModelBenchmarkScore, setProviderEnabled, backfillStuckCircuitBreakers } from "../../domain/model-registry.ts";
import { selectFreeModel } from "../free-model-router.ts";

describe("selectFreeModel", () => {
  test("returns null when no model in the registry covers the required capability", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["REVIEW"] });
    assert.equal(selectFreeModel(t.db, { capability: "CODING" }), null);
    t.close();
  });

  test("a benchmark-qualified, healthy, high-success model outranks an unqualified/untested one for the same capability", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "strong", displayName: "strong", capabilities: ["CODING"] });
    upsertModelRegistryEntry(t.db, { provider: "gemini", modelId: "untested", displayName: "untested", capabilities: ["CODING"] });
    setModelBenchmarkScore(t.db, "groq", "strong", { score: 90, qualified: true });
    recordModelOutcome(t.db, "groq", "strong", { succeeded: true, latencyMs: 300 });
    recordModelOutcome(t.db, "groq", "strong", { succeeded: true, latencyMs: 300 });

    setModelBenchmarkScore(t.db, "gemini", "untested", { score: 0, qualified: false });
    const selection = selectFreeModel(t.db, { capability: "CODING" });
    assert.ok(selection);
    assert.equal(selection!.provider, "groq");
    assert.equal(selection!.modelId, "strong");
    assert.equal(selection!.candidates.length, 1, "unqualified models must be excluded");
    t.close();
  });

  test("a rate-limited (currently unavailable) model is excluded from candidates entirely", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "limited", displayName: "limited", capabilities: ["CODING"] });
    upsertModelRegistryEntry(t.db, { provider: "gemini", modelId: "ok", displayName: "ok", capabilities: ["CODING"] });
    recordModelOutcome(t.db, "groq", "limited", { succeeded: false, rateLimitedForMs: 60_000 });

    const selection = selectFreeModel(t.db, { capability: "CODING" });
    assert.ok(selection);
    assert.equal(selection!.provider, "gemini");
    assert.equal(selection!.candidates.some((c) => c.provider === "groq"), false);
    t.close();
  });

  test("a disabled model is excluded", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["CODING"] });
    setModelEnabled(t.db, "groq", "m1", false);
    assert.equal(selectFreeModel(t.db, { capability: "CODING" }), null);
    t.close();
  });

  test("a model whose whole provider is disabled (provider_configs) is excluded even though the model row itself is enabled", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["CODING"] });
    setProviderEnabled(t.db, "groq", false);
    assert.equal(selectFreeModel(t.db, { capability: "CODING" }), null);
    t.close();
  });

  test("a model whose context window is smaller than the estimated input is excluded", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "small-ctx", displayName: "small-ctx", capabilities: ["CODING"], contextWindow: 1000 });
    upsertModelRegistryEntry(t.db, { provider: "gemini", modelId: "big-ctx", displayName: "big-ctx", capabilities: ["CODING"], contextWindow: 100_000 });

    const selection = selectFreeModel(t.db, { capability: "CODING", estimatedInputTokens: 5000 });
    assert.ok(selection);
    assert.equal(selection!.provider, "gemini");
    t.close();
  });

  test("the `avoid` set excludes specific already-tried candidates from the ranked list", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["CODING"] });
    upsertModelRegistryEntry(t.db, { provider: "gemini", modelId: "m2", displayName: "m2", capabilities: ["CODING"] });

    const selection = selectFreeModel(t.db, { capability: "CODING", avoid: new Set(["groq:m1"]) });
    assert.ok(selection);
    assert.equal(selection!.provider, "gemini");
    assert.equal(selection!.candidates.length, 1);
    t.close();
  });

  test("every candidate is free — no cost term appears anywhere in the ranked result", () => {
    const t = createTestDb();
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["GENERAL"] });
    const selection = selectFreeModel(t.db, { capability: "GENERAL" })!;
    assert.ok(!("cost" in selection.candidates[0]!));
    t.close();
  });
});

function upsertModelRegistryEntry(...args: Parameters<typeof rawUpsert>) {
  const [db, entry] = args;
  process.env[`${entry.provider.toUpperCase()}_API_KEY`] = "test-key";
  process.env[`AI_OFFICE_${entry.provider.toUpperCase()}_FREE_TIER_CONFIRMED`] = "true";
  const key = `AI_OFFICE_${entry.provider.toUpperCase()}_FREE_MODELS`;
  process.env[key] = [process.env[key], entry.modelId].filter(Boolean).join(",");
  const result = rawUpsert(db, { ...entry, structuredOutput: true,
    capabilities: [...new Set([...entry.capabilities, "REASONING" as const, "STRUCTURED_OUTPUT" as const])] });
  recordModelHealthCheck(db, entry.provider, entry.modelId, { health: "HEALTHY" });
  setModelBenchmarkScore(db, entry.provider, entry.modelId, { score: 60, qualified: true });
  return result;
}

 test("cooldown recovery preserves three-failure protection and independent fallback", () => {
  const t = createTestDb();
  try {
   for (const modelId of ["recovering", "alternate"]) upsertModelRegistryEntry(t.db, {provider:"groq", modelId, displayName:modelId, capabilities:["CODING"]});
   recordModelOutcome(t.db,"groq","recovering",{succeeded:false,rateLimitedForMs:60000});
   assert.equal(selectFreeModel(t.db,{capability:"CODING"})?.modelId,"alternate");
   t.db.prepare("UPDATE model_registry SET rateLimitedUntil = ? WHERE modelId = ?").run(Date.now()-1,"recovering");
   assert.ok(selectFreeModel(t.db,{capability:"CODING"})?.candidates.some(c=>c.modelId==="recovering"));
   recordModelOutcome(t.db,"groq","recovering",{succeeded:false});
   recordModelOutcome(t.db,"groq","recovering",{succeeded:false});
   assert.ok(!selectFreeModel(t.db,{capability:"CODING"})?.candidates.some(c=>c.modelId==="recovering"));
   recordModelOutcome(t.db,"groq","alternate",{succeeded:false,rateLimitedForMs:60000});
   assert.equal(selectFreeModel(t.db,{capability:"CODING"}),null);
  } finally {t.close();}
 });

 // Real incident, production (2026-11-26): the three-failure gate itself
 // never set a real cooldown, only a rate-limit did — the owner has
 // explicitly authorized bounded automatic recovery for this case too.
 test("once the circuit-breaker's own cooldown passes, the model is eligible for a recovery probe again — end to end through the real router", () => {
  const t = createTestDb();
  try {
   upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "tripped", displayName: "tripped", capabilities: ["CODING"] });
   recordModelOutcome(t.db, "groq", "tripped", { succeeded: false });
   recordModelOutcome(t.db, "groq", "tripped", { succeeded: false });
   recordModelOutcome(t.db, "groq", "tripped", { succeeded: false });
   assert.equal(selectFreeModel(t.db, { capability: "CODING" }), null, "excluded while the circuit-breaker cooldown is still in the future");

   t.db.prepare("UPDATE model_registry SET rateLimitedUntil = ? WHERE modelId = ?").run(Date.now() - 1, "tripped");
   assert.ok(selectFreeModel(t.db, { capability: "CODING" })?.candidates.some((c) => c.modelId === "tripped"), "a single recovery probe is allowed once the real cooldown this time passes");

   recordModelOutcome(t.db, "groq", "tripped", { succeeded: true });
   const reg = getModelRegistryEntry(t.db, "groq", "tripped")!;
   assert.equal(reg.health, "HEALTHY");
   assert.equal(reg.recentFailureCount, 0);
   assert.ok(selectFreeModel(t.db, { capability: "CODING" })?.candidates.some((c) => c.modelId === "tripped"), "fully recovered and eligible with no cooldown pending");
  } finally {
   t.close();
  }
 });

 // Real incident, production (2026-11-27), found recovering the real
 // blocked Pomodoro project: a model already stuck at recentFailureCount
 // 3 with no cooldown from BEFORE the circuit breaker existed is excluded
 // forever, since recordModelOutcome (the only place that ever sets a
 // cooldown) never runs again for a model scoreModel() never selects.
 // backfillStuckCircuitBreakers must make such a model a real, eligible
 // router candidate again once its retroactively-applied cooldown passes.
 test("a model already stuck at the 3-failure gate with no cooldown (a pre-circuit-breaker lockout) becomes a real router candidate again once backfillStuckCircuitBreakers' cooldown passes", () => {
  const t = createTestDb();
  try {
   upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "stuck", displayName: "stuck", capabilities: ["CODING"] });
   t.db.prepare("UPDATE model_registry SET health = 'UNAVAILABLE', recentFailureCount = 3, rateLimitedUntil = NULL WHERE modelId = 'stuck'").run();
   assert.equal(selectFreeModel(t.db, { capability: "CODING" }), null, "a real pre-existing stuck lockout: never selected, exactly like the live incident");

   const applied = backfillStuckCircuitBreakers(t.db);
   assert.equal(applied.length, 1);
   assert.equal(selectFreeModel(t.db, { capability: "CODING" }), null, "still excluded — the backfilled cooldown is in the future, same as a fresh trip would be");

   t.db.prepare("UPDATE model_registry SET rateLimitedUntil = ? WHERE modelId = 'stuck'").run(Date.now() - 1);
   assert.ok(selectFreeModel(t.db, { capability: "CODING" })?.candidates.some((c) => c.modelId === "stuck"), "a real, eligible recovery-probe candidate once the backfilled cooldown has passed");
  } finally {
   t.close();
  }
 });
