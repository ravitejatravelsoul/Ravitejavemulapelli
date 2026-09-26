import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { listTasksForProject, type TaskRow } from "../../domain/tasks.ts";
import { planProject } from "../../orchestrator/orchestrator.ts";
import { runOneCycle } from "../../runner/runner.ts";
import { upsertModelRegistryEntry, recordModelHealthCheck, setModelBenchmarkScore, getModelRegistryEntry, listRoutingDecisions } from "../../domain/model-registry.ts";
import { listAiUsageForProject } from "../../domain/budget.ts";
import { recordEvent } from "../../domain/events.ts";

import { requiredCapabilitiesForTask } from "../free-model-capabilities.ts";
import { resetProviderTokenBudgetsForTests } from "../agent-runner.ts";

/**
 * Final routing resilience simulation — a full 8-role workflow driven by
 * the real runner (`runOneCycle`) and real `executeTask`, real workspace,
 * real headless-browser QA, real integrity gates, real router/registry —
 * with ONLY provider HTTP mocked. Registry mirrors the real acceptance
 * state: GPT-OSS-120B covers everything incl. REASONING; GPT-OSS-20B is
 * qualified for everything EXCEPT REASONING; one further model is
 * unqualified and must never be used. No real AI call, no Claude.
 */

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";
process.env.GROQ_API_KEY = "test-key";
process.env.AI_OFFICE_GROQ_FREE_TIER_CONFIRMED = "true";
process.env.AI_OFFICE_GROQ_FREE_MODELS = "openai/gpt-oss-120b,openai/gpt-oss-20b,openai/gpt-oss-unqualified";

const M120 = "openai/gpt-oss-120b";
const M20 = "openai/gpt-oss-20b";
const MBAD = "openai/gpt-oss-unqualified";
const IDEA = "Secure Task Notes: a small secure web page where a person can add, edit and delete short notes; notes may hold personal data; deleting asks for confirmation and a closed dialog must never block the page.";
const ALL = ["STRUCTURED_OUTPUT", "FAST", "GENERAL", "ARCHITECTURE", "CODING", "REVIEW", "TEST_GENERATION", "SECURITY", "RESEARCH"] as const;

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Notes</title><link rel="stylesheet" href="style.css"></head><body>
<h1>Secure Task Notes</h1><p>Add, edit and delete short notes on this page.</p><button id="add" type="button">Add note</button><p id="status"></p>
<div id="confirm" class="scrim hidden" role="alertdialog" aria-modal="true"><button id="yes" type="button">Yes</button></div>
<script src="script.js"></script></body></html>`;
const CSS = ".scrim { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; z-index: 1000; }\n.hidden { display: none !important; }\n";
const CSS_BROKEN = ".hidden { display: none; }\n.scrim { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; z-index: 1000; }\n";
const JS_OK = 'document.getElementById("add").addEventListener("click",function(){document.getElementById("status").textContent="Note added";});';
const JS_BUGGY = 'document.getElementById("add").addEventListener("click",function(){document.getElementById("missing").textContent="Note added";});';

const ARTIFACT: Record<string, string> = {
  "product-owner": "requirements", "research-agent": "research-notes", "solution-architect": "architecture", "ui-ux-agent": "ux-spec",
  "frontend-developer": "code", "backend-developer": "code", "qa-agent": "test-report", "security-reviewer": "security-report",
  "code-reviewer": "review-notes", "release-agent": "release-summary",
};

interface Seen { model: string; role: string; prompt: string; corrective: boolean; status: number }
interface Ctx {
  seen: Seen[];
  hosts: Set<string>;
  paidCalls: number;
  /** Return a Response to override the default valid answer; `n` is the 1-based call number for this (model, role). */
  script?: (req: Seen & { n: number }) => Response | undefined;
  devFiles: (corrective: boolean) => Record<string, string>;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function validOutput(role: string, devFiles: Record<string, string>) {
  return {
    summary: `${role} done`,
    artifacts: [{ kind: "artifact", artifactType: ARTIFACT[role] ?? "requirements", content: `# ${role}\nDetails for ${role}.` }],
    decisions: [], testResults: [], events: [], recommendedNextActions: [],
    fileOperations: role === "frontend-developer" ? Object.entries(devFiles).map(([path, content]) => ({ kind: "file-operation", action: "write", path, content })) : [],
  };
}

