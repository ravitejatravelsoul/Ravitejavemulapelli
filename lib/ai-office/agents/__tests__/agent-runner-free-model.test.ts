import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, getAgentRun, listTaskAttempts } from "../../domain/tasks.ts";
import { listUnresolvedFailures } from "../../domain/project-outputs.ts";
import { listAiUsageForProject } from "../../domain/budget.ts";
import { upsertModelRegistryEntry as rawUpsert, recordModelHealthCheck, getModelRegistryEntry, listRoutingDecisions, setModelBenchmarkScore } from "../../domain/model-registry.ts";
import { executeTask } from "../agent-runner.ts";

/**
 * Free multi-model orchestration phase — real integration coverage for
 * agent-runner.ts's new `freeModelOrchestration` dispatch branch,
 * exercised through the real `executeTask()` entry point (not a
 * reimplementation), with `options.freeProviderFetchImpl` as the one
 * test-injection seam — the exact same pattern `options.ollamaFetchImpl`
 * already established. No real network call, no paid Claude call, ever.
 */

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.GEMINI_API_KEY = "test-gemini-key";

function setupFreeOrchestrationProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, {
    title: "Free multi-model pilot",
    rawIdeaText: "A tiny deterministic test project for the free multi-model orchestration phase.",
    ownerId: owner.id,
    provider: "ollama",
    aiPolicyMode: "LOCAL_ONLY",
    freeModelOrchestration: true,
  });
  return { owner, project };
}

const VALID_OUTPUT = {
  summary: "Done.",
  artifacts: [{ kind: "artifact", artifactType: "requirements", content: "# Requirements" }],
  decisions: [],
  testResults: [],
  events: [],
  recommendedNextActions: [],
};

