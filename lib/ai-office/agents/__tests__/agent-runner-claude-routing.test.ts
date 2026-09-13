import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, getTask, listTaskAttempts } from "../../domain/tasks.ts";
import { listApprovalsForProject, recordFailure, getEffectiveApprovalStatus, createApproval, type ApprovalRow } from "../../domain/project-outputs.ts";
import { approveApproval, rejectApproval, revokeApproval, checkRevokeEligibility } from "../../approvals/approval-service.ts";
import {
  listAiUsageForProject,
  createBudgetReservation,
  reconcileBudgetReservation,
  releaseBudgetReservation,
  startOfCurrentMonthUtc,
} from "../../domain/budget.ts";
import { upsertRecommendedRouting, applyRecommendedRouting } from "../../domain/model-routing.ts";
import { listFiles, writeFile } from "../../workspace/workspace-service.ts";
import { upsertWorkspaceFileRecord } from "../../domain/workspace.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { updateTaskStatus } from "../../domain/tasks.ts";
import { executeTask } from "../agent-runner.ts";
import { getProjectDetail } from "../../dashboard/project-detail-data.ts";

/**
 * Integration coverage for the controlled Claude LIVE pilot's real
 * execution path — everything in `agent-runner.test.ts` exercises
 * `executeTask` with `options.provider` injected directly, which
 * deliberately bypasses this entire routing/approval/budget gate. These
 * tests never set `options.provider`; they seed real capability
 * evidence and a real `aiPolicyMode` so `routeProvider`/
 * `prepareClaudeCall` run for real, only replacing the Anthropic HTTP
 * client itself (`options.claudeClientOverride`) so nothing here ever
 * makes a real network call or requires a real API key.
 */

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.ANTHROPIC_INPUT_PRICE_PER_MTOK = "3";
  process.env.ANTHROPIC_OUTPUT_PRICE_PER_MTOK = "15";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function withWorkspace<T>(fn: () => Promise<T>): Promise<T> {
  const priorRoot = process.env.AI_OFFICE_WORKSPACES_ROOT;
  const workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-claude-routing-workspace-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
  try {
    return await fn();
  } finally {
    if (priorRoot === undefined) delete process.env.AI_OFFICE_WORKSPACES_ROOT;
    else process.env.AI_OFFICE_WORKSPACES_ROOT = priorRoot;
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

/** Seeds the exact real evidence shape the pilot's HYBRID policy is built on: CODING has no qualified local model, so ProviderRouter sends frontend-developer/backend-developer to Claude. */
function seedNoQualifiedLocalCoding(db: Parameters<typeof upsertRecommendedRouting>[0]) {
  upsertRecommendedRouting(db, { capability: "CODING", model: "NO QUALIFIED LOCAL MODEL", reason: "gemma4/qwen3.6/qwen2.5-coder all 0%" });
  applyRecommendedRouting(db);
}

function setupHybridProject(t: ReturnType<typeof createTestDb>, opts: { monthlyBudgetCapUsd?: number | null } = {}) {
  const owner = getOwner(t.db)!;
  seedNoQualifiedLocalCoding(t.db);
  const { project } = createProjectWithIdea(t.db, {
    title: "Hybrid Claude Routing Test",
    rawIdeaText: "Create a tiny Hello World webpage.",
    ownerId: owner.id,
    aiPolicyMode: "HYBRID",
    monthlyBudgetCapUsd: opts.monthlyBudgetCapUsd ?? 3.0,
  });
  return { owner, project };
}

function claudeTextMessage(text: string, usage = { input_tokens: 1000, output_tokens: 500 }) {
  return { content: [{ type: "text", text, citations: null }], usage } as unknown as Awaited<
    ReturnType<import("@anthropic-ai/sdk").default["messages"]["create"]>
  >;
}

function claudeClient(handler: () => ReturnType<typeof claudeTextMessage> | Promise<ReturnType<typeof claudeTextMessage>>) {
  return { messages: { create: async () => handler() } } as unknown as import("../../providers/claude/claude-adapter.ts").ClaudeAdapterOptions["client"];
}

const GOOD_HTML_ONLY_OUTPUT = JSON.stringify({
  summary: "Implemented a self-contained Hello World page.",
  artifacts: [],
  decisions: [],
  testResults: [],
  events: [],
  fileOperations: [{ kind: "file-operation", action: "write", path: "index.html", content: "<html><body><h1>Hello, World!</h1></body></html>" }],
  recommendedNextActions: [],
});

const BROKEN_REFERENCE_OUTPUT = JSON.stringify({
  summary: "Implemented a page that references a script that was never written.",
  artifacts: [],
  decisions: [],
  testResults: [],
  events: [],
  fileOperations: [
    { kind: "file-operation", action: "write", path: "index.html", content: '<html><body><script src="script.js"></script></body></html>' },
  ],
  recommendedNextActions: [],
});

describe("controlled Claude LIVE pilot — real routing/approval/budget integration", () => {
  test("HYBRID + CODING with no qualified local model creates a project-scoped approval and blocks — no TaskAttempt is created", async () => {
    const t = createTestDb();
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    const result = await executeTask(t.db, task.id);

    assert.equal(result.outcome, "claude-blocked");
    assert.match(result.reason ?? "", /PAID AI APPROVAL REQUIRED/);
    assert.equal(getTask(t.db, task.id)?.status, "PENDING", "reverted, never left stuck IN_PROGRESS");
    assert.equal(listTaskAttempts(t.db, task.id).length, 0, "a not-yet-actionable routing decision must never consume a real attempt");

    const approvals = listApprovalsForProject(t.db, project.id);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].kind, "paid_service_purchase");
    assert.equal(approvals[0].taskId, null, "project-scoped, not task-scoped");
    assert.equal(approvals[0].status, "PENDING");

    t.close();
  });

  test("a second executeTask call while the approval is still pending does not create a duplicate approval", async () => {
    const t = createTestDb();
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    await executeTask(t.db, task.id);
    await executeTask(t.db, task.id);

    assert.equal(listApprovalsForProject(t.db, project.id).length, 1);
    t.close();
  });

  test("a rejected approval blocks the role permanently, with a clear reason", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    await executeTask(t.db, task.id);
    const approval = listApprovalsForProject(t.db, project.id)[0];
    rejectApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });

    const result = await executeTask(t.db, task.id);
    assert.equal(result.outcome, "claude-blocked");
    assert.match(result.reason ?? "", /rejected/i);
    t.close();
  });

  test("approving Claude for one project never authorizes a different project (no cross-project approval leak)", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project: projectA } = setupHybridProject(t);
    const { project: projectB } = createProjectWithIdea(t.db, {
      title: "Second Hybrid Project",
      rawIdeaText: "A different app.",
      ownerId: owner.id,
      aiPolicyMode: "HYBRID",
      monthlyBudgetCapUsd: 3.0,
    });
    const taskA = createTask(t.db, { projectId: projectA.id, roleId: "frontend-developer", title: "Implement frontend" });
    const taskB = createTask(t.db, { projectId: projectB.id, roleId: "frontend-developer", title: "Implement frontend" });

    await executeTask(t.db, taskA.id);
    const approvalA = listApprovalsForProject(t.db, projectA.id)[0];
    approveApproval(t.db, { approvalId: approvalA.id, decidedByUserId: owner.id });

    // Project B never had its own approval requested/decided yet.
    const resultB = await executeTask(t.db, taskB.id);
    assert.equal(resultB.outcome, "claude-blocked");
    assert.match(resultB.reason ?? "", /PAID AI APPROVAL REQUIRED/);
    assert.equal(listApprovalsForProject(t.db, projectB.id).length, 1, "project B gets its own, independent approval request");

    t.close();
  });

  test("approved but no ANTHROPIC_API_KEY configured is a clean blocked state, not a thrown exception", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    await executeTask(t.db, task.id);
    const approval = listApprovalsForProject(t.db, project.id)[0];
    approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });

    delete process.env.ANTHROPIC_API_KEY;
    const result = await executeTask(t.db, task.id);
    assert.equal(result.outcome, "claude-blocked");
    assert.match(result.reason ?? "", /ANTHROPIC_API_KEY/);
    assert.equal(listTaskAttempts(t.db, task.id).length, 0);

    t.close();
  });

  test("real system-reliability regression: a Claude-blocked task repeatedly cycling claim->block->reset never reduces the progress of already-DONE tasks (first Claude LIVE pilot incident)", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);

    // Two earlier tasks complete for real, exactly like the real pilot's
    // Product Owner / Solution Architect steps — GENERAL/REASONING have no
    // seeded evidence, so they stay LOCAL (SimulatedAdapter) and finish immediately.
    const poTask = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Define requirements" });
    await executeTask(t.db, poTask.id);
    const architectTask = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    await executeTask(t.db, architectTask.id);
    assert.equal(getTask(t.db, poTask.id)?.status, "DONE");
    assert.equal(getTask(t.db, architectTask.id)?.status, "DONE");

    const frontendTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    await executeTask(t.db, frontendTask.id); // creates the real Claude approval
    const approval = listApprovalsForProject(t.db, project.id)[0];
    approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
    delete process.env.ANTHROPIC_API_KEY; // matches the real incident: approved, but the runner process never loaded pricing/key config

    // The real incident: the runner re-polls this task every cycle, and
    // each cycle claims it, hits the (still unconfigured) Claude gate, and
    // resets it to PENDING — repeated several times in a row in real life.
    for (let i = 0; i < 5; i++) {
      const result = await executeTask(t.db, frontendTask.id);
      assert.equal(result.outcome, "claude-blocked");

      // The actual bug report: progress must stay authoritative and
      // stable across repeated reads while this cycle is happening —
      // never regress from what's genuinely persisted.
      const detail = getProjectDetail(t.db, project.id);
      assert.equal(detail!.progress.completed, 2, `progress.completed must stay 2 on read #${i + 1}, never regress`);
      assert.equal(detail!.tasks.find((tk) => tk.id === poTask.id)?.status, "DONE");
      assert.equal(detail!.tasks.find((tk) => tk.id === architectTask.id)?.status, "DONE");

      // Reading it again immediately must be identical — no drift between calls.
      const detailAgain = getProjectDetail(t.db, project.id);
      assert.equal(detailAgain!.progress.completed, detail!.progress.completed);
    }

    t.close();
  });

  test("approved + configured but over the project's LIVE budget cap refuses without ever calling the adapter", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t, { monthlyBudgetCapUsd: 0.00001 });
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    await executeTask(t.db, task.id);
    const approval = listApprovalsForProject(t.db, project.id)[0];
    approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

    let called = false;
    const result = await executeTask(t.db, task.id, {
      claudeClientOverride: claudeClient(() => {
        called = true;
        return claudeTextMessage(GOOD_HTML_ONLY_OUTPUT);
      }),
    });

    assert.equal(result.outcome, "claude-blocked");
    assert.match(result.reason ?? "", /cap/i);
    assert.equal(called, false, "refused before ever reaching the provider");
    assert.equal(listAiUsageForProject(t.db, project.id).length, 0);

    t.close();
  });

  test("a fully approved, configured, in-budget HYBRID project's CODING role runs a real (mocked) Claude call: real files, real routing, real reconciled cost", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id);
      const approval = listApprovalsForProject(t.db, project.id)[0];
      approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

      const result = await executeTask(t.db, task.id, {
        claudeClientOverride: claudeClient(() => claudeTextMessage(GOOD_HTML_ONLY_OUTPUT)),
      });

      assert.equal(result.outcome, "succeeded");
      assert.equal(result.agentRun?.provider, "claude");

      const files = await listFiles(project.id);
      assert.deepEqual(files, ["index.html"]);

      const usage = listAiUsageForProject(t.db, project.id);
      assert.equal(usage.length, 1);
      assert.equal(usage[0].provider, "claude");
      // 1000/1e6*3 + 500/1e6*15 = 0.0105 — the real usage the mocked call returned, never $0.
      assert.ok(Math.abs(usage[0].costUsd - 0.0105) < 1e-9, `unexpected cost: ${usage[0].costUsd}`);

      t.close();
    });
  });

  test("a Claude response referencing a file that was never created still fails real workspace-integrity validation, and still records real cost", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id);
      const approval = listApprovalsForProject(t.db, project.id)[0];
      approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

      const result = await executeTask(t.db, task.id, {
        claudeClientOverride: claudeClient(() => claudeTextMessage(BROKEN_REFERENCE_OUTPUT)),
      });

      assert.equal(result.outcome, "retried", "a real deliverable-integrity failure is a normal, counted task failure — never silently accepted");
      assert.match(result.reason ?? "", /script\.js/);

      // The Claude call itself really happened and really billed — the
      // integrity gate runs *after* materialization, so this must never
      // be reported as a free/no-cost call.
      const usage = listAiUsageForProject(t.db, project.id);
      assert.equal(usage.length, 1);
      assert.ok(usage[0].costUsd > 0, "a real Claude call that got rejected by a downstream gate still cost real money");

      t.close();
    });
  });

  test("CLAUDE_ONLY routes a non-CODING role (product-owner) to Claude too, and still requires owner approval first", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "Claude Only Project",
      rawIdeaText: "Anything.",
      ownerId: owner.id,
      aiPolicyMode: "CLAUDE_ONLY",
      monthlyBudgetCapUsd: 3.0,
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });

    const result = await executeTask(t.db, task.id);
    assert.equal(result.outcome, "claude-blocked");
    assert.match(result.reason ?? "", /PAID AI APPROVAL REQUIRED/);

    t.close();
  });

  test("LOCAL_ONLY never creates an approval or reaches the Claude gate, even with NO_QUALIFIED_MODEL evidence for CODING", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    seedNoQualifiedLocalCoding(t.db);
    const { project } = createProjectWithIdea(t.db, {
      title: "Local Only Project",
      rawIdeaText: "A tiny app.",
      ownerId: owner.id,
      aiPolicyMode: "LOCAL_ONLY",
    });
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    const result = await executeTask(t.db, task.id, { scenario: "success" });

    assert.notEqual(result.outcome, "claude-blocked");
    assert.equal(listApprovalsForProject(t.db, project.id).length, 0);
    assert.equal(result.agentRun?.provider, "simulated");
    assert.equal(
      listEventsForProject(t.db, project.id).some((e) => e.type === "claude.context_prepared"),
      false,
      "LOCAL calls never pass through the Context Budget Manager — Part 12",
    );

    t.close();
  });

  test("token economics: a real Claude call persists context-optimization telemetry (estimated tokens, capability, sections, files) before the call is made", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id);
      const approval = listApprovalsForProject(t.db, project.id)[0];
      approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

      await executeTask(t.db, task.id, { claudeClientOverride: claudeClient(() => claudeTextMessage(GOOD_HTML_ONLY_OUTPUT)) });

      const telemetryEvents = listEventsForProject(t.db, project.id).filter((e) => e.type === "claude.context_prepared");
      assert.equal(telemetryEvents.length, 1);
      const payload = JSON.parse(telemetryEvents[0].payload) as { capability: string; estimatedInputTokens: number; allowedOutputTokens: number; taskId: string };
      assert.equal(payload.capability, "CODING");
      assert.equal(payload.taskId, task.id);
      assert.ok(payload.estimatedInputTokens > 0);
      assert.ok(payload.allowedOutputTokens > 0);

      t.close();
    });
  });

  test("token economics: relevance-selection keeps the estimated/actual input tokens bounded even when many unrelated files exist in the workspace", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      // A pile of large, unrelated pre-existing files — an unoptimized
      // "send everything" context would be huge; relevance-selection
      // (Part 2/5) must keep the real request small regardless.
      for (let i = 0; i < 20; i++) {
        const path = `unrelated-${i}.txt`;
        const content = `irrelevant historical content ${i} `.repeat(200);
        await writeFile(project.id, path, content);
        upsertWorkspaceFileRecord(t.db, { projectId: project.id, path, sizeBytes: content.length, roleId: null, taskId: null });
      }

      await executeTask(t.db, task.id);
      const approval = listApprovalsForProject(t.db, project.id)[0];
      approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

      const result = await executeTask(t.db, task.id, { claudeClientOverride: claudeClient(() => claudeTextMessage(GOOD_HTML_ONLY_OUTPUT)) });
      assert.equal(result.outcome, "succeeded");

      const telemetry = JSON.parse(listEventsForProject(t.db, project.id).find((e) => e.type === "claude.context_prepared")!.payload) as {
        filesSelected: string[];
        filesExcluded: string[];
      };
      assert.ok(telemetry.filesExcluded.length > 0, "most of the 20 unrelated files were excluded, not all sent");
      assert.ok(telemetry.filesSelected.length < 20, "never the whole workspace");

      t.close();
    });
  });

  test("token economics: repeated identical-failure retries trigger a runaway warning event without blocking the retry (Part 11)", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id);
      const approval = listApprovalsForProject(t.db, project.id)[0];
      approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

      // Simulate the same unresolved failure having already recurred
      // twice for this task before this attempt even runs.
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: "The button never responds to clicks." });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: "The button never responds to clicks." });
      updateTaskStatus(t.db, task.id, "PENDING");

      const result = await executeTask(t.db, task.id, { claudeClientOverride: claudeClient(() => claudeTextMessage(GOOD_HTML_ONLY_OUTPUT)) });
      assert.equal(result.outcome, "succeeded", "a runaway signal is a warning, never a new hard stop — Part 11");

      const runawayEvents = listEventsForProject(t.db, project.id).filter((e) => e.type === "claude.runaway_warning");
      assert.equal(runawayEvents.length, 1);
      assert.match(JSON.parse(runawayEvents[0].payload).reason, /recurred/);

      t.close();
    });
  });

  test("token economics: budget reservation is authorized against the OPTIMIZED context's estimate, not an unoptimized full-workspace estimate", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      const unrelatedContent = "z".repeat(20_000);
      let rawUnoptimizedChars = 0;
      for (let i = 0; i < 15; i++) {
        const path = `unrelated-${i}.txt`;
        await writeFile(project.id, path, unrelatedContent);
        upsertWorkspaceFileRecord(t.db, { projectId: project.id, path, sizeBytes: unrelatedContent.length, roleId: null, taskId: null });
        rawUnoptimizedChars += unrelatedContent.length;
      }

      await executeTask(t.db, task.id);
      const approval = listApprovalsForProject(t.db, project.id)[0];
      approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

      const result = await executeTask(t.db, task.id, { claudeClientOverride: claudeClient(() => claudeTextMessage(GOOD_HTML_ONLY_OUTPUT)) });
      assert.equal(result.outcome, "succeeded");

      const telemetry = JSON.parse(listEventsForProject(t.db, project.id).find((e) => e.type === "claude.context_prepared")!.payload) as {
        estimatedInputTokens: number;
      };
      // 15 unrelated files x 20,000 chars ~ 75,000 tokens raw — the real,
      // reserved-against estimate must be a tiny fraction of that, proving
      // the reservation was computed from the trimmed context, not a full
      // dump of every file in the workspace.
      const rawUnoptimizedEstimatedTokens = Math.ceil(rawUnoptimizedChars / 4);
      assert.ok(
        telemetry.estimatedInputTokens < rawUnoptimizedEstimatedTokens / 3,
        `optimized estimate (${telemetry.estimatedInputTokens}) should be substantially below the raw unoptimized estimate (${rawUnoptimizedEstimatedTokens})`,
      );
      assert.ok(telemetry.estimatedInputTokens <= 18_000, "must fit within CODING's own soft budget after shrinking");

      t.close();
    });
  });
});

