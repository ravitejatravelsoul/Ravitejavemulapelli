import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { upsertRecommendedRouting, applyRecommendedRouting } from "../../domain/model-routing.ts";
import { routeProvider } from "../provider-router.ts";

describe("routeProvider", () => {
  test("LOCAL_ONLY always routes LOCAL, regardless of capability evidence", () => {
    const t = createTestDb();
    upsertRecommendedRouting(t.db, { capability: "CODING", model: "NO QUALIFIED LOCAL MODEL", reason: "nothing qualifies" });
    applyRecommendedRouting(t.db);

    const decision = routeProvider(t.db, { role: "frontend-developer", project: { aiPolicyMode: "LOCAL_ONLY" } });
    assert.equal(decision.provider, "LOCAL");
    t.close();
  });

  test("CLAUDE_ONLY always routes CLAUDE, regardless of capability evidence", () => {
    const t = createTestDb();
    const decision = routeProvider(t.db, { role: "product-owner", project: { aiPolicyMode: "CLAUDE_ONLY" } });
    assert.equal(decision.provider, "CLAUDE");
    t.close();
  });

  test("HYBRID + no applied recommendation for the capability defaults to LOCAL (never guesses Claude for untested capabilities)", () => {
    const t = createTestDb();
    const decision = routeProvider(t.db, { role: "product-owner", project: { aiPolicyMode: "HYBRID" } });
    assert.equal(decision.provider, "LOCAL");
    assert.equal(decision.capability, "GENERAL");
    t.close();
  });

  test("HYBRID + an applied real local model recommendation for the capability routes LOCAL", () => {
    const t = createTestDb();
    upsertRecommendedRouting(t.db, { capability: "REVIEW", model: "qwen2.5-coder:3b", reason: "50% success, fastest" });
    applyRecommendedRouting(t.db);

    const decision = routeProvider(t.db, { role: "code-reviewer", project: { aiPolicyMode: "HYBRID" } });
    assert.equal(decision.provider, "LOCAL");
    assert.equal(decision.capability, "REVIEW");
    t.close();
  });

  test("HYBRID + an applied NO_QUALIFIED_MODEL recommendation for the capability routes CLAUDE — the exact real CODING evidence", () => {
    const t = createTestDb();
    upsertRecommendedRouting(t.db, { capability: "CODING", model: "NO QUALIFIED LOCAL MODEL", reason: "gemma4/qwen3.6/qwen2.5-coder all 0%" });
    applyRecommendedRouting(t.db);

    const decision = routeProvider(t.db, { role: "frontend-developer", project: { aiPolicyMode: "HYBRID" } });
    assert.equal(decision.provider, "CLAUDE");
    assert.equal(decision.capability, "CODING");
    t.close();
  });

  test("HYBRID + backend-developer (also CODING) routes identically to frontend-developer", () => {
    const t = createTestDb();
    upsertRecommendedRouting(t.db, { capability: "CODING", model: "NO QUALIFIED LOCAL MODEL", reason: "nothing qualifies" });
    applyRecommendedRouting(t.db);

    const decision = routeProvider(t.db, { role: "backend-developer", project: { aiPolicyMode: "HYBRID" } });
    assert.equal(decision.provider, "CLAUDE");
    t.close();
  });

  test("HYBRID + a generated-but-not-applied NO_QUALIFIED_MODEL recommendation is ignored — still routes LOCAL until the owner applies it", () => {
    const t = createTestDb();
    upsertRecommendedRouting(t.db, { capability: "CODING", model: "NO QUALIFIED LOCAL MODEL", reason: "nothing qualifies" });
    // Deliberately no applyRecommendedRouting() call.

    const decision = routeProvider(t.db, { role: "frontend-developer", project: { aiPolicyMode: "HYBRID" } });
    assert.equal(decision.provider, "LOCAL", "an un-applied recommendation must never silently change real routing");
    t.close();
  });
});

describe("routeProvider — AI_OFFICE_CLAUDE_ENABLED kill-switch (free multi-model orchestration phase)", () => {
  test("AI_OFFICE_CLAUDE_ENABLED=false forces LOCAL even for CLAUDE_ONLY — proves Claude can never be selected while disabled", () => {
    const original = process.env.AI_OFFICE_CLAUDE_ENABLED;
    process.env.AI_OFFICE_CLAUDE_ENABLED = "false";
    try {
      const t = createTestDb();
      const decision = routeProvider(t.db, { role: "product-owner", project: { aiPolicyMode: "CLAUDE_ONLY" } });
      assert.equal(decision.provider, "LOCAL");
      assert.match(decision.reason, /AI_OFFICE_CLAUDE_ENABLED=false/);
      t.close();
    } finally {
      if (original === undefined) delete process.env.AI_OFFICE_CLAUDE_ENABLED;
      else process.env.AI_OFFICE_CLAUDE_ENABLED = original;
    }
  });

  test("AI_OFFICE_CLAUDE_ENABLED=false forces LOCAL even for HYBRID with a real NO_QUALIFIED_MODEL applied recommendation (the one case that would otherwise route CLAUDE)", () => {
    const original = process.env.AI_OFFICE_CLAUDE_ENABLED;
    process.env.AI_OFFICE_CLAUDE_ENABLED = "false";
    try {
      const t = createTestDb();
      upsertRecommendedRouting(t.db, { capability: "CODING", model: "NO QUALIFIED LOCAL MODEL", reason: "nothing qualifies" });
      applyRecommendedRouting(t.db);
      const decision = routeProvider(t.db, { role: "frontend-developer", project: { aiPolicyMode: "HYBRID" } });
      assert.equal(decision.provider, "LOCAL");
      t.close();
    } finally {
      if (original === undefined) delete process.env.AI_OFFICE_CLAUDE_ENABLED;
      else process.env.AI_OFFICE_CLAUDE_ENABLED = original;
    }
  });

  test("omitting AI_OFFICE_CLAUDE_ENABLED (or setting it to anything other than the literal string 'false') preserves the existing, already-approved CLAUDE_ONLY behavior", () => {
    const original = process.env.AI_OFFICE_CLAUDE_ENABLED;
    delete process.env.AI_OFFICE_CLAUDE_ENABLED;
    try {
      const t = createTestDb();
      const decision = routeProvider(t.db, { role: "product-owner", project: { aiPolicyMode: "CLAUDE_ONLY" } });
      assert.equal(decision.provider, "CLAUDE");
      t.close();
    } finally {
      if (original === undefined) delete process.env.AI_OFFICE_CLAUDE_ENABLED;
      else process.env.AI_OFFICE_CLAUDE_ENABLED = original;
    }
  });
});