const VALID_ARCHITECTURE_OUTPUT = {
  summary: "Done.",
  artifacts: [{ kind: "artifact", artifactType: "architecture", content: "# Architecture" }],
  decisions: [],
  testResults: [],
  events: [],
  recommendedNextActions: [],
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return { ok: init.ok ?? true, status: init.status ?? 200, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response;
}

/** Routes a mocked fetch by URL host — lets one test control both Groq (OpenAI-compatible /chat/completions) and Gemini (:generateContent) responses distinctly. */
function multiProviderFetch(handlers: { groq?: () => Response; gemini?: () => Response }): typeof fetch {
  return (async (url: string) => {
    if (url.includes("api.groq.com")) return handlers.groq ? handlers.groq() : jsonResponse({}, { ok: false, status: 404 });
    if (url.includes("generativelanguage.googleapis.com")) return handlers.gemini ? handlers.gemini() : jsonResponse({}, { ok: false, status: 404 });
    throw new Error(`Unexpected URL in test: ${url}`);
  }) as unknown as typeof fetch;
}

describe("agent-runner.ts — free multi-model orchestration dispatch", () => {
  test("a freeModelOrchestration project routes DIFFERENT tasks to DIFFERENT providers based on required capability", async () => {
    const t = createTestDb();
    const { project } = setupFreeOrchestrationProject(t);

    // Groq only covers GENERAL (product-owner's primary capability);
    // Gemini only covers ARCHITECTURE (solution-architect's) — mutually
    // exclusive on purpose, so the router has no choice but to pick
    // differently per task.
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "groq-general", displayName: "groq-general", capabilities: ["GENERAL"] });
    upsertModelRegistryEntry(t.db, { provider: "gemini", modelId: "gemini-arch", displayName: "gemini-arch", capabilities: ["ARCHITECTURE"] });

    const fetchImpl = multiProviderFetch({
      groq: () => jsonResponse({ choices: [{ message: { content: JSON.stringify(VALID_OUTPUT) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }),
      gemini: () => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_ARCHITECTURE_OUTPUT) }] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 40 } }),
    });

    const poTask = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
    const poResult = await executeTask(t.db, poTask.id, { freeProviderFetchImpl: fetchImpl });
    assert.equal(poResult.outcome, "succeeded");
    const poAttempt = listTaskAttempts(t.db, poTask.id)[0]!;
    assert.equal(getAgentRun(t.db, poAttempt.agentRunId!)!.provider, "groq");

    const archTask = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    const archResult = await executeTask(t.db, archTask.id, { freeProviderFetchImpl: fetchImpl });
    assert.equal(archResult.outcome, "succeeded");
    const archAttempt = listTaskAttempts(t.db, archTask.id)[0]!;
    assert.equal(getAgentRun(t.db, archAttempt.agentRunId!)!.provider, "gemini");

    t.close();
  });

  test("cross-provider fallback: a rate-limited best candidate falls back to the next eligible candidate and the task still succeeds", async () => {
    const t = createTestDb();
    const { project } = setupFreeOrchestrationProject(t);

    // Both cover GENERAL for product-owner; groq is deliberately made the
    // higher-scored (benchmark-qualified) candidate so the router tries
    // it FIRST — proving the fallback path actually moves off a real
    // top-ranked pick, not just picking whichever one happened to be
    // eligible.
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "flaky", displayName: "flaky", capabilities: ["GENERAL"] });
    upsertModelRegistryEntry(t.db, { provider: "gemini", modelId: "reliable", displayName: "reliable", capabilities: ["GENERAL"] });
    setModelBenchmarkScore(t.db, "groq", "flaky", { score: 95, qualified: true });

    let groqCallCount = 0;
    const fetchImpl = multiProviderFetch({
      groq: () => {
        groqCallCount += 1;
        return jsonResponse({ error: "rate limited" }, { ok: false, status: 429 });
      },
      gemini: () => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_OUTPUT) }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } }),
    });

    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
    const result = await executeTask(t.db, task.id, { freeProviderFetchImpl: fetchImpl, timeoutMs: 5000 });

    assert.equal(result.outcome, "succeeded", "a rate-limited first candidate must not break the project — fallback must complete it");
    const attempt = listTaskAttempts(t.db, task.id)[0]!;
    const agentRun = getAgentRun(t.db, attempt.agentRunId!)!;
    assert.equal(agentRun.provider, "gemini", "the AgentRun must reflect the model that ACTUALLY produced the result, not the initial best-scored guess");

    // groq was tried (and retried in-process for its operational failure) before falling back — never silently skipped.
    assert.equal(groqCallCount, 1, "rate-limited models must not be retried immediately");

    // groq's rate limit is recorded in the registry so it's excluded from the next selection.
    const groqRow = getModelRegistryEntry(t.db, "groq", "flaky")!;
    assert.equal(groqRow.health, "UNAVAILABLE");
    assert.ok(groqRow.rateLimitedUntil! > Date.now());

    // The routing decision audit trail records the fallback that occurred.
    const decisions = listRoutingDecisions(t.db, { projectId: project.id });
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]!.selectedProvider, "gemini");
    assert.ok(decisions[0]!.fallbacksUsed, "a fallback occurred and must be recorded");
    const fallbacks = JSON.parse(decisions[0]!.fallbacksUsed!);
    assert.equal(fallbacks[0].provider, "groq");

    t.close();
  });

  test("token/request usage is recorded per real call and cost is always $0 for free providers", async () => {
    const t = createTestDb();
    const { project } = setupFreeOrchestrationProject(t);
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["GENERAL"] });

    const fetchImpl = multiProviderFetch({
      groq: () => jsonResponse({ choices: [{ message: { content: JSON.stringify(VALID_OUTPUT) } }], usage: { prompt_tokens: 123, completion_tokens: 456 } }),
    });

    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
    await executeTask(t.db, task.id, { freeProviderFetchImpl: fetchImpl });

    const usage = listAiUsageForProject(t.db, project.id);
    assert.equal(usage.length, 1);
    assert.equal(usage[0]!.provider, "groq");
    assert.equal(usage[0]!.inputTokens, 123);
    assert.equal(usage[0]!.outputTokens, 456);
    assert.equal(usage[0]!.costUsd, 0);

    const registryRow = getModelRegistryEntry(t.db, "groq", "m1")!;
    assert.equal(registryRow.tasksCompleted, 1, "a real execution updates the model's own track record, independent of the benchmark system");

    t.close();
  });

  test("no eligible free model for the capability is an honest task failure, never a silent fallback to Claude", async () => {
    const t = createTestDb();
    const { project } = setupFreeOrchestrationProject(t);
    // Registry has a model, but for a DIFFERENT capability than this task needs.
    upsertModelRegistryEntry(t.db, { provider: "groq", modelId: "m1", displayName: "m1", capabilities: ["REVIEW"] });

    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
    const result = await executeTask(t.db, task.id, {});

    assert.notEqual(result.outcome, "succeeded");
    assert.ok(["retried", "escalated"].includes(result.outcome), `expected a normal failure outcome, got "${result.outcome}"`);
    const failures = listUnresolvedFailures(t.db, project.id);
    assert.equal(failures.length, 1);
    assert.match(failures[0]!.reason, /No eligible free model/);
    const usage = listAiUsageForProject(t.db, project.id);
    assert.equal(usage.length, 1);
    assert.equal(usage[0]!.costUsd, 0);
    assert.notEqual(usage[0]!.provider, "claude", "must never silently fall back to the paid provider");
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

test('malformed first model falls back and preserves both providers token usage', async () => {
 const t=createTestDb();
 try {
  const {project}=setupFreeOrchestrationProject(t);
  upsertModelRegistryEntry(t.db,{provider:'groq',modelId:'malformed',displayName:'malformed',capabilities:['GENERAL']});
  upsertModelRegistryEntry(t.db,{provider:'gemini',modelId:'valid',displayName:'valid',capabilities:['GENERAL']});
  setModelBenchmarkScore(t.db,'groq','malformed',{score:99,qualified:true});
  const task=createTask(t.db,{projectId:project.id,roleId:'product-owner',title:'Define requirements'});
  const result=await executeTask(t.db,task.id,{freeProviderFetchImpl:multiProviderFetch({
   groq:()=>jsonResponse({choices:[{message:{content:'not json'}}],usage:{prompt_tokens:11,completion_tokens:13}}),
   gemini:()=>jsonResponse({candidates:[{content:{parts:[{text:JSON.stringify(VALID_OUTPUT)}]}}],usageMetadata:{promptTokenCount:17,candidatesTokenCount:19}}),
  })});
  assert.equal(result.outcome,'succeeded');
  const usage=listAiUsageForProject(t.db,project.id);
  assert.equal(usage.length,2);
  assert.equal(usage.reduce((n,r)=>n+r.inputTokens,0),28);
  assert.equal(usage.reduce((n,r)=>n+r.outputTokens,0),32);
  const decision=listRoutingDecisions(t.db,{projectId:project.id})[0]!;
  assert.equal(decision.attempts,2);assert.equal(decision.inputTokens,28);assert.equal(decision.outputTokens,32);
  assert.match(decision.selectionReason,/Fallback/);
 }finally{t.close();}
});