describe("Revoke-approval capability — second Claude LIVE pilot safety gap", () => {
  test("revoking an untouched APPROVED approval preserves the original decision and records a real, auditable revocation", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    await executeTask(t.db, task.id);
    const requested = listApprovalsForProject(t.db, project.id)[0];
    const approved = approveApproval(t.db, { approvalId: requested.id, decidedByUserId: owner.id });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    const approval = approved.approval; // the real, post-decision row — not the stale pre-approval one
    const originalDecidedAt = approval.decidedAt;

    const eligibility = checkRevokeEligibility(t.db, approval);
    assert.equal(eligibility.eligible, true);

    const result = revokeApproval(t.db, { approvalId: approval.id, revokedByUserId: owner.id, note: "Changed my mind before it ran." });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Raw status stays within the existing schema (never widened) —
    // REJECTED under the hood — but the effective, owner-facing status is REVOKED.
    assert.equal(result.approval.status, "REJECTED");
    assert.equal(getEffectiveApprovalStatus(result.approval), "REVOKED");

    // History preserved exactly — nothing about the original decision was touched.
    assert.equal(result.approval.decidedAt, originalDecidedAt);
    assert.equal(result.approval.decidedBy, owner.id);

    // The revocation itself is separately, explicitly recorded.
    assert.equal(result.approval.revokedBy, owner.id);
    assert.ok(result.approval.revokedAt);
    assert.equal(result.approval.revocationNote, "Changed my mind before it ran.");

    const events = listEventsForProject(t.db, project.id).filter((e) => e.type === "approval.revoked");
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(events[0].payload).approvalId, approval.id);

    t.close();
  });

  test("once revoked, the runner treats it as NOT authorized and creates a fresh PENDING approval on the next encounter — never a permanent block", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    await executeTask(t.db, task.id);
    const firstApproval = listApprovalsForProject(t.db, project.id)[0];
    approveApproval(t.db, { approvalId: firstApproval.id, decidedByUserId: owner.id });
    revokeApproval(t.db, { approvalId: firstApproval.id, revokedByUserId: owner.id });

    // Not authorized: a paid call must not be reachable using the revoked approval.
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";
    const blockedResult = await executeTask(t.db, task.id, { claudeClientOverride: claudeClient(() => claudeTextMessage(GOOD_HTML_ONLY_OUTPUT)) });
    assert.equal(blockedResult.outcome, "claude-blocked");
    assert.match(blockedResult.reason ?? "", /PAID AI APPROVAL REQUIRED/, "must ask again from scratch, not report a permanent rejection");

    const approvals = listApprovalsForProject(t.db, project.id);
    assert.equal(approvals.length, 2, "a fresh approval was created — the old one was never reused or resurrected");
    const newApproval = approvals.find((a) => a.id !== firstApproval.id)!;
    assert.equal(newApproval.status, "PENDING");
    assert.equal(listAiUsageForProject(t.db, project.id).length, 0, "still zero real usage — nothing was ever authorized under the revoked approval");

    t.close();
  });

  test("revocation is refused once a real (mocked) Claude call already recorded usage", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await executeTask(t.db, task.id);
      const requested = listApprovalsForProject(t.db, project.id)[0];
      approveApproval(t.db, { approvalId: requested.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";
      await executeTask(t.db, task.id, { claudeClientOverride: claudeClient(() => claudeTextMessage(GOOD_HTML_ONLY_OUTPUT)) });
      assert.equal(listAiUsageForProject(t.db, project.id).length, 1, "sanity: the mocked call really did record usage");

      const approval = listApprovalsForProject(t.db, project.id)[0]; // the real, current (still APPROVED) row
      const eligibility = checkRevokeEligibility(t.db, approval);
      assert.equal(eligibility.eligible, false);
      assert.match(eligibility.reason ?? "", /already/i);

      const result = revokeApproval(t.db, { approvalId: approval.id, revokedByUserId: owner.id });
      assert.equal(result.ok, false);
      assert.equal(getApprovalStatusFor(t.db, approval.id), "APPROVED", "must remain APPROVED — revocation must not silently succeed after real usage");

      t.close();
    });
  });

  test("revocation is refused while a budget reservation for this provider is still RESERVED (in flight) or RECONCILED (settled), but allowed once it's only RELEASED", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    await executeTask(t.db, task.id);
    const approval = listApprovalsForProject(t.db, project.id)[0];
    approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });

    const reservation = createBudgetReservation(t.db, { projectId: project.id, provider: "claude", estimatedCostUsd: 0.02, periodStart: startOfCurrentMonthUtc() });

    let result = revokeApproval(t.db, { approvalId: approval.id, revokedByUserId: owner.id });
    assert.equal(result.ok, false, "RESERVED (a call may be in flight right now) must block revocation");

    reconcileBudgetReservation(t.db, reservation.id, 0.015);
    result = revokeApproval(t.db, { approvalId: approval.id, revokedByUserId: owner.id });
    assert.equal(result.ok, false, "RECONCILED (real money was spent) must block revocation");

    t.close();
  });

  test("revocation is allowed once the only reservation for this provider was safely RELEASED, never consumed", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    await executeTask(t.db, task.id);
    const approval = listApprovalsForProject(t.db, project.id)[0];
    approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });

    const reservation = createBudgetReservation(t.db, { projectId: project.id, provider: "claude", estimatedCostUsd: 0.02, periodStart: startOfCurrentMonthUtc() });
    releaseBudgetReservation(t.db, reservation.id);

    const result = revokeApproval(t.db, { approvalId: approval.id, revokedByUserId: owner.id });
    assert.equal(result.ok, true, "a cleanly-released reservation carries no live claim and must not block revocation");

    t.close();
  });

  test("only a currently APPROVED approval can be revoked — PENDING, REJECTED, and already-revoked all refuse with a clear reason", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);

    const pendingTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    await executeTask(t.db, pendingTask.id);
    const pendingApproval = listApprovalsForProject(t.db, project.id)[0];
    assert.equal(revokeApproval(t.db, { approvalId: pendingApproval.id, revokedByUserId: owner.id }).ok, false);

    rejectApproval(t.db, { approvalId: pendingApproval.id, decidedByUserId: owner.id });
    assert.equal(revokeApproval(t.db, { approvalId: pendingApproval.id, revokedByUserId: owner.id }).ok, false, "a real rejection is not revocable — it's already terminal");

    const { project: project2 } = setupHybridProject(t, { monthlyBudgetCapUsd: 3.0 });
    const task2 = createTask(t.db, { projectId: project2.id, roleId: "frontend-developer", title: "Implement frontend" });
    await executeTask(t.db, task2.id);
    const approval2 = listApprovalsForProject(t.db, project2.id)[0];
    approveApproval(t.db, { approvalId: approval2.id, decidedByUserId: owner.id });
    const first = revokeApproval(t.db, { approvalId: approval2.id, revokedByUserId: owner.id });
    assert.equal(first.ok, true);
    const second = revokeApproval(t.db, { approvalId: approval2.id, revokedByUserId: owner.id });
    assert.equal(second.ok, false, "revoking an already-revoked approval is a safe no-op refusal, never a double-decrement or crash");

    t.close();
  });

  test("revoking a non-Claude approval kind with no provider in its context is allowed unconditionally (nothing to check)", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);

    const approval = createApproval(t.db, {
      projectId: project.id,
      kind: "production_deploy",
      requestedBy: "system",
      context: { reason: "Ship it." },
    });
    approveApproval(t.db, { approvalId: approval.id, decidedByUserId: owner.id });

    const approved: ApprovalRow = { ...approval, status: "APPROVED" };
    assert.equal(checkRevokeEligibility(t.db, approved).eligible, true);

    t.close();
  });
});

function getApprovalStatusFor(db: DatabaseSync, approvalId: string): string | undefined {
  return (db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId) as { status: string } | undefined)?.status;
}
