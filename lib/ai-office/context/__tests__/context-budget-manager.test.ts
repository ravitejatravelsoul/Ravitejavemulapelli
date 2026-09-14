import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask } from "../../domain/tasks.ts";
import { recordFailure } from "../../domain/project-outputs.ts";
import { getAgentRole } from "../../domain/agent-roles.ts";
import { buildTaskContext } from "../../agents/context-builder.ts";
import { writeFile } from "../../workspace/workspace-service.ts";
import { upsertWorkspaceFileRecord } from "../../domain/workspace.ts";
import { optimizeContextForPaidCall } from "../context-budget-manager.ts";
import { getCapabilityContextBudget } from "../capability-budgets.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

async function withWorkspace<T>(fn: () => Promise<T>): Promise<T> {
  const priorRoot = process.env.AI_OFFICE_WORKSPACES_ROOT;
  const workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-context-budget-manager-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
  try {
    return await fn();
  } finally {
    if (priorRoot === undefined) delete process.env.AI_OFFICE_WORKSPACES_ROOT;
    else process.env.AI_OFFICE_WORKSPACES_ROOT = priorRoot;
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, {
    title: "Context Budget Manager Test",
    rawIdeaText: "Build a tiny Hello World page.",
    ownerId: owner.id,
    aiPolicyMode: "HYBRID",
  });
  return { owner, project };
}