function makeFetch(ctx: Ctx): typeof fetch {
  const counts = new Map<string, number>();
  return (async (url: string, init: RequestInit) => {
    ctx.hosts.add(new URL(url).host);
    const body = JSON.parse(String(init.body));
    const prompt: string = body.messages[0].content;
    const role = /You are the "([a-z-]+)" role/.exec(prompt)?.[1] ?? "unknown";
    const key = `${body.model}|${role}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const req = { model: body.model as string, role, prompt, corrective: prompt.includes("CORRECTIVE ATTEMPT"), status: 200, n };
    const scripted = ctx.script?.(req);
    const res = scripted ?? json(200, {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validOutput(role, ctx.devFiles(req.corrective))) } }],
      usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: 200 },
    });
    ctx.seen.push({ ...req, status: res.status });
    return res;
  }) as unknown as typeof fetch;
}

function seedRegistry(db: ReturnType<typeof createTestDb>["db"], scores = { m120: 90, m20: 82 }) {
  const add = (modelId: string, caps: readonly string[], score: number, qualified: boolean) => {
    upsertModelRegistryEntry(db, { provider: "groq", modelId, displayName: modelId, capabilities: caps as never, contextWindow: 131072, structuredOutput: true });
    recordModelHealthCheck(db, "groq", modelId, { health: "HEALTHY" });
    setModelBenchmarkScore(db, "groq", modelId, { score, qualified });
  };
  add(M120, [...ALL, "REASONING"], scores.m120, true);
  add(M20, ALL, scores.m20, true);
  add(MBAD, [...ALL, "REASONING"], 100, false);
}

async function workflow<T>(opts: { devFiles?: (corrective: boolean) => Record<string, string>; claudeEnv?: string; script?: Ctx["script"]; policy?: "LOCAL_ONLY" | "CLAUDE_ONLY"; scores?: { m120: number; m20: number } }, fn: (h: {
  t: ReturnType<typeof createTestDb>; projectId: string; ctx: Ctx; cycle: () => Promise<string>; drive: (max?: number) => Promise<void>; tasks: () => TaskRow[]; execution: () => object;
}) => Promise<T>): Promise<T> {
  const prior = { root: process.env.AI_OFFICE_WORKSPACES_ROOT, claude: process.env.AI_OFFICE_CLAUDE_ENABLED };
  const root = mkdtempSync(join(tmpdir(), "ai-office-resilience-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = root;
  process.env.AI_OFFICE_CLAUDE_ENABLED = opts.claudeEnv ?? "false";
  resetProviderTokenBudgetsForTests();
  const t = createTestDb();
  try {
    seedRegistry(t.db, opts.scores);
    const { project } = createProjectWithIdea(t.db, { title: "Secure Task Notes", rawIdeaText: IDEA, ownerId: getOwner(t.db)!.id, routingMode: "FREE_MULTI_MODEL", aiPolicyMode: opts.policy ?? "LOCAL_ONLY" });
    planProject(t.db, project.id);
    const ctx: Ctx = { seen: [], hosts: new Set(), paidCalls: 0, script: opts.script, devFiles: opts.devFiles ?? (() => ({ "index.html": HTML, "style.css": CSS, "script.js": JS_OK })) };
    const fetchImpl = makeFetch(ctx);
    const execution = () => ({
      freeProviderFetchImpl: fetchImpl,
      // The local deliverable-intent check (a free local model call) is stubbed as "consistent".
      intentCheckFetch: (async () => ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ consistent: true, reason: "ok" }) }) }) as unknown as Response) as unknown as typeof fetch,
      retryDriftCheckOverride: async () => ({ consistent: true as const }),
      freeProviderSleepImpl: async () => {},
      claudeClientOverride: { messages: { create: async () => { ctx.paidCalls += 1; throw new Error("paid call forbidden"); } } } as never,
    });
    const cycle = async () => (await runOneCycle(t.db, "runner-sim", { execution: execution() })).kind;
    const drive = async (max = 60) => { for (let i = 0; i < max; i++) if ((await cycle()) !== "executed") break; };
    return await fn({ t, projectId: project.id, ctx, cycle, drive, tasks: () => listTasksForProject(t.db, project.id), execution });
  } finally {
    t.close();
    if (prior.root === undefined) delete process.env.AI_OFFICE_WORKSPACES_ROOT; else process.env.AI_OFFICE_WORKSPACES_ROOT = prior.root;
    if (prior.claude === undefined) delete process.env.AI_OFFICE_CLAUDE_ENABLED; else process.env.AI_OFFICE_CLAUDE_ENABLED = prior.claude;
    rmSync(root, { recursive: true, force: true });
  }
}

/** Prior real successes for a route (as accumulated in `model.request` events) — makes a model the router's preferred pick without touching qualification or health. */
function seedSuccessHistory(t: ReturnType<typeof createTestDb>, projectId: string, model: string, n = 20) {
  for (let i = 0; i < n; i++) recordEvent(t.db, { projectId, type: "model.request", actor: "system", payload: { provider: "groq", model, status: "SUCCEEDED", structuredOutputValid: true } });
}

const REASONING_ROLES = new Set(["product-owner", "solution-architect", "ui-ux-agent"]);
const statusOf = (tasks: TaskRow[]) => Object.fromEntries(tasks.map((x) => [x.roleId, x.status]));

/** Invariants that must hold for EVERY workflow path in this file. */
function assertGlobalGuards(h: { t: ReturnType<typeof createTestDb>; projectId: string; ctx: Ctx }) {
  assert.deepEqual([...h.ctx.hosts].filter((host) => host !== "api.groq.com"), [], "only the configured free provider host is ever contacted");
  assert.equal(h.ctx.paidCalls, 0, "Claude/paid client is never invoked");
  assert.ok(!h.ctx.seen.some((r) => r.model === MBAD), "an unqualified model is never requested, however high its score");
  assert.ok(!h.ctx.seen.some((r) => REASONING_ROLES.has(r.role) && r.model === M20), "20B is never assigned a REASONING task");
  const usage = listAiUsageForProject(h.t.db, h.projectId);
  assert.ok(usage.every((u) => u.costUsd === 0 && !/claude|anthropic/i.test(u.provider) && (u.provider === "groq" || (u.inputTokens === 0 && u.outputTokens === 0))), "every recorded call is $0; real token usage exists only for the free provider");
}

describe("1. normal complete workflow (PO → Architect → UX → Developer → QA → Security → Code Review → Release)", () => {
  test("all eight roles complete with real QA; reasoning roles use only 120B; nothing paid", async () => {
    await workflow({}, async (h) => {
      assert.deepEqual(h.tasks().map((x) => x.roleId).sort(), ["code-reviewer", "frontend-developer", "product-owner", "qa-agent", "release-agent", "security-reviewer", "solution-architect", "ui-ux-agent"]);
      await h.drive();
      assert.deepEqual(Object.values(statusOf(h.tasks())), Array(8).fill("DONE"), JSON.stringify(statusOf(h.tasks())) + " FAILURES: " + JSON.stringify(h.t.db.prepare("SELECT reason FROM failures").all().map((r) => String(r.reason).slice(0, 400))));
      assert.equal(getProject(h.t.db, h.projectId)!.status, "READY_FOR_REVIEW");
      for (const r of h.ctx.seen.filter((x) => REASONING_ROLES.has(x.role))) assert.equal(r.model, M120);
      // Routing decisions carry the classified capabilities for each role.
      const decisions = listRoutingDecisions(h.t.db, { projectId: h.projectId });
      assert.equal(decisions.length, 8);
      assert.ok(decisions.every((d) => d.result === "SUCCEEDED"));
      assertGlobalGuards(h);
    });
  });
});


const rows = (t: ReturnType<typeof createTestDb>, sql: string, ...args: (string | number)[]) => t.db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
const tokensOf = (prompt: string) => Math.ceil(prompt.length / 4);
const to429 = (seconds: string) => json(429, { error: { code: "rate_limit_exceeded" } }, { "retry-after": seconds });
const POLL_CYCLES = 8;

describe("2 + 3. 120B 429 with Retry-After on a reasoning task, then recovery after the cooldown", () => {
  test("no request storm, cooldown honored, honest health accounting, 20B never substituted, task waits without burning retries", async () => {
    await workflow({ script: (r) => (r.model === M120 && r.role === "product-owner" && r.n === 1 ? to429("13") : undefined) }, async (h) => {
      const before = Date.now();
      for (let i = 0; i < POLL_CYCLES; i++) await h.cycle(); // the runner polling every few seconds while the cooldown runs
      const po = h.tasks().find((x) => x.roleId === "product-owner")!;
      assert.equal(h.ctx.seen.filter((r) => r.role === "product-owner").length, 1, "exactly one request: no storm while cooling down");
      assert.equal(h.ctx.seen.filter((r) => r.role === "product-owner" && r.model === M20).length, 0, "20B never handles the REASONING task");
      assert.equal(po.status, "PENDING", "the task waits — it is not blocked or escalated");
      assert.equal(po.attemptCount, 1, "waiting for a cooldown consumed no retry attempts");
      const reg = getModelRegistryEntry(h.t.db, "groq", M120)!;
      assert.equal(reg.health, "UNAVAILABLE");
      assert.equal(reg.recentFailureCount, 1, "one real 429 = one failure, waiting adds none");
      assert.ok(reg.rateLimitedUntil! >= before + 12_000 && reg.rateLimitedUntil! <= Date.now() + 13_500, "cooldown follows Retry-After");
      assert.ok(rows(h.t, "SELECT id FROM messages_events WHERE type='task.free_routing_deferred'").length >= 1, "deferral is recorded");

      // 3. Time passes (the cooldown ends). No manual health reset of any kind.
      h.t.db.prepare("UPDATE model_registry SET rateLimitedUntil = ? WHERE id = ?").run(Date.now() - 1, `groq:${M120}`);
      assert.equal(getModelRegistryEntry(h.t.db, "groq", M120)!.recentFailureCount, 1, "failure count untouched by the test");
      await h.drive();
      assert.deepEqual(Object.values(statusOf(h.tasks())), Array(8).fill("DONE"), JSON.stringify(statusOf(h.tasks())));
      const after = getModelRegistryEntry(h.t.db, "groq", M120)!;
      assert.equal(after.health, "HEALTHY", "a real success restores health");
      assert.equal(after.recentFailureCount, 0);
      assert.equal(h.ctx.seen.filter((r) => r.role === "product-owner").length, 2, "one 429 then one successful retry");
      assertGlobalGuards(h);
    });
  });

  test("a cooldown longer than the bound is NOT waited out: the task fails honestly through the normal bounded path with zero requests", async () => {
    await workflow({}, async (h) => {
      h.t.db.prepare("UPDATE model_registry SET health='UNAVAILABLE', rateLimitedUntil=?, recentFailureCount=1 WHERE id=?").run(Date.now() + 10 * 60_000, `groq:${M120}`);
      await h.drive(12);
      const po = h.tasks().find((x) => x.roleId === "product-owner")!;
      assert.equal(po.status, "BLOCKED");
      assert.equal(h.ctx.seen.length, 0);
      assertGlobalGuards(h);
    });
  });
});

describe("4. 120B HTTP 413", () => {
  test("reasoning task: an unshrinkable 413 is sent once, never re-sent identically, never poisons health, never falls to 20B", async () => {
    await workflow({ script: (r) => (r.model === M120 && r.role === "product-owner" ? json(413, { error: { code: "rate_limit_exceeded", message: "Request too large. Limit 200, Requested 900" } }) : undefined) }, async (h) => {
      await h.drive(12);
      assert.equal(h.ctx.seen.filter((r) => r.role === "product-owner").length, 1, "the oversized request is never sent a second time");
      assert.equal(h.ctx.seen.filter((r) => r.role === "product-owner" && r.model === M20).length, 0);
      const reg = getModelRegistryEntry(h.t.db, "groq", M120)!;
      assert.equal(reg.recentFailureCount, 0, "a request-size rejection is not a model failure");
      assert.notEqual(reg.health, "UNAVAILABLE");
      assert.equal(h.tasks().find((x) => x.roleId === "product-owner")!.status, "BLOCKED", "fails honestly under the existing bounded policy");
      assertGlobalGuards(h);
    });
  });

  test("developer task: 413 on 120B falls back to qualified 20B (CODING) and the workflow completes; 120B health untouched", async () => {
    await workflow({ script: (r) => (r.model === M120 && r.role === "frontend-developer" ? json(413, { error: { code: "rate_limit_exceeded", message: "Request too large. Limit 150, Requested 5000" } }) : undefined) }, async (h) => {
      await h.drive();
      assert.deepEqual(Object.values(statusOf(h.tasks())), Array(8).fill("DONE"), JSON.stringify(statusOf(h.tasks())));
      const dev = h.ctx.seen.filter((r) => r.role === "frontend-developer");
      assert.deepEqual(dev.map((r) => r.model), [M120, M20], "one oversized attempt, then the legitimately-qualified fallback");
      assert.equal(getModelRegistryEntry(h.t.db, "groq", M120)!.recentFailureCount, 0);
      assertGlobalGuards(h);
    });
  });
});

describe("5. 20B invalid structured JSON", () => {
  test("truncated rejected output is a real failure and another eligible model handles the task; schema-valid rejected output is recovered strictly", async () => {
    await workflow({
      scores: { m120: 60, m20: 100 }, // 20B is preferred for non-reasoning work, so its failure modes are exercised
      script: (r) => {
        if (r.model !== M20) return undefined;
        if (r.role === "security-reviewer") return json(400, { error: { code: "json_validate_failed", failed_generation: '{"summary":"cut off mid' } });
        if (r.role === "code-reviewer") return json(400, { error: { code: "json_validate_failed", failed_generation: JSON.stringify(validOutput("code-reviewer", {})) } });
        return undefined;
      },
    }, async (h) => {
      seedSuccessHistory(h.t, h.projectId, M20);
      await h.drive();
      assert.deepEqual(Object.values(statusOf(h.tasks())), Array(8).fill("DONE"), JSON.stringify(statusOf(h.tasks())));
      const sec = h.ctx.seen.filter((r) => r.role === "security-reviewer").map((r) => r.model);
      assert.deepEqual(sec, [M20, M120], "invalid JSON never accepted; the other eligible model completed the task " + JSON.stringify(h.ctx.seen.map((r) => `${r.role}:${r.model.replace("openai/gpt-oss-", "")}:${r.status}`)));
      assert.equal(h.ctx.seen.filter((r) => r.role === "code-reviewer").length, 1, "strict, schema-valid rejected output is recovered without a second call");
      const events = rows(h.t, "SELECT payload FROM messages_events WHERE type='model.request' ORDER BY createdAt").map((r) => JSON.parse(String(r.payload)));
      assert.ok(events.some((e) => e.model === M20 && e.structuredOutputValid === false), "the invalid response is recorded as invalid");
      assert.ok(events.some((e) => e.responseDiagnostics?.recoveredFromRejectedGeneration === true));
      assert.ok(!JSON.stringify(events).includes("cut off mid"), "rejected text is never persisted");
      assertGlobalGuards(h);
    });
  });
});

describe("6. QA failure → Developer remediation → QA retest", () => {
  test("compact QA evidence and acceptance criteria reach a bounded remediation request; infrastructure failures are excluded; the corrected artifact passes QA retest", async () => {
    await workflow({ devFiles: (corrective) => ({ "index.html": HTML, "style.css": CSS, "script.js": corrective ? JS_OK : JS_BUGGY }) }, async (h) => {
      // Run until real QA has failed against the buggy first implementation.
      for (let i = 0; i < 30 && rows(h.t, "SELECT id FROM failures WHERE reason LIKE '%did not change any visible text%'").length === 0; i++) await h.cycle();
      assert.ok(rows(h.t, "SELECT id FROM failures WHERE reason LIKE '%did not change any visible text%'").length > 0, "real browser QA reported the product defect");
      // Infrastructure noise on the developer task must never reach the model as a "defect".
      const dev = h.tasks().find((x) => x.roleId === "frontend-developer")!;
      const ins = h.t.db.prepare("INSERT INTO failures (id, projectId, taskId, agentRunId, reason, resolved, createdAt, updatedAt) VALUES (?,?,?,NULL,?,0,?,?)");
      ins.run("infra-1", h.projectId, dev.id, 'Operational: groq responded with HTTP 413 (rate_limit_exceeded) for model "openai/gpt-oss-120b".', Date.now(), Date.now());
      ins.run("infra-2", h.projectId, dev.id, "No eligible free model is currently enabled/healthy for capability CODING (checked every configured free provider's registry).", Date.now(), Date.now());
      await h.drive();
      assert.deepEqual(Object.values(statusOf(h.tasks())), Array(8).fill("DONE"), JSON.stringify(statusOf(h.tasks())));

      const corrective = h.ctx.seen.filter((r) => r.role === "frontend-developer" && r.corrective);
      assert.ok(corrective.length >= 1);
      const prompt = corrective[0]!.prompt;
      assert.match(prompt, /did not change any visible text/, "the exact QA observation is preserved");
      assert.ok(prompt.includes(IDEA), "acceptance criteria (the authoritative request) are preserved");
      assert.match(prompt, /document\.getElementById\("missing"\)/, "the current implementation is provided");
      assert.ok(!prompt.includes(String.fromCharCode(27)), "no terminal escape codes");
      assert.ok(!/HTTP 413|No eligible free model/.test(prompt), "infrastructure failures are not presented as product defects");
      assert.ok(tokensOf(prompt) <= 8000 * 0.85, `remediation request stays under the provider ceiling (${tokensOf(prompt)} est. tokens)`);
      assert.ok(rows(h.t, "SELECT id FROM test_results WHERE status='PASS'").length >= 1, "QA retest passed against the corrected artifact");
      const reg = getModelRegistryEntry(h.t.db, "groq", M120)!;
      assert.equal(reg.tasksFailed, 0, "a legitimate QA verdict about the product is not a model failure");
      assert.equal(reg.recentFailureCount, 0);
      assertGlobalGuards(h);
    });
  });

  test("remediation 413 → one compact retry through the existing shrink order (smaller, evidence intact), no identical resend, health untouched", async () => {
    let correctiveCalls = 0;
    await workflow({
      devFiles: (corrective) => ({ "index.html": HTML, "style.css": CSS, "script.js": corrective ? JS_OK : JS_BUGGY }),
      script: (r) => {
        if (!(r.model === M120 && r.role === "frontend-developer" && r.corrective)) return undefined;
        correctiveCalls += 1;
        if (correctiveCalls !== 1) return undefined;
        const est = tokensOf(r.prompt);
        return json(413, { error: { code: "rate_limit_exceeded", message: `Request too large. Limit ${Math.floor((est * 0.7) / 0.85)}, Requested ${est}` } });
      },
    }, async (h) => {
      for (let i = 0; i < 30 && rows(h.t, "SELECT id FROM failures WHERE reason LIKE '%did not change any visible text%'").length === 0; i++) await h.cycle();
      // Unrelated bulky files appear in the workspace (as in a real project); relevance selection can drop them.
      const { writeFile } = await import("../../workspace/workspace-service.ts");
      const { upsertWorkspaceFileRecord } = await import("../../domain/workspace.ts");
      for (let i = 0; i < 6; i++) {
        const path = `notes-${i}.txt`, content = `unrelated filler ${i} `.repeat(230);
        await writeFile(h.projectId, path, content);
        upsertWorkspaceFileRecord(h.t.db, { projectId: h.projectId, path, sizeBytes: content.length, roleId: null, taskId: null });
      }
      await h.drive();
      const dev = h.ctx.seen.filter((r) => r.role === "frontend-developer" && r.corrective && r.model === M120);
      assert.equal(dev.length, 2, "one oversized request and exactly one compact retry " + JSON.stringify(h.ctx.seen.map((r) => `${r.role}:${r.model.replace("openai/gpt-oss-", "")}:${r.corrective ? "C" : "-"}:${r.status}:${r.prompt.length}`)));
      assert.ok(dev[1]!.prompt.length < dev[0]!.prompt.length, "the retry is genuinely smaller");
      assert.notEqual(dev[1]!.prompt, dev[0]!.prompt, "never an identical resend");
      assert.match(dev[1]!.prompt, /did not change any visible text/);
      assert.ok(dev[1]!.prompt.includes(IDEA));
      assert.match(dev[1]!.prompt, /--- script\.js ---/);
      assert.equal(getModelRegistryEntry(h.t.db, "groq", M120)!.recentFailureCount, 0);
      assert.deepEqual(Object.values(statusOf(h.tasks())), Array(8).fill("DONE"), JSON.stringify(statusOf(h.tasks())));
      assertGlobalGuards(h);
    });
  });
});

describe("7. hidden modal/overlay regression", () => {
  test("a developer response with the cascade defect is rejected by workspace integrity BEFORE QA runs; the corrected response then proceeds", async () => {
    await workflow({ devFiles: (corrective) => ({ "index.html": HTML, "style.css": corrective ? CSS : CSS_BROKEN, "script.js": JS_OK }) }, async (h) => {
      for (let i = 0; i < 30 && rows(h.t, "SELECT id FROM failures WHERE reason LIKE 'Workspace integrity validation failed%'").length === 0; i++) await h.cycle();
      const failure = String(rows(h.t, "SELECT reason FROM failures WHERE reason LIKE 'Workspace integrity validation failed%'")[0]?.reason);
      assert.match(failure, /stays displayed/);
      assert.match(failure, /!important/);
      assert.equal(rows(h.t, "SELECT ar.id FROM agent_runs ar JOIN task_attempts ta ON ta.id=ar.taskAttemptId JOIN tasks t ON t.id=ta.taskId WHERE t.roleId='qa-agent'").length, 0, "QA has not run yet");
      assert.equal(rows(h.t, "SELECT id FROM failures WHERE reason LIKE '%intercepts pointer events%'").length, 0, "the defect never reached the browser");
      await h.drive();
      assert.deepEqual(Object.values(statusOf(h.tasks())), Array(8).fill("DONE"), JSON.stringify(statusOf(h.tasks())));
      assert.ok(h.ctx.seen.find((r) => r.role === "frontend-developer" && r.corrective)!.prompt.includes("!important"), "the corrective attempt is told exactly what to fix");
      assertGlobalGuards(h);
    });
  });
});

describe("8. no workflow path can silently enable Claude, use paid fallback, bypass qualification or give 20B a REASONING task", () => {
  test("CLAUDE_ONLY policy with Claude enabled in the environment: the free-routing workflow still never calls Claude", async () => {
    await workflow({ policy: "CLAUDE_ONLY", claudeEnv: "true" }, async (h) => {
      await h.drive();
      assert.deepEqual(Object.values(statusOf(h.tasks())), Array(8).fill("DONE"));
      assert.equal(h.ctx.paidCalls, 0);
      assertGlobalGuards(h);
    });
  });

  test("with 120B unavailable (three-failure gate) the reasoning roles are refused, never rerouted to 20B, an unqualified model or Claude; no health reset occurs", async () => {
    await workflow({ policy: "CLAUDE_ONLY", claudeEnv: "true" }, async (h) => {
      h.t.db.prepare("UPDATE model_registry SET recentFailureCount = 3, health = 'UNAVAILABLE' WHERE id = ?").run(`groq:${M120}`);
      await h.drive(20);
      assert.equal(h.ctx.seen.length, 0, "not a single provider request was made");
      assert.equal(h.tasks().find((x) => x.roleId === "product-owner")!.status, "BLOCKED");
      const reg = getModelRegistryEntry(h.t.db, "groq", M120)!;
      assert.equal(reg.recentFailureCount, 3, "the gate is never reset by the workflow");
      assert.equal(reg.health, "UNAVAILABLE");
      assertGlobalGuards(h);
    });
  });

  test("the router itself refuses 20B and the unqualified model for REASONING capability sets", async () => {
    await workflow({}, async (h) => {
      const { selectFreeModel } = await import("../free-model-router.ts");
      for (const role of ["product-owner", "solution-architect", "ui-ux-agent"] as const) {
        const caps = requiredCapabilitiesForTask(role, `Do ${role}`);
        assert.ok(caps.includes("REASONING"), role);
        const sel = selectFreeModel(h.t.db, { capability: caps[0]!, requiredCapabilities: caps });
        assert.equal(sel!.modelId, M120);
        assert.deepEqual(sel!.candidates.map((c) => c.modelId), [M120], "only the qualified reasoning-capable model is a candidate");
      }
      h.t.db.prepare("UPDATE model_registry SET enabled = 0 WHERE id = ?").run(`groq:${M120}`);
      for (const role of ["product-owner", "solution-architect", "ui-ux-agent"] as const) {
        const caps = requiredCapabilitiesForTask(role, `Do ${role}`);
        assert.equal(selectFreeModel(h.t.db, { capability: caps[0]!, requiredCapabilities: caps }), null, "20B (healthy, qualified) is not a substitute for REASONING");
      }
      const dev = requiredCapabilitiesForTask("frontend-developer", "Implement frontend");
      assert.deepEqual(selectFreeModel(h.t.db, { capability: dev[0]!, requiredCapabilities: dev })!.candidates.map((c) => c.modelId), [M20]);
    });
  });
});
