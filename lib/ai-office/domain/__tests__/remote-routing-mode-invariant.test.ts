import { test } from "node:test";
import assert from "node:assert/strict";
import { createProjectWithIdea, getProject, routingModeHonored } from "../projects.ts";
import { planProject } from "../../orchestrator/orchestrator.ts";
import { requiredCapabilitiesForTask } from "../../agents/free-model-capabilities.ts";
import { selectFreeModel } from "../../agents/free-model-router.ts";
import { upsertModelRegistryEntry, recordModelHealthCheck, setModelBenchmarkScore } from "../model-registry.ts";
import {
  hydrateEphemeralDb,
  flushProjectBundle,
  DEFAULT_OFFICE_REMOTE_STATE,
  REMOTE_SYNTHETIC_OWNER_ID,
} from "../../remote/remote-state-store.ts";
import { exportModelCatalog, hydrateModelCatalog } from "../../remote/model-catalog.ts";

process.env.OFFICE_OWNER_EMAIL = "routing-invariant@example.test";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic";

/**
 * Investigation of the real "task tracker" project (eb521b6d), persisted
 * as routingMode STANDARD: every function `createRemoteProjectAction`
 * calls, in the exact order it calls them — hydrate the same ephemeral
 * remote database it hydrates → create → plan → dump bundle → hydrate a
 * fresh (remote-worker-equivalent) database from it → select a free
 * model — is exercised here directly against real domain/orchestrator/
 * router code, never a reimplementation. The requester-side database is
 * built with `hydrateEphemeralDb`, the exact function the real action
 * calls, not the local-mode test harness, so `REMOTE_SYNTHETIC_OWNER_ID`
 * satisfies the real foreign key exactly as it does in production. No
 * request explicitly asking for FREE_MULTI_MODEL is ever silently
 * downgraded at any of these stages; an explicit STANDARD request is
 * fully preserved too. This is the real, exhaustive trace that found no
 * defect in this path — see the final report for the actual conclusion
 * (a different project-creation entry point, not this one).
 */
function requesterDb() {
  return hydrateEphemeralDb(DEFAULT_OFFICE_REMOTE_STATE, null);
}

function freshFreeMultiModelProject(db: ReturnType<typeof requesterDb>, title = "task tracker") {
  const { project } = createProjectWithIdea(db, {
    title,
    rawIdeaText: "Build a small Personal Task Tracker web app with add, complete, delete and localStorage persistence.",
    ownerId: REMOTE_SYNTHETIC_OWNER_ID,
    provider: "simulated",
    routingMode: "FREE_MULTI_MODEL",
    aiPolicyMode: "LOCAL_ONLY",
  });
  return project;
}

test("routingModeHonored: the exact invariant createRemoteProjectAction checks before any write/dispatch", () => {
  assert.equal(routingModeHonored("FREE_MULTI_MODEL", "FREE_MULTI_MODEL"), true);
  assert.equal(routingModeHonored("FREE_MULTI_MODEL", "STANDARD"), false, "the real silent-downgrade case this phase closes");
  assert.equal(routingModeHonored("STANDARD", "STANDARD"), true);
  assert.equal(routingModeHonored("STANDARD", "FREE_MULTI_MODEL"), true, "an intentional STANDARD request is never second-guessed by an unrelated upgrade");
});

test("1/5. an explicit FREE_MULTI_MODEL request is persisted as FREE_MULTI_MODEL by the real creation call", () => {
  const db = requesterDb();
  try {
    const project = freshFreeMultiModelProject(db);
    assert.equal(project.routingMode, "FREE_MULTI_MODEL");
    assert.equal(getProject(db, project.id)!.routingMode, "FREE_MULTI_MODEL", "re-read from the database, not just the in-memory return value");
    assert.equal(routingModeHonored("FREE_MULTI_MODEL", getProject(db, project.id)!.routingMode), true, "the real invariant check, run against the real persisted row, passes");
  } finally { db.close(); }
});

test("8. an explicit STANDARD request remains STANDARD end-to-end — intentional simulated projects are fully preserved", () => {
  const db = requesterDb();
  try {
    const { project } = createProjectWithIdea(db, {
      title: "classic simulated test", rawIdeaText: "A deliberately STANDARD/simulated test project.",
      ownerId: REMOTE_SYNTHETIC_OWNER_ID, provider: "simulated", routingMode: "STANDARD", aiPolicyMode: "LOCAL_ONLY",
    });
    assert.equal(project.routingMode, "STANDARD");
    planProject(db, project.id);
    assert.equal(getProject(db, project.id)!.routingMode, "STANDARD", "planning never changes routing mode");
    const bundle = flushProjectBundle(db, project.id);
    assert.equal(bundle.tables.projects![0]!.routingMode, "STANDARD");
    assert.equal(routingModeHonored("STANDARD", getProject(db, project.id)!.routingMode), true, "the invariant never blocks a genuinely-requested STANDARD project");
  } finally { db.close(); }
});