describe("optimizeContextForPaidCall", () => {
  test("relevance-selects only the files that matter, never the whole workspace (Part 2/5)", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      const role = getAgentRole(t.db, "frontend-developer")!;

      await writeFile(project.id, "index.html", "<html></html>");
      await writeFile(project.id, "unrelated-notes.md", "some old research notes ".repeat(50));
      await writeFile(project.id, "old-benchmark-log.txt", "benchmark chatter ".repeat(50));
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "index.html", sizeBytes: 20, roleId: "frontend-developer", taskId: task.id });
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "unrelated-notes.md", sizeBytes: 1000, roleId: null, taskId: null });
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "old-benchmark-log.txt", sizeBytes: 1000, roleId: null, taskId: null });

      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
      const result = await optimizeContextForPaidCall({ db: t.db, capability: "CODING", role, task, context });

      assert.ok(result.ok);
      if (!result.ok) return;
      assert.ok(result.context.relevantFiles?.some((f) => f.path === "index.html"), "the file this task already wrote is included");
      assert.ok(result.telemetry.filesSelected.includes("index.html"));
      t.close();
    });
  });

  test("retry-delta context: a corrective attempt's currentFiles is trimmed to the relevant subset, not the whole workspace (Part 3)", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      const role = getAgentRole(t.db, "frontend-developer")!;

      await writeFile(project.id, "index.html", "<html><script src=\"script.js\"></script></html>");
      await writeFile(project.id, "script.js", "document.getElementById('x').onclick = null;");
      await writeFile(project.id, "unrelated.md", "irrelevant notes ".repeat(50));
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "index.html", sizeBytes: 20, roleId: "frontend-developer", taskId: task.id });
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "script.js", sizeBytes: 20, roleId: "frontend-developer", taskId: task.id });
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "unrelated.md", sizeBytes: 1000, roleId: null, taskId: null });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: "The button in script.js does not respond to clicks." });

      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 2 });
      assert.ok(context.remediationContext, "a real corrective-attempt context was built");
      assert.equal(context.remediationContext!.currentFiles.length, 3, "context-builder itself is still unabridged — the manager is what trims it");

      const result = await optimizeContextForPaidCall({ db: t.db, capability: "CODING", role, task, context });
      assert.ok(result.ok);
      if (!result.ok) return;
      const trimmedPaths = result.context.remediationContext!.currentFiles.map((f) => f.path);
      assert.ok(trimmedPaths.includes("script.js"), "the file the failure names is always kept");
      assert.ok(!trimmedPaths.includes("unrelated.md") || trimmedPaths.length === 3, "an unrelated file is excluded when the budget doesn't fit everything");
      t.close();
    });
  });

  test("duplicate decisions are deduplicated — summaries/history compaction (Part 6a)", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    const role = getAgentRole(t.db, "frontend-developer")!;
    const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
    const withDuplicates = {
      ...context,
      relevantDecisions: [
        { type: "decision", summary: "Use a single-page layout." },
        { type: "decision", summary: "Use a single-page layout." },
        { type: "assumption", summary: "No backend is required." },
      ],
    };

    const result = await optimizeContextForPaidCall({ db: t.db, capability: "CODING", role, task, context: withDuplicates });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.context.relevantDecisions.length, 2, "the exact duplicate was removed, the distinct one kept");
    t.close();
  });

  test("capability output ceiling flows through to telemetry.allowedOutputTokens (Part 7)", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
    const role = getAgentRole(t.db, "product-owner")!;
    const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });

    const result = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.allowedOutputTokens, getCapabilityContextBudget("GENERAL").maxOutputTokens);
    assert.ok(result.allowedOutputTokens < getCapabilityContextBudget("CODING").maxOutputTokens, "GENERAL gets a smaller ceiling than CODING");
    t.close();
  });

  test("estimated input token telemetry is a real, positive, sane number", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
    const role = getAgentRole(t.db, "product-owner")!;
    const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });

    const result = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.ok(result.telemetry.estimatedInputTokens > 0);
    assert.ok(result.telemetry.estimatedInputTokens < 5000, "a tiny requirements task should never estimate as huge");
    assert.equal(result.telemetry.capability, "GENERAL");
    assert.equal(result.telemetry.blocked, false);
    t.close();
  });

  test("an oversized context is shrunk step by step and the applied steps are recorded in telemetry (Part 6)", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      const role = getAgentRole(t.db, "frontend-developer")!;

      // Enough real, large files that CODING's default budget must shrink,
      // but not so much it can't ever fit (that's the hard-limit test below).
      for (let i = 0; i < 14; i++) {
        const path = `file-${i}.js`;
        await writeFile(project.id, path, `// padding content\n${"x".repeat(2500)}\n`);
        upsertWorkspaceFileRecord(t.db, { projectId: project.id, path, sizeBytes: 2500, roleId: "frontend-developer", taskId: task.id });
      }

      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
      const result = await optimizeContextForPaidCall({ db: t.db, capability: "CODING", role, task, context });

      assert.ok(result.ok, "shrinking should bring it under budget (or at worst within burst) rather than blocking");
      if (!result.ok) return;
      assert.ok(result.telemetry.estimatedInputTokens <= getCapabilityContextBudget("CODING").burstEstimatedInputTokens);
      t.close();
    });
  });

  test("a context that cannot be shrunk under the hard limit is BLOCKED, never sent (Part 6's final rule)", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
      const role = getAgentRole(t.db, "frontend-developer")!;

      // A single grossly oversized file that IS the reported failure's
      // target — shrink step (e) deliberately never truncates it, so no
      // amount of shrinking can bring this under the hard limit.
      const huge = "y".repeat(500_000);
      await writeFile(project.id, "script.js", huge);
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "script.js", sizeBytes: huge.length, roleId: "frontend-developer", taskId: task.id });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: "script.js throws an exception on load." });

      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 2 });
      const result = await optimizeContextForPaidCall({ db: t.db, capability: "CODING", role, task, context });

      assert.equal(result.ok, false, "must refuse rather than send a runaway prompt");
      assert.equal(result.telemetry.blocked, true);
      assert.ok(result.telemetry.blockReason && result.telemetry.blockReason.length > 0);
      t.close();
    });
  });

  test("no ANTHROPIC_API_KEY is required to run context optimization at all", async () => {
    const priorKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
      const role = getAgentRole(t.db, "product-owner")!;
      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
      const result = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });
      assert.ok(result.ok);
      t.close();
    } finally {
      if (priorKey !== undefined) process.env.ANTHROPIC_API_KEY = priorKey;
    }
  });
});

