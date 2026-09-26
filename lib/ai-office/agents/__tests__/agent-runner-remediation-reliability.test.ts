import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask } from "../../domain/tasks.ts";
import { listAiUsageForProject } from "../../domain/budget.ts";
import { recordFailure } from "../../domain/project-outputs.ts";
import { upsertWorkspaceFileRecord } from "../../domain/workspace.ts";
import { getAgentRole } from "../../domain/agent-roles.ts";
import { buildTaskContext } from "../context-builder.ts";
import { optimizeContextForPaidCall } from "../../context/context-budget-manager.ts";
import {
  upsertModelRegistryEntry as rawUpsert,
  recordModelHealthCheck,
  getModelRegistryEntry,
  setModelBenchmarkScore,
  listRoutingDecisions,
} from "../../domain/model-registry.ts";
import { writeFile, createWorkspace } from "../../workspace/workspace-service.ts";
import { runQABrowserVerification } from "../../workspace/qa-browser-verification.ts";
import { executeTask, resetProviderTokenBudgetsForTests } from "../agent-runner.ts";

/**
 * Remediation reliability — everything here goes through the real
 * `executeTask()` and the real workspace/QA code with mocked provider
 * HTTP only. No real project, no network, no Claude, $0.
 */

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";
process.env.AI_OFFICE_CLAUDE_ENABLED = "false";

const REQUEST_TEXT = "Build a small Items page: an Add item button that shows a status message, and a delete confirmation dialog that must not block the page when closed.";