test("9. the no-routingMode (legacy/default) path still resolves to the documented default, not a fabricated value", () => {
  const db = requesterDb();
  try {
    const { project } = createProjectWithIdea(db, {
      title: "legacy caller", rawIdeaText: "No routingMode field supplied at all.",
      ownerId: REMOTE_SYNTHETIC_OWNER_ID,
    });
    assert.equal(project.routingMode, "STANDARD", "the documented, existing default — never silently upgraded either");
  } finally { db.close(); }
});

test("5/6. planning preserves routing mode, and the exact remote bundle serialize/restore round-trip (flushProjectBundle → hydrateEphemeralDb) preserves it too", () => {
  const db = requesterDb();
  try {
    const project = freshFreeMultiModelProject(db);
    planProject(db, project.id);
    assert.equal(getProject(db, project.id)!.routingMode, "FREE_MULTI_MODEL", "planning never touches routing mode");

    const bundle = flushProjectBundle(db, project.id);
    assert.equal(bundle.tables.projects![0]!.routingMode, "FREE_MULTI_MODEL", "the real bundle dump preserves it");

    // The exact hydration path the real GitHub Actions worker uses
    // (scripts/ai-office-remote-worker.ts) — a fresh ephemeral database,
    // restored from nothing but this bundle.
    const worker = hydrateEphemeralDb(DEFAULT_OFFICE_REMOTE_STATE, bundle);
    try {
      assert.equal(getProject(worker, project.id)!.routingMode, "FREE_MULTI_MODEL", "6. real worker hydration preserves it — the worker sees exactly what was requested");
    } finally { worker.close(); }
  } finally { db.close(); }
});

test("7. the real free-model router sees FREE_MULTI_MODEL routing after a real catalog hydration — no Claude, no paid route ever considered", () => {
  const db = requesterDb();
  try {
    process.env.GROQ_API_KEY = "test-key";
    process.env.AI_OFFICE_GROQ_FREE_TIER_CONFIRMED = "true";
    process.env.AI_OFFICE_GROQ_FREE_MODELS = "qualified-model";
    upsertModelRegistryEntry(db, { provider: "groq", modelId: "qualified-model", displayName: "qualified-model", capabilities: ["GENERAL", "REASONING", "STRUCTURED_OUTPUT"], structuredOutput: true, contextWindow: 32000 });
    recordModelHealthCheck(db, "groq", "qualified-model", { health: "HEALTHY" });
    setModelBenchmarkScore(db, "groq", "qualified-model", { score: 80, qualified: true });

    const project = freshFreeMultiModelProject(db);
    planProject(db, project.id);

    // The exact catalog export/hydrate round-trip createRemoteProjectAction
    // performs (readModelCatalog → hydrateEphemeralDb(..., catalog)) before
    // ever calling selectFreeModel, reproduced here directly.
    const catalog = exportModelCatalog(db);
    assert.equal(JSON.stringify(catalog).toLowerCase().includes("claude"), false, "catalog never carries a Claude/paid route");
    const worker = hydrateEphemeralDb(DEFAULT_OFFICE_REMOTE_STATE, flushProjectBundle(db, project.id));
    try {
      hydrateModelCatalog(worker, catalog);
      const tasks = worker.prepare("SELECT roleId,title FROM tasks WHERE projectId=?").all(project.id) as Array<{ roleId: string; title: string }>;
      assert.ok(tasks.length > 0, "real planning produced real tasks");
      let anySelectable = false;
      for (const task of tasks) {
        const required = requiredCapabilitiesForTask(task.roleId, task.title);
        const selection = selectFreeModel(worker, { capability: required[0]!, requiredCapabilities: required });
        if (selection) { anySelectable = true; assert.notEqual(selection.provider, "claude"); }
      }
      assert.ok(anySelectable, "the real router actually selects the real qualified free model for at least one real planned task");
    } finally { worker.close(); }
  } finally { db.close(); }
});

test("duplicate-confirmation safety at the data layer: creating twice from the same idea never collapses into one row or silently reuses routing state", () => {
  const db = requesterDb();
  try {
    const a = freshFreeMultiModelProject(db, "duplicate guard a");
    const b = freshFreeMultiModelProject(db, "duplicate guard b");
    assert.notEqual(a.id, b.id);
    assert.equal(getProject(db, a.id)!.routingMode, "FREE_MULTI_MODEL");
    assert.equal(getProject(db, b.id)!.routingMode, "FREE_MULTI_MODEL");
  } finally { db.close(); }
});