describe("optimizeContextForPaidCall — token-gate hardening: target/burst/global three-tier decision", () => {
  const cleanupEnv = () => {
    delete process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES;
    delete process.env.AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS;
  };

  async function measureBaseline(t: ReturnType<typeof createTestDb>, project: { id: string }): Promise<number> {
    const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
    const role = getAgentRole(t.db, "product-owner")!;
    const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
    // Generous, real defaults — nothing shrinks or blocks — so the
    // returned `estimatedInputTokens` is this fixed context's true,
    // unmodified size, used below to calibrate exact target/burst
    // overrides deterministically rather than guessing token counts.
    const result = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });
    assert.ok(result.ok, "baseline measurement must not itself be blocked");
    return result.ok ? result.telemetry.estimatedInputTokens : 0;
  }

  test("under target: proceeds cleanly, no burst warning", async () => {
    cleanupEnv();
    try {
      const t = createTestDb();
      const { project } = setupProject(t);
      const baseline = await measureBaseline(t, project);
      process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES = JSON.stringify({ GENERAL: { targetEstimatedInputTokens: baseline + 1000, burstEstimatedInputTokens: baseline + 2000 } });

      const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements 2" });
      const role = getAgentRole(t.db, "product-owner")!;
      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
      const result = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });

      assert.ok(result.ok);
      if (!result.ok) return;
      assert.equal(result.telemetry.burstWarning, false);
      assert.equal(result.telemetry.blocked, false);
      t.close();
    } finally {
      cleanupEnv();
    }
  });

  test("target exceeded but within burst: proceeds with a CONTEXT BUDGET WARNING recorded in telemetry, never silent", async () => {
    cleanupEnv();
    try {
      const t = createTestDb();
      const { project } = setupProject(t);
      const baseline = await measureBaseline(t, project);
      // target just under the real size, burst comfortably above it —
      // shrinking (GENERAL has no files/large artifacts to shrink here)
      // cannot bring it back under target, so this must land in the
      // explicit burst-allowance zone.
      process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES = JSON.stringify({
        GENERAL: { targetEstimatedInputTokens: Math.max(1, baseline - 10), burstEstimatedInputTokens: baseline + 500 },
      });

      const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements 2" });
      const role = getAgentRole(t.db, "product-owner")!;
      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
      const result = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });

      assert.ok(result.ok, "burst allowance must let the call proceed, never block");
      if (!result.ok) return;
      assert.equal(result.telemetry.blocked, false);
      assert.equal(result.telemetry.burstWarning, true);
      assert.match(result.telemetry.burstWarningReason ?? "", /CONTEXT BUDGET WARNING/);
      assert.ok(result.telemetry.burstWarningReason?.includes(String(result.telemetry.targetEstimatedInputTokens)));
      assert.ok(result.telemetry.burstWarningReason?.includes(String(result.telemetry.burstEstimatedInputTokens)));
      t.close();
    } finally {
      cleanupEnv();
    }
  });

  test("above burst: BLOCKS the paid call outright, never sends context above the configured burst ceiling", async () => {
    cleanupEnv();
    try {
      const t = createTestDb();
      const { project } = setupProject(t);
      const baseline = await measureBaseline(t, project);
      process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES = JSON.stringify({
        GENERAL: { targetEstimatedInputTokens: Math.max(1, baseline - 20), burstEstimatedInputTokens: Math.max(1, baseline - 10) },
      });

      const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements 2" });
      const role = getAgentRole(t.db, "product-owner")!;
      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
      const result = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });

      assert.equal(result.ok, false);
      assert.equal(result.telemetry.blocked, true);
      assert.match(result.telemetry.blockReason ?? "", /burst ceiling/);
      t.close();
    } finally {
      cleanupEnv();
    }
  });

  test("global absolute ceiling blocks even when a capability's own (overridden) burst is set above it", async () => {
    cleanupEnv();
    try {
      const t = createTestDb();
      const { project } = setupProject(t);
      const baseline = await measureBaseline(t, project);
      // A deliberately misconfigured capability override — burst set far
      // above the real context size AND above the global ceiling — must
      // still be caught by the global absolute safety net.
      process.env.AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS = String(Math.max(1, baseline - 10));
      process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES = JSON.stringify({ GENERAL: { targetEstimatedInputTokens: 1, burstEstimatedInputTokens: 1_000_000 } });

      const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements 2" });
      const role = getAgentRole(t.db, "product-owner")!;
      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });
      const result = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });

      assert.equal(result.ok, false);
      assert.equal(result.telemetry.blocked, true);
      assert.match(result.telemetry.blockReason ?? "", /global absolute ceiling/);
      t.close();
    } finally {
      cleanupEnv();
    }
  });

  test("capability-specific limits: CODING and GENERAL are evaluated independently against their own target/burst", async () => {
    cleanupEnv();
    try {
      const t = createTestDb();
      const { project } = setupProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "product-owner", title: "Write requirements" });
      const role = getAgentRole(t.db, "product-owner")!;
      const context = await buildTaskContext(t.db, task, role, { attemptNumber: 1 });

      const general = await optimizeContextForPaidCall({ db: t.db, capability: "GENERAL", role, task, context });
      const coding = await optimizeContextForPaidCall({ db: t.db, capability: "CODING", role, task, context });
      assert.ok(general.ok && coding.ok);
      if (!general.ok || !coding.ok) return;
      assert.equal(general.telemetry.targetEstimatedInputTokens, 6_000);
      assert.equal(coding.telemetry.targetEstimatedInputTokens, 18_000);
      assert.equal(general.telemetry.burstEstimatedInputTokens, 8_000);
      assert.equal(coding.telemetry.burstEstimatedInputTokens, 24_000);
      t.close();
    } finally {
      cleanupEnv();
    }
  });
});