function upsertModel(db: ReturnType<typeof createTestDb>["db"], provider: "groq" | "gemini", modelId: string, capabilities: Array<"CODING" | "GENERAL">, score = 60) {
  process.env[`${provider.toUpperCase()}_API_KEY`] = "test-key";
  process.env[`AI_OFFICE_${provider.toUpperCase()}_FREE_TIER_CONFIRMED`] = "true";
  const key = `AI_OFFICE_${provider.toUpperCase()}_FREE_MODELS`;
  process.env[key] = [process.env[key], modelId].filter(Boolean).join(",");
  rawUpsert(db, { provider, modelId, displayName: modelId, capabilities: [...capabilities, "REASONING", "STRUCTURED_OUTPUT"], structuredOutput: true });
  recordModelHealthCheck(db, provider, modelId, { health: "HEALTHY" });
  setModelBenchmarkScore(db, provider, modelId, { score, qualified: true });
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const BROKEN_CSS = ".hidden { display: none; }\n.scrim { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,.5); display: flex; z-index: 1000; }\n";
const FIXED_CSS = ".scrim { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,.5); display: flex; z-index: 1000; }\n.hidden { display: none !important; }\n";
const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Items</title><link rel="stylesheet" href="style.css"></head><body>
<h1>Items</h1><p>Manage a few items on this page.</p><button id="add" type="button">Add item</button><p id="status"></p>
<div id="confirm" class="scrim hidden" role="alertdialog" aria-modal="true"><div class="box"><button id="yes" type="button">Yes</button></div></div>
<script src="app.js"></script></body></html>`;
const JS = 'document.getElementById("add").addEventListener("click",function(){document.getElementById("status").textContent="Added an item";});';

function devOutput(files: Record<string, string>) {
  return {
    summary: "Fixed the hidden overlay.",
    artifacts: [{ kind: "artifact", artifactType: "code", content: "Made the hidden state win the cascade." }],
    decisions: [], testResults: [], events: [], recommendedNextActions: [],
    fileOperations: Object.entries(files).map(([path, content]) => ({ kind: "file-operation", action: "write", path, content })),
  };
}
const chat = (content: unknown, usage = { prompt_tokens: 1200, completion_tokens: 300 }, headers: Record<string, string> = {}) =>
  jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage }, headers);

async function withProject<T>(seedFiles: Array<[string, string]>, fn: (ctx: { t: ReturnType<typeof createTestDb>; projectId: string; taskId: string }) => Promise<T>): Promise<T> {
  const prior = process.env.AI_OFFICE_WORKSPACES_ROOT;
  const root = mkdtempSync(join(tmpdir(), "ai-office-remediation-reliability-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = root;
  const t = createTestDb();
  try {
    const { project } = createProjectWithIdea(t.db, { title: "Items", rawIdeaText: REQUEST_TEXT, ownerId: getOwner(t.db)!.id, routingMode: "FREE_MULTI_MODEL", aiPolicyMode: "CLAUDE_ONLY" });
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend — Items" });
    await createWorkspace(project.id);
    for (const [path, content] of seedFiles) {
      await writeFile(project.id, path, content);
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path, sizeBytes: content.length, roleId: "frontend-developer", taskId: task.id });
    }
    // The task already ran once (attempt 1) and QA reported a failure: this is attempt 2, a remediation.
    t.db.prepare("UPDATE tasks SET attemptCount = 1 WHERE id = ?").run(task.id);
    return await fn({ t, projectId: project.id, taskId: task.id });
  } finally {
    t.close();
    if (prior === undefined) delete process.env.AI_OFFICE_WORKSPACES_ROOT;
    else process.env.AI_OFFICE_WORKSPACES_ROOT = prior;
    rmSync(root, { recursive: true, force: true });
  }
}

const offlineOptions = {
  // Intent gates call a local model; keep them deterministic and offline.
  intentCheckFetch: (async () => { throw new Error("offline"); }) as typeof fetch,
  retryDriftCheckOverride: async () => ({ consistent: true as const }),
};

beforeEach(() => resetProviderTokenBudgetsForTests());

describe("QA failure → developer remediation → QA retest (real workspace, real browser, mocked provider only)", () => {
  test("the exact QA observation, files and acceptance criteria reach a bounded request; a valid fix passes integrity and QA retest", async () => {
    await withProject([["index.html", HTML], ["style.css", BROKEN_CSS], ["app.js", JS]], async ({ t, projectId, taskId }) => {
      upsertModel(t.db, "groq", "coder", ["CODING"]);
      // 1. Real QA against the defective deliverable produces the real failure evidence.
      const qa = await runQABrowserVerification(projectId);
      assert.equal(qa.status, "FAIL");
      recordFailure(t.db, { projectId, taskId, reason: qa.summary });

      // 2. Remediation request through the real runner.
      const bodies: Array<{ messages: Array<{ content: string }>; max_tokens?: number }> = [];
      const result = await executeTask(t.db, taskId, {
        ...offlineOptions,
        freeProviderFetchImpl: (async (_url: string, init: RequestInit) => {
          bodies.push(JSON.parse(String(init.body)));
          return chat(devOutput({ "style.css": FIXED_CSS }), { prompt_tokens: 3100, completion_tokens: 400 }, { "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": "4500", "x-ratelimit-reset-tokens": "20s" });
        }) as typeof fetch,
      });
      assert.equal(result.outcome, "succeeded", JSON.stringify(result.reason));
      assert.equal(bodies.length, 1);
      const prompt = bodies[0]!.messages[0]!.content;

      // QA evidence preserved exactly (compacted, not summarized away).
      assert.ok(!prompt.includes(String.fromCharCode(27)), "no terminal colour codes");
      assert.match(prompt, /CORRECTIVE ATTEMPT/);
      assert.match(prompt, /intercepts pointer events/);
      assert.match(prompt, /id="confirm" class="scrim hidden"/);
      assert.match(prompt, /Diagnosis: .*marked hidden but is still rendered/);
      assert.ok(!/retrying click action|done scrolling|scrolling into view/.test(prompt), "retry-loop noise removed");
      // Files under repair and the acceptance criteria (authoritative request) are present.
      assert.match(prompt, /--- style\.css ---[\s\S]*\.hidden \{ display: none; \}/);
      assert.match(prompt, /--- index\.html ---/);
      assert.ok(prompt.includes(REQUEST_TEXT));
      // The same QA observation is not sent twice.
      assert.equal(prompt.split("intercepts pointer events").length - 1 <= 3, true);
      assert.ok(prompt.length < 24_000, `request should stay bounded, got ${prompt.length} chars`);
      assert.equal(bodies[0]!.max_tokens, 12288);

      // 3. The applied fix passes deterministic integrity and the real QA retest.
      const retest = await runQABrowserVerification(projectId);
      assert.equal(retest.status, "PASS", retest.summary);
      assert.equal(getModelRegistryEntry(t.db, "groq", "coder")!.recentFailureCount, 0);
    });
  });

  test("infrastructure failures (413/429/no eligible model) are never presented to the developer as issues to fix", async () => {
    await withProject([["index.html", HTML], ["style.css", BROKEN_CSS], ["app.js", JS]], async ({ t, projectId, taskId }) => {
      recordFailure(t.db, { projectId, taskId, reason: 'Operational: groq responded with HTTP 413 (rate_limit_exceeded) for model "m".' });
      recordFailure(t.db, { projectId, taskId, reason: "No eligible free model is currently enabled/healthy for capability CODING (checked every configured free provider's registry)." });
      recordFailure(t.db, { projectId, taskId, reason: "The hidden overlay intercepts clicks." });
      const ctx = await buildTaskContext(t.db, (await import("../../domain/tasks.ts")).getTask(t.db, taskId)!, getAgentRole(t.db, "frontend-developer")!, { attemptNumber: 2 });
      assert.deepEqual(ctx.remediationContext!.failingChecks, ["The hidden overlay intercepts clicks."]);
    });
  });
});

describe("hidden-overlay defect is rejected before QA when a developer re-emits it", () => {
  test("a developer response that leaves the cascade defect in place fails the integrity gate with an actionable, generic reason", async () => {
    await withProject([["index.html", HTML], ["style.css", BROKEN_CSS], ["app.js", JS]], async ({ t, projectId, taskId }) => {
      upsertModel(t.db, "groq", "coder", ["CODING"]);
      const result = await executeTask(t.db, taskId, {
        ...offlineOptions,
        freeProviderFetchImpl: (async () => chat(devOutput({ "style.css": BROKEN_CSS }))) as typeof fetch,
      });
      assert.ok(["retried", "escalated"].includes(result.outcome), result.outcome);
      const reasons = t.db.prepare("SELECT reason FROM failures WHERE projectId=?").all(projectId).map((r) => String(r.reason));
      assert.ok(reasons.some((r) => /Workspace integrity validation failed: index\.html: <div id="confirm" class="scrim hidden">.*stays displayed.*!important/.test(r)), reasons.join(" | "));
    });
  });
});

describe("HTTP 413 (request too large) — never a health failure, never an identical retry", () => {
  async function bigProject<T>(fn: (ctx: { t: ReturnType<typeof createTestDb>; projectId: string; taskId: string; baseEstimate: number }) => Promise<T>) {
    const files: Array<[string, string]> = [["index.html", HTML], ["style.css", BROKEN_CSS], ["app.js", JS]];
    for (let i = 0; i < 5; i++) files.push([`notes-${i}.txt`, `unrelated filler ${i} `.repeat(600)]);
    return withProject(files, async (ctx) => {
      recordFailure(ctx.t.db, { projectId: ctx.projectId, taskId: ctx.taskId, reason: "style.css: the hidden dialog still covers the page." });
      const task = (await import("../../domain/tasks.ts")).getTask(ctx.t.db, ctx.taskId)!;
      const role = getAgentRole(ctx.t.db, "frontend-developer")!;
      const context = await buildTaskContext(ctx.t.db, task, role, { attemptNumber: 2 });
      const base = await optimizeContextForPaidCall({ db: ctx.t.db, role, task, context, capability: "CODING", routingMode: "FREE_MULTI_MODEL" });
      assert.ok(base.ok);
      return fn({ ...ctx, baseEstimate: base.telemetry.estimatedInputTokens });
    });
  }

  test("a 413 triggers exactly one compact retry through the existing shrink order, then succeeds; the model's health is untouched", async () => {
    await bigProject(async ({ t, projectId, taskId, baseEstimate }) => {
      upsertModel(t.db, "groq", "coder", ["CODING"]);
      const reportedLimit = Math.floor((baseEstimate * 0.7) / 0.85);
      const sizes: number[] = [];
      let calls = 0;
      const result = await executeTask(t.db, taskId, {
        ...offlineOptions,
        freeProviderFetchImpl: (async (_url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body));
          sizes.push(body.messages[0].content.length);
          calls += 1;
          if (calls === 1) {
            return jsonResponse(413, { error: { code: "rate_limit_exceeded", message: `Request too large for model. Limit ${reportedLimit}, Requested ${baseEstimate}` } }, { "retry-after": "12" });
          }
          return chat(devOutput({ "style.css": FIXED_CSS }));
        }) as typeof fetch,
      });
      assert.equal(result.outcome, "succeeded");
      assert.equal(calls, 2, "one oversize attempt plus exactly one compact retry");
      assert.ok(sizes[1]! < sizes[0]!, `compact retry must be smaller (${sizes[1]} vs ${sizes[0]})`);
      const row = getModelRegistryEntry(t.db, "groq", "coder")!;
      assert.equal(row.recentFailureCount, 0, "a size rejection is not a model failure");
      assert.equal(row.health, "HEALTHY");
      assert.equal(row.rateLimitedUntil, null);
      // Evidence keeps the numbers, not the provider text.
      const events = t.db.prepare("SELECT payload FROM messages_events WHERE projectId=? AND type='model.request' ORDER BY createdAt").all(projectId).map((r) => JSON.parse(String(r.payload)));
      assert.equal(events[0].responseDiagnostics.httpStatus, 413);
      assert.equal(events[0].responseDiagnostics.tokenLimit, reportedLimit);
      assert.equal(events[0].responseDiagnostics.tokensRequested, baseEstimate);
      assert.equal(listRoutingDecisions(t.db, { projectId })[0]!.attempts, 2);
      assert.ok(listAiUsageForProject(t.db, projectId).every((u) => u.costUsd === 0));
    });
  });

  test("a request that cannot be shrunk moves to the next eligible free model; repeated 413s never trip the three-failure gate", async () => {
    await bigProject(async ({ t, projectId, taskId }) => {
      upsertModel(t.db, "groq", "coder", ["CODING"], 90);
      upsertModel(t.db, "gemini", "backup", ["CODING"], 60);
      let groqCalls = 0;
      const fetchImpl = (async (url: string) => {
        if (url.includes("api.groq.com")) {
          groqCalls += 1;
          return jsonResponse(413, { error: { code: "rate_limit_exceeded", message: "Request too large. Limit 150, Requested 9000" } });
        }
        return jsonResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(devOutput({ "style.css": FIXED_CSS })) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } });
      }) as typeof fetch;

      const first = await executeTask(t.db, taskId, { ...offlineOptions, freeProviderFetchImpl: fetchImpl });
      assert.equal(first.outcome, "succeeded");
      assert.equal(groqCalls, 1, "an unshrinkable 413 is not retried against the same model");
      // Repeat the failing situation several times: the health gate must not be reached.
      for (let i = 0; i < 3; i++) {
        t.db.prepare("UPDATE tasks SET status='PENDING', attemptCount=(SELECT MAX(attemptNumber) FROM task_attempts WHERE taskId=?) WHERE id=?").run(taskId, taskId);
        await executeTask(t.db, taskId, { ...offlineOptions, freeProviderFetchImpl: fetchImpl });
      }
      const groq = getModelRegistryEntry(t.db, "groq", "coder")!;
      assert.equal(groq.recentFailureCount, 0);
      assert.notEqual(groq.health, "UNAVAILABLE");
      assert.ok(listAiUsageForProject(t.db, projectId).every((u) => u.costUsd === 0 && u.provider !== "claude"));
    });
  });
});

describe("429, pacing and malformed JSON keep the existing protections", () => {
  test("429 honors Retry-After as a model-specific cooldown and falls back; bounded, free-only", async () => {
    await withProject([["index.html", HTML], ["style.css", BROKEN_CSS], ["app.js", JS]], async ({ t, taskId }) => {
      upsertModel(t.db, "groq", "limited", ["CODING"], 90);
      upsertModel(t.db, "gemini", "backup", ["CODING"], 60);
      const before = Date.now();
      const result = await executeTask(t.db, taskId, {
        ...offlineOptions,
        freeProviderFetchImpl: (async (url: string) => url.includes("api.groq.com")
          ? jsonResponse(429, { error: { code: "rate_limit_exceeded" } }, { "retry-after": "13" })
          : jsonResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(devOutput({ "style.css": FIXED_CSS })) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } })) as typeof fetch,
      });
      assert.equal(result.outcome, "succeeded");
      const row = getModelRegistryEntry(t.db, "groq", "limited")!;
      assert.equal(row.health, "UNAVAILABLE");
      assert.ok(row.rateLimitedUntil! >= before + 12_000 && row.rateLimitedUntil! <= Date.now() + 14_000, "cooldown follows Retry-After");
      assert.equal(row.recentFailureCount, 1);
    });
  });

  test("malformed / provider-rejected JSON is never success: it counts as a real model failure and falls back", async () => {
    await withProject([["index.html", HTML], ["style.css", BROKEN_CSS], ["app.js", JS]], async ({ t, taskId }) => {
      upsertModel(t.db, "groq", "sloppy", ["CODING"], 90);
      upsertModel(t.db, "gemini", "backup", ["CODING"], 60);
      const result = await executeTask(t.db, taskId, {
        ...offlineOptions,
        freeProviderFetchImpl: (async (url: string) => url.includes("api.groq.com")
          ? jsonResponse(400, { error: { code: "json_validate_failed", failed_generation: '{"summary":"truncated' } })
          : jsonResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(devOutput({ "style.css": FIXED_CSS })) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } })) as typeof fetch,
      });
      assert.equal(result.outcome, "succeeded");
      assert.equal(getModelRegistryEntry(t.db, "groq", "sloppy")!.recentFailureCount, 1);
      const events = t.db.prepare("SELECT payload FROM messages_events WHERE type='model.request' ORDER BY createdAt").all().map((r) => JSON.parse(String(r.payload)));
      assert.equal(events[0].structuredOutputValid, false);
      assert.ok(!JSON.stringify(events).includes("truncated"), "rejected text is never persisted");
    });
  });

  test("a provider-rejected generation that is strict JSON and schema-valid is accepted deterministically (no model repair)", async () => {
    await withProject([["index.html", HTML], ["style.css", BROKEN_CSS], ["app.js", JS]], async ({ t, taskId }) => {
      upsertModel(t.db, "groq", "picky", ["CODING"], 90);
      const result = await executeTask(t.db, taskId, {
        ...offlineOptions,
        freeProviderFetchImpl: (async () => jsonResponse(400, { error: { code: "json_validate_failed", failed_generation: JSON.stringify(devOutput({ "style.css": FIXED_CSS })) } })) as typeof fetch,
      });
      assert.equal(result.outcome, "succeeded");
      const events = t.db.prepare("SELECT payload FROM messages_events WHERE type='model.request'").all().map((r) => JSON.parse(String(r.payload)));
      assert.equal(events[0].responseDiagnostics.recoveredFromRejectedGeneration, true);
    });
  });

  test("pacing: when the provider's last-reported token window cannot admit the next request, the runner waits (bounded) instead of provoking a rejection", async () => {
    await withProject([["index.html", HTML], ["style.css", BROKEN_CSS], ["app.js", JS]], async ({ t, taskId }) => {
      upsertModel(t.db, "groq", "coder", ["CODING"]);
      const sleeps: number[] = [];
      const fetchImpl = (async () => chat(devOutput({ "style.css": FIXED_CSS }), { prompt_tokens: 100, completion_tokens: 10 }, { "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": "100", "x-ratelimit-reset-tokens": "5s" })) as typeof fetch;
      const opts = { ...offlineOptions, freeProviderFetchImpl: fetchImpl, freeProviderSleepImpl: async (ms: number) => { sleeps.push(ms); } };

      assert.equal((await executeTask(t.db, taskId, opts)).outcome, "succeeded");
      assert.deepEqual(sleeps, [], "nothing is known before the first response");
      t.db.prepare("UPDATE tasks SET status='PENDING', attemptCount=(SELECT MAX(attemptNumber) FROM task_attempts WHERE taskId=?) WHERE id=?").run(taskId, taskId);
      assert.equal((await executeTask(t.db, taskId, opts)).outcome, "succeeded");
      assert.equal(sleeps.length, 1);
      assert.ok(sleeps[0]! > 0 && sleeps[0]! <= 5_300, `waits for the reset window, got ${sleeps[0]}`);
    });
  });
});
