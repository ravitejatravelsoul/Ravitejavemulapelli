import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt, updateAgentRunStatus, updateTaskStatus, listTaskAttempts, getAgentRun } from "../../domain/tasks.ts";
import { listAiUsageForProject } from "../../domain/budget.ts";
import { upsertModelRegistryEntry as rawUpsert, recordModelHealthCheck, setModelBenchmarkScore } from "../../domain/model-registry.ts";
import { getWorkspace } from "../../domain/workspace.ts";
import { writeFile, createWorkspace } from "../../workspace/workspace-service.ts";
import { checkDeliverableIntentConsistency, executeTask } from "../agent-runner.ts";

/**
 * The mandatory QA intent-verification gate, execution-mode-aware fix —
 * a real GitHub Actions remote run of a FREE_MULTI_MODEL project always
 * failed this check before (GitHub Actions cannot reach the owner's
 * local Ollama at 127.0.0.1:11434). Exercised directly against the
 * exported gate function (the same convention `intent-consistency.test.ts`
 * already uses for the Ollama-only path), so every scenario below is
 * fast, deterministic and never touches a real network.
 */

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";
process.env.AI_OFFICE_CLAUDE_ENABLED = "false";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

// "verdict" mode (the real fix): the adapter returns the model's raw JSON
// text directly in `summary`, never wrapped in the full StructuredAgentOutput
// envelope — these mocks simulate exactly what a real provider now receives
// as instructions and sends back for a verdict call.
const groqChat = (verdict: unknown, usage = { prompt_tokens: 200, completion_tokens: 40 }) =>
  jsonResponse({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }], usage });

/** Fails loudly for any host other than Groq — the whole point of these tests: verification must never call Ollama/localhost. */
function guardedFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && /127\.0\.0\.1:11434|localhost:11434/.test(url)) {
      throw new Error("FORBIDDEN: intent verification called Ollama/localhost for a FREE_MULTI_MODEL project");
    }
    return handler(String(url), init);
  }) as unknown as typeof fetch;
}

function upsertReviewModel(db: ReturnType<typeof createTestDb>["db"], provider: "groq" | "gemini", modelId: string, score = 60) {
  process.env[`${provider.toUpperCase()}_API_KEY`] = "test-key";
  process.env[`AI_OFFICE_${provider.toUpperCase()}_FREE_TIER_CONFIRMED`] = "true";
  const key = `AI_OFFICE_${provider.toUpperCase()}_FREE_MODELS`;
  process.env[key] = [process.env[key], modelId].filter(Boolean).join(",");
  rawUpsert(db, { provider, modelId, displayName: modelId, capabilities: ["REVIEW", "STRUCTURED_OUTPUT"], structuredOutput: true });
  recordModelHealthCheck(db, provider, modelId, { health: "HEALTHY" });
  setModelBenchmarkScore(db, provider, modelId, { score, qualified: true });
}

function setup(routingMode: "FREE_MULTI_MODEL" | "STANDARD", provider: "simulated" | "ollama" = "simulated") {
  const t = createTestDb();
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, {
    title: "Intent Verifier Fixture",
    rawIdeaText: "A tiny deterministic fixture project.",
    ownerId: owner.id,
    provider,
    routingMode,
    aiPolicyMode: "CLAUDE_ONLY",
  });
  const task = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Verify frontend — Fixture" });
  const attempt = createTaskAttempt(t.db, task.id);
  const agentRun = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "qa-agent", provider: "simulated" });
  updateAgentRunStatus(t.db, agentRun.id, "SUCCEEDED", Date.now());
  return { t, project: getProject(t.db, project.id)!, agentRun, task };
}

/** Seeds a real, SUCCEEDED frontend-developer run so `latestDeliverableProducer` has something to prefer away from. */
function seedProducer(t: ReturnType<typeof createTestDb>, projectId: string, provider: string, modelId: string) {
  const devTask = createTask(t.db, { projectId, roleId: "frontend-developer", title: "Implement frontend — Fixture" });
  const devAttempt = createTaskAttempt(t.db, devTask.id);
  const devRun = createAgentRunForAttempt(t.db, { taskAttemptId: devAttempt.id, roleId: "frontend-developer", provider, model: modelId });
  updateAgentRunStatus(t.db, devRun.id, "SUCCEEDED", Date.now());
  updateTaskStatus(t.db, devTask.id, "DONE");
}

const REQUEST = "Build a simple counter page with an Increment button and a Reset button.";
const MATCHING_CANDIDATE = "Observed browser test: real heading, description and a working Increment/Reset button, no console errors.";

