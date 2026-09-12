import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { setProjectModelPolicy, upsertRecommendedRouting, applyRecommendedRouting } from "../../domain/model-routing.ts";
import { LocalModelRouter, ModelUnavailableError, capabilityForRole } from "../model-router.ts";
import { NO_QUALIFIED_MODEL } from "../../benchmark/routing-recommendation.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id, provider: "ollama" });
  return project;
}

const BOTH_INSTALLED = ["gemma4:latest", "qwen3.6:latest"];

describe("capabilityForRole", () => {
  test("maps every known role to a capability", () => {
    assert.equal(capabilityForRole("frontend-developer"), "CODING");
    assert.equal(capabilityForRole("backend-developer"), "CODING");
    assert.equal(capabilityForRole("solution-architect"), "REASONING");
    assert.equal(capabilityForRole("code-reviewer"), "REVIEW");
    assert.equal(capabilityForRole("qa-agent"), "REVIEW");
    assert.equal(capabilityForRole("release-agent"), "FAST");
    assert.equal(capabilityForRole("product-owner"), "GENERAL");
  });

  test("an unknown role falls back to GENERAL rather than throwing", () => {
    assert.equal(capabilityForRole("some-future-role-nobody-has-added-yet"), "GENERAL");
  });
});

describe("LocalModelRouter — AUTO policy (default)", () => {
  test("picks the first installed model in the capability's default chain", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const router = new LocalModelRouter(t.db);
    const result = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    assert.equal(result.model, "gemma4:latest");
    assert.equal(result.capability, "CODING");
    assert.match(result.reason, /default local CODING preference chain/i);
    t.close();
  });

  test("falls back to whatever IS installed when neither chain entry is present", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const router = new LocalModelRouter(t.db);
    const result = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: ["some-other-model:latest"] });
    assert.equal(result.model, "some-other-model:latest");
    assert.match(result.reason, /falling back to the only\/first installed local model/i);
    t.close();
  });

  test("throws when no local models are installed at all — never silently proceeds with nothing", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const router = new LocalModelRouter(t.db);
    assert.throws(() => router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: [] }), ModelUnavailableError);
    t.close();
  });

  test("an applied benchmark recommendation for the role's capability takes priority over the default chain", () => {
    const t = createTestDb();
    const project = setupProject(t);
    upsertRecommendedRouting(t.db, { capability: "CODING", model: "qwen3.6:latest", reason: "highest coding/bug-fix success in benchmark" });
    applyRecommendedRouting(t.db);

    const router = new LocalModelRouter(t.db);
    const result = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    assert.equal(result.model, "qwen3.6:latest");
    assert.match(result.reason, /benchmark-derived recommended routing/i);
    t.close();
  });

  test("an UN-applied recommendation (generated but not approved) is ignored — production routing never changes silently", () => {
    const t = createTestDb();
    const project = setupProject(t);
    upsertRecommendedRouting(t.db, { capability: "CODING", model: "qwen3.6:latest", reason: "not yet approved" });
    // Deliberately no applyRecommendedRouting() call.

    const router = new LocalModelRouter(t.db);
    const result = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    assert.equal(result.model, "gemma4:latest", "must still use the default chain, not the un-applied recommendation");
    t.close();
  });

  test("a recommended model that's applied but no longer installed falls back to the default chain instead of throwing", () => {
    const t = createTestDb();
    const project = setupProject(t);
    upsertRecommendedRouting(t.db, { capability: "CODING", model: "no-longer-installed:latest", reason: "stale" });
    applyRecommendedRouting(t.db);

    const router = new LocalModelRouter(t.db);
    const result = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    assert.equal(result.model, "gemma4:latest");
    t.close();
  });

  test("an applied NO_QUALIFIED_MODEL recommendation (Part 11) falls back to the default chain — the owner's configured fallback still applies", () => {
    const t = createTestDb();
    const project = setupProject(t);
    upsertRecommendedRouting(t.db, { capability: "CODING", model: NO_QUALIFIED_MODEL, reason: "No locally-tested model met the 50% minimum success threshold." });
    applyRecommendedRouting(t.db);

    const router = new LocalModelRouter(t.db);
    const result = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    assert.equal(result.model, "gemma4:latest", "the sentinel is never a real installed model, so AUTO falls back to the default chain, never crashes or fabricates a model");
    t.close();
  });
});

describe("LocalModelRouter — SINGLE_MODEL policy", () => {
  test("every role uses the one owner-selected model", () => {
    const t = createTestDb();
    const project = setupProject(t);
    setProjectModelPolicy(t.db, project.id, { mode: "SINGLE_MODEL", singleModel: "qwen3.6:latest", customMapping: null });

    const router = new LocalModelRouter(t.db);
    for (const role of ["product-owner", "frontend-developer", "code-reviewer", "release-agent"]) {
      const result = router.selectModel({ role, project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
      assert.equal(result.model, "qwen3.6:latest");
      assert.match(result.reason, /SINGLE_MODEL policy/i);
    }
    t.close();
  });

  test("throws rather than silently substituting when the pinned model isn't installed", () => {
    const t = createTestDb();
    const project = setupProject(t);
    setProjectModelPolicy(t.db, project.id, { mode: "SINGLE_MODEL", singleModel: "not-installed:latest", customMapping: null });

    const router = new LocalModelRouter(t.db);
    assert.throws(
      () => router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED }),
      ModelUnavailableError,
    );
    t.close();
  });
});

describe("LocalModelRouter — CUSTOM policy", () => {
  test("a role with an explicit mapping uses it", () => {
    const t = createTestDb();
    const project = setupProject(t);
    setProjectModelPolicy(t.db, project.id, {
      mode: "CUSTOM",
      singleModel: null,
      customMapping: { "frontend-developer": "qwen3.6:latest" },
    });

    const router = new LocalModelRouter(t.db);
    const result = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    assert.equal(result.model, "qwen3.6:latest");
    assert.match(result.reason, /CUSTOM policy/i);
    t.close();
  });

  test("a role with no explicit mapping falls through to normal AUTO/default-chain behavior", () => {
    const t = createTestDb();
    const project = setupProject(t);
    setProjectModelPolicy(t.db, project.id, {
      mode: "CUSTOM",
      singleModel: null,
      customMapping: { "frontend-developer": "qwen3.6:latest" },
    });

    const router = new LocalModelRouter(t.db);
    const result = router.selectModel({ role: "code-reviewer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    assert.equal(result.model, "gemma4:latest");
    assert.match(result.reason, /default local REVIEW preference chain/i);
    t.close();
  });

  test("throws rather than silently substituting when a mapped role's model isn't installed", () => {
    const t = createTestDb();
    const project = setupProject(t);
    setProjectModelPolicy(t.db, project.id, {
      mode: "CUSTOM",
      singleModel: null,
      customMapping: { "frontend-developer": "not-installed:latest" },
    });

    const router = new LocalModelRouter(t.db);
    assert.throws(
      () => router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED }),
      ModelUnavailableError,
    );
    t.close();
  });
});

describe("LocalModelRouter — semantic retry model escalation (Part M)", () => {
  test("a semantic failure on attempt 2 escalates past the model that just failed", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const router = new LocalModelRouter(t.db);

    const first = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    assert.equal(first.model, "gemma4:latest");

    const second = router.selectModel({
      role: "frontend-developer",
      project,
      attemptNumber: 2,
      availableModels: BOTH_INSTALLED,
      failureContext: { isSemanticFailure: true, previousModel: first.model },
    });
    assert.equal(second.model, "qwen3.6:latest");
    assert.match(second.reason, /escalated from "gemma4:latest"/i);
    t.close();
  });

  test("an operational (non-semantic) failure does NOT escalate — the same model is selected again", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const router = new LocalModelRouter(t.db);

    const first = router.selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels: BOTH_INSTALLED });
    const second = router.selectModel({
      role: "frontend-developer",
      project,
      attemptNumber: 2,
      availableModels: BOTH_INSTALLED,
      failureContext: { isSemanticFailure: false, previousModel: first.model },
    });
    assert.equal(second.model, first.model, "an operational hiccup must not trigger model escalation");
    t.close();
  });

  test("escalation exhausted (only one installed model beyond the one that already failed does not exist) stays on the strongest available option rather than looping", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const router = new LocalModelRouter(t.db);

    // Only one model installed — nothing to escalate TO, so a semantic
    // failure must not throw or produce no model; it stays on the only
    // option available.
    const result = router.selectModel({
      role: "frontend-developer",
      project,
      attemptNumber: 2,
      availableModels: ["gemma4:latest"],
      failureContext: { isSemanticFailure: true, previousModel: "gemma4:latest" },
    });
    assert.equal(result.model, "gemma4:latest");
    t.close();
  });

  test("SINGLE_MODEL policy is never escalated — the owner's pinned model is used even after a semantic failure", () => {
    const t = createTestDb();
    const project = setupProject(t);
    setProjectModelPolicy(t.db, project.id, { mode: "SINGLE_MODEL", singleModel: "gemma4:latest", customMapping: null });
    const router = new LocalModelRouter(t.db);

    const result = router.selectModel({
      role: "frontend-developer",
      project,
      attemptNumber: 2,
      availableModels: BOTH_INSTALLED,
      failureContext: { isSemanticFailure: true, previousModel: "gemma4:latest" },
    });
    assert.equal(result.model, "gemma4:latest", "SINGLE_MODEL is an explicit owner choice — escalation must never override it");
    t.close();
  });
});