describe("checkDeliverableIntentConsistency — LOCAL (Ollama-provider project)", () => {
  test("an ollama-provider project's behavior is completely unchanged — still calls Ollama, never the free router", async () => {
    const { t, project, agentRun } = setup("STANDARD", "ollama");
    let ollamaCalled = false;
    const fetchImpl = (async (url: string) => {
      ollamaCalled = /127\.0\.0\.1:11434/.test(String(url));
      return jsonResponse({ response: JSON.stringify({ consistent: true, reason: "Matches the request." }) });
    }) as unknown as typeof fetch;
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { fetchImpl },
    );
    assert.equal(ollamaCalled, true, "local Ollama-provider projects must still call Ollama exactly as before");
    assert.equal(result.outcome, "consistent");
    t.close();
  });
});

describe("checkDeliverableIntentConsistency — REMOTE-SAFE (FREE_MULTI_MODEL project)", () => {
  for (const verdict of [
    { consistent: true, reason: "" },
    { consistent: true, reason: "   " },
    { consistent: true, reason: "Matches.", unexpected: "extra field" },
  ]) {
    test(`strict verdict contract rejects ${JSON.stringify(verdict)}`, async () => {
      const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
      try {
        upsertReviewModel(t.db, "groq", "review-model");
        const result = await checkDeliverableIntentConsistency(t.db, project, agentRun,
          { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
          { freeProviderFetchImpl: guardedFetch(() => groqChat(verdict)) });
        assert.equal(result.outcome, "unavailable", "An empty reason or wrong shape must never authorize VERIFIED");
      } finally { t.close(); }
    });
  }

  test("localhost/Ollama is never called; a qualified free verifier is selected and structured PASS is honored", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "review-model");
    const fetchImpl = guardedFetch(() => groqChat({ consistent: true, reason: "The built page matches the request." }));
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "consistent");
    assert.equal(result.reason, "The built page matches the request.");
    // Verifier model recorded — a real model.request event was emitted for a real shadow agent_run.
    const usage = listAiUsageForProject(t.db, project.id);
    assert.ok(usage.some((u) => u.provider === "groq"), "verifier's real provider usage must be recorded");
    t.close();
  });

  test("structured FAIL is honored — a real mismatch is reported as inconsistent, not silently passed", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "review-model");
    const fetchImpl = guardedFetch(() => groqChat({ consistent: false, reason: "The page is a to-do list, not a counter." }));
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: "Observed: a to-do list with add/remove items.", checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "inconsistent");
    assert.match(result.reason, /to-do list/);
    t.close();
  });

  test("malformed verifier output never becomes a PASS", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "review-model");
    const fetchImpl = guardedFetch(() => groqChat({ notTheRightShape: true })); // valid envelope, but summary JSON does not match {consistent, reason}
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable");
    assert.doesNotMatch(result.reason.toLowerCase(), /^consistent$/);
    t.close();
  });

  test("empty verifier output never becomes a PASS", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "review-model");
    const fetchImpl = guardedFetch(() => jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "" } }], usage: { prompt_tokens: 5, completion_tokens: 0 } }));
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable");
    t.close();
  });

  test("a 429 on the best candidate falls back to the next qualified candidate and still produces a real verdict", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "flaky", 95);
    upsertReviewModel(t.db, "gemini", "reliable", 50);
    let groqCalls = 0;
    const fetchImpl = guardedFetch((url) => {
      if (url.includes("api.groq.com")) { groqCalls += 1; return jsonResponse({ error: "rate limited" }, { ok: false, status: 429, headers: { "retry-after": "1" } }); }
      if (url.includes("generativelanguage.googleapis.com")) return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ consistent: true, reason: "Matches." }) }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } });
      return jsonResponse({}, { ok: false, status: 404 });
    });
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(groqCalls, 1, "the rate-limited candidate is tried once, then the router falls back");
    assert.equal(result.outcome, "consistent");
    t.close();
  });

  test("413 (request too large) is handled the same way a real task call handles it — never crashes, never silently PASSes", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "small-context");
    const fetchImpl = guardedFetch(() => jsonResponse({ error: { message: "Request too large for model" } }, { ok: false, status: 413 }));
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable");
    t.close();
  });

  test("no eligible qualified free verifier fails CLOSED with a clear operational reason — never an auto-pass", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    // No model_registry entry at all for REVIEW capability.
    const fetchImpl = guardedFetch(() => { throw new Error("must never be called — no candidate should be selected"); });
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable");
    assert.match(result.reason, /no eligible free model/i);
    t.close();
  });

  test("Claude is never called and paid cost stays $0, regardless of outcome", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "review-model");
    let claudeCalled = false;
    const fetchImpl = guardedFetch((url) => {
      if (/anthropic\.com/.test(url)) claudeCalled = true;
      return groqChat({ consistent: true, reason: "Matches." });
    });
    await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(claudeCalled, false);
    const usage = listAiUsageForProject(t.db, project.id);
    assert.ok(usage.every((u) => u.costUsd === 0), "every recorded usage row must be $0 — no paid fallback is reachable from this gate");
    t.close();
  });

  test("verifier model is recorded distinctly from the task's own agent_run (never overwrites it)", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "review-model");
    const fetchImpl = guardedFetch(() => groqChat({ consistent: true, reason: "Matches." }));
    await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    const stillSimulated = t.db.prepare("SELECT provider FROM agent_runs WHERE id = ?").get(agentRun.id) as { provider: string };
    assert.equal(stillSimulated.provider, "simulated", "the calling task's own agent_run must be untouched by the verifier's accounting");
    const shadowRuns = t.db.prepare("SELECT provider, model FROM agent_runs WHERE id != ? AND provider = 'groq'").all(agentRun.id) as Array<{ provider: string; model: string }>;
    assert.ok(shadowRuns.length >= 1, "the verifier's own provider/model must be recorded on its own row");
    t.close();
  });

  test("prefers a verifier different from the model that produced the deliverable, when more than one is qualified", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "producer-model", 95); // highest-scored — would be picked first without the independence preference
    upsertReviewModel(t.db, "gemini", "independent-model", 40);
    seedProducer(t, project.id, "groq", "producer-model");
    let usedProvider = "";
    const fetchImpl = guardedFetch((url) => {
      if (url.includes("api.groq.com")) { usedProvider = "groq"; return groqChat({ consistent: true, reason: "Matches (producer)." }); }
      usedProvider = "gemini";
      return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ consistent: true, reason: "Matches (independent)." }) }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } });
    });
    await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(usedProvider, "gemini", "the independent (non-producer) qualified verifier must be preferred");
    t.close();
  });

  test("does NOT make independence a hard requirement — the producer's own model is used when it's the only qualified verifier", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "only-model");
    seedProducer(t, project.id, "groq", "only-model");
    const fetchImpl = guardedFetch(() => groqChat({ consistent: true, reason: "Matches (only option)." }));
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "consistent", "the only qualified verifier must still be used, even though it's also the producer");
    t.close();
  });

  test("context sent to the verifier is bounded — not the entire project/database", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "review-model");
    let sentBody = "";
    const fetchImpl = guardedFetch(() => groqChat({ consistent: true, reason: "Matches." }));
    const wrapped = (async (url: string, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return (fetchImpl as (u: string) => Promise<Response>)(url);
    }) as unknown as typeof fetch;
    const hugeCandidate = "x".repeat(50_000);
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: hugeCandidate, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: wrapped },
    );
    // Over the shared bound, the gate refuses to review silently-truncated evidence rather than sending it.
    assert.equal(result.outcome, "unavailable");
    assert.equal(sentBody, "", "an over-bound candidate must never reach the network at all");
    t.close();
  });

  test("real end-to-end through executeTask(): the mandatory QA gate reaches VERIFIED for a real qa-agent run, never touching Ollama", async () => {
    const prior = process.env.AI_OFFICE_WORKSPACES_ROOT;
    const root = mkdtempSync(join(tmpdir(), "ai-office-remote-qa-gate-"));
    process.env.AI_OFFICE_WORKSPACES_ROOT = root;
    const t = createTestDb();
    try {
      const owner = getOwner(t.db)!;
      const { project } = createProjectWithIdea(t.db, {
        title: "Counter", rawIdeaText: "Build a simple counter page with an Increment button and a message.",
        ownerId: owner.id, provider: "simulated", routingMode: "FREE_MULTI_MODEL", aiPolicyMode: "CLAUDE_ONLY",
      });
      const devTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend — Counter" });
      updateTaskStatus(t.db, devTask.id, "DONE");
      await createWorkspace(project.id);
      const html = [
        "<!DOCTYPE html>", '<html lang="en"><head><meta charset="UTF-8" /><title>Counter</title></head>', "<body>",
        "<h1>Counter</h1>", '<p class="description">Click to increment.</p>',
        '<button id="greet-button" type="button">Increment</button>', '<p id="message"></p>',
        '<script src="script.js"></script>', "</body></html>",
      ].join("\n");
      const js = ['document.getElementById("greet-button").addEventListener("click", function () {', '  document.getElementById("message").textContent = "1";', "});"].join("\n");
      await writeFile(project.id, "index.html", html);
      await writeFile(project.id, "script.js", js);
      upsertReviewModel(t.db, "groq", "review-model");
      const qaTask = createTask(t.db, { projectId: project.id, roleId: "qa-agent", title: "Test frontend — Counter" });

      let ollamaCalled = false;
      const result = await executeTask(t.db, qaTask.id, {
        intentCheckFetch: (async () => { ollamaCalled = true; throw new Error("must never be called"); }) as unknown as typeof fetch,
        freeProviderFetchImpl: guardedFetch((url) => {
          if (url.includes("api.groq.com")) return groqChat({ consistent: true, reason: "The counter page matches the request." });
          return jsonResponse({}, { ok: false, status: 404 });
        }),
      });

      assert.equal(ollamaCalled, false, "Ollama's own fetch override must never be invoked for a FREE_MULTI_MODEL project");
      assert.equal(result.outcome, "succeeded", JSON.stringify(result.reason ?? result));
      assert.equal(getWorkspace(t.db, project.id)!.deliveryState, "VERIFIED");
      const attempt = listTaskAttempts(t.db, qaTask.id)[0]!;
      assert.equal(getAgentRun(t.db, attempt.agentRunId!)!.status, "SUCCEEDED");
      const usage = listAiUsageForProject(t.db, project.id);
      assert.ok(usage.some((u) => u.provider === "groq"), "the real verifier call's usage must be recorded");
      assert.ok(usage.every((u) => u.costUsd === 0));
    } finally {
      t.close();
      if (prior === undefined) delete process.env.AI_OFFICE_WORKSPACES_ROOT;
      else process.env.AI_OFFICE_WORKSPACES_ROOT = prior;
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Remote intent-verifier reliability fix (real acceptance evidence,
  // project 43d6b776): 4/4 real verifier calls to Groq openai/gpt-oss-120b
  // returned HTTP 400 json_validate_failed with an empty failed_generation
  // field, blocking the project at 4/8. Root cause: the verifier reused the
  // full, heavyweight StructuredAgentOutput envelope under Groq's strict
  // json_schema response-format mode at a 300-token budget — too tight for
  // the model to reliably satisfy that whole schema, so Groq's own
  // validator rejected the generation outright. The fix requests
  // schema-less JSON mode unconditionally for a verdict call.
  test("verdict calls request schema-less JSON mode, never strict json_schema, even when the model is in the schema allowlist", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-120b");
    process.env.AI_OFFICE_GROQ_JSON_SCHEMA_MODELS = "openai/gpt-oss-120b";
    let sentBody: Record<string, unknown> | null = null;
    const fetchImpl = guardedFetch((url, init) => {
      sentBody = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
      return groqChat({ consistent: true, reason: "Matches." });
    });
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "consistent");
    assert.ok(sentBody, "the real request body must have been captured");
    const format = (sentBody as unknown as { response_format: { type: string; json_schema?: unknown } }).response_format;
    assert.equal(format.type, "json_object", "a verdict call must never request strict json_schema mode, regardless of the model's allowlist entry");
    assert.equal(format.json_schema, undefined);
    delete process.env.AI_OFFICE_GROQ_JSON_SCHEMA_MODELS;
    t.close();
  });

  test("reproduces the real failure — Groq HTTP 400 json_validate_failed with an empty failed_generation — and the verdict is reported unavailable, never a crash, never a silent PASS", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-120b");
    const fetchImpl = guardedFetch(() =>
      jsonResponse({ error: { message: "'messages' failed to be validated against the given JSON schema.", code: "json_validate_failed", failed_generation: "" } }, { ok: false, status: 400 }),
    );
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable", "the exact real failure must never be reported as consistent or inconsistent — only unavailable");
    assert.notEqual(result.outcome, "consistent");
    t.close();
  });

  test("an empty failed_generation on json_validate_failed cannot be recovered — deterministic recovery only accepts strict JSON matching the real contract", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-120b");
    // Even if a provider ever did send a non-empty failed_generation for a
    // verdict call, it must still pass through the exact same strict,
    // minimal {consistent, reason} Zod contract — a recovered blob that
    // merely looks like the old heavyweight envelope must not pass.
    const fetchImpl = guardedFetch(() =>
      jsonResponse({ error: { code: "json_validate_failed", failed_generation: JSON.stringify({ summary: "not a verdict", artifacts: [] }) } }, { ok: false, status: 400 }),
    );
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable");
    t.close();
  });

  test("120B → 20B fallback still works for the verifier when 120B hits this exact real failure and 20B is eligible", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-120b", 95);
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-20b", 50);
    const modelsTried: string[] = [];
    const fetchImpl = guardedFetch((_url, init) => {
      const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as { model: string };
      modelsTried.push(body.model);
      if (body.model === "openai/gpt-oss-120b") {
        return jsonResponse({ error: { code: "json_validate_failed", failed_generation: "" } }, { ok: false, status: 400 });
      }
      return groqChat({ consistent: true, reason: "20B recovered the verdict." });
    });
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.deepEqual(modelsTried, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    assert.equal(result.outcome, "consistent");
  t.close();
  });

  test("bounded fallback only — no infinite retries when every qualified candidate fails the same way", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-120b", 95);
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-20b", 50);
    upsertReviewModel(t.db, "gemini", "gemini-fixture", 10);
    let calls = 0;
    const fetchImpl = guardedFetch(() => { calls += 1; return jsonResponse({ error: { code: "json_validate_failed", failed_generation: "" } }, { ok: false, status: 400 }); });
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable");
    assert.ok(calls <= 3, `fallback must stay bounded (MAX_FREE_MODEL_FALLBACK_CANDIDATES), got ${calls} calls`);
    assert.ok(calls >= 1);
    t.close();
  });

  test("a genuine malformed verdict (wrong shape, valid JSON) still counts against the model's health, per existing policy", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-120b");
    const fetchImpl = guardedFetch(() => groqChat({ not_a_verdict_at_all: true } as unknown));
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable");
    // The adapter's own 200-path accepted the response (status SUCCEEDED,
    // real HTTP round-trip, real text) — the model genuinely answered but
    // did not satisfy the required {consistent, reason} contract. This is
    // the "genuine malformed model output" the health rule says must
    // still be accounted for — distinct from the now-eliminated
    // provider/API json_schema-incompatibility failure class (proven
    // never to poison health below).
    const registryRow = t.db.prepare("SELECT recentFailureCount FROM model_registry WHERE provider='groq' AND modelId='openai/gpt-oss-120b'").get() as { recentFailureCount: number };
    assert.equal(registryRow.recentFailureCount, 1, "a genuinely wrong-shape verdict must count toward health, per existing policy");
    t.close();
  });

  test("not valid JSON at all also counts against the model's health, per existing policy", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-120b");
    const fetchImpl = guardedFetch(() => jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "not json at all" } }], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
    const result = await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    assert.equal(result.outcome, "unavailable");
    const registryRow = t.db.prepare("SELECT recentFailureCount FROM model_registry WHERE provider='groq' AND modelId='openai/gpt-oss-120b'").get() as { recentFailureCount: number };
    assert.equal(registryRow.recentFailureCount, 1);
    t.close();
  });

  test("the json_validate_failed provider-rejection class, by contrast, never poisons health beyond this gate's own account of the real operational failure", async () => {
    const { t, project, agentRun } = setup("FREE_MULTI_MODEL");
    upsertReviewModel(t.db, "groq", "openai/gpt-oss-120b");
    const fetchImpl = guardedFetch(() => jsonResponse({ error: { code: "json_validate_failed", failed_generation: "" } }, { ok: false, status: 400 }));
    await checkDeliverableIntentConsistency(
      t.db, project, agentRun,
      { authoritativeUserRequest: REQUEST, candidate: MATCHING_CANDIDATE, checkpointLabel: "built deliverable" },
      { freeProviderFetchImpl: fetchImpl },
    );
    // This DOES still count once per real HTTP rejection — a real
    // provider-level failure, exactly like any other HTTP error this
    // adapter already accounts for (429/5xx/timeout). What the fix
    // removes is the false-positive TRIGGER (sending a schema that
    // genuinely could not fit the token budget) — not the accounting of
    // a real rejection if one still occurs.
    const registryRow = t.db.prepare("SELECT recentFailureCount FROM model_registry WHERE provider='groq' AND modelId='openai/gpt-oss-120b'").get() as { recentFailureCount: number };
    assert.equal(registryRow.recentFailureCount, 1);
    t.close();
  });
});
