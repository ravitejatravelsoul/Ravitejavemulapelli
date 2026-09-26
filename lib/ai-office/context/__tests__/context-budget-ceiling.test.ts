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

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

async function scenario(fn: (ctx: { db: ReturnType<typeof createTestDb>["db"]; role: NonNullable<ReturnType<typeof getAgentRole>>; task: ReturnType<typeof createTask>; context: Awaited<ReturnType<typeof buildTaskContext>> }) => Promise<void>) {
  const prior = process.env.AI_OFFICE_WORKSPACES_ROOT;
  const root = mkdtempSync(join(tmpdir(), "ai-office-ceiling-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = root;
  const t = createTestDb();
  try {
    const { project } = createProjectWithIdea(t.db, { title: "Ceiling", rawIdeaText: "Build a small page.", ownerId: getOwner(t.db)!.id, routingMode: "FREE_MULTI_MODEL" });
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });
    const role = getAgentRole(t.db, "frontend-developer")!;
    const files: Array<[string, string]> = [["index.html", "<html><script src='script.js'></script></html>"], ["style.css", "body{margin:0}"], ["script.js", "console.log('x');"]];
    for (let i = 0; i < 5; i++) files.push([`unrelated-${i}.txt`, `filler content ${i} `.repeat(600)]);
    for (const [path, content] of files) {
      await writeFile(project.id, path, content);
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path, sizeBytes: content.length, roleId: "frontend-developer", taskId: /^(index|style|script)/.test(path) ? task.id : null });
    }
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: "script.js: the click handler never updates the page." });
    const context = await buildTaskContext(t.db, task, role, { attemptNumber: 2 });
    await fn({ db: t.db, role, task, context });
  } finally {
    t.close();
    if (prior === undefined) delete process.env.AI_OFFICE_WORKSPACES_ROOT;
    else process.env.AI_OFFICE_WORKSPACES_ROOT = prior;
    rmSync(root, { recursive: true, force: true });
  }
}

describe("optimizeContextForPaidCall — inputTokenCeiling (per-request provider limit)", () => {
  test("without a ceiling nothing extra is dropped; with a tighter ceiling the existing shrink order runs and the failing file survives", async () => {
    await scenario(async ({ db, role, task, context }) => {
      const base = await optimizeContextForPaidCall({ db, role, task, context, capability: "CODING", routingMode: "FREE_MULTI_MODEL" });
      assert.ok(base.ok);
      const baseFiles = base.context.remediationContext!.currentFiles.map((f) => f.path);
      assert.equal(baseFiles.length, 8);

      const ceiling = Math.floor(base.telemetry.estimatedInputTokens * 0.7);
      const fitted = await optimizeContextForPaidCall({ db, role, task, context, capability: "CODING", routingMode: "FREE_MULTI_MODEL", inputTokenCeiling: ceiling });
      assert.ok(fitted.ok, JSON.stringify(fitted.telemetry));
      assert.ok(fitted.telemetry.estimatedInputTokens <= ceiling);
      const keptFiles = fitted.context.remediationContext!.currentFiles.map((f) => f.path);
      assert.ok(keptFiles.length < baseFiles.length);
      for (const needed of ["index.html", "script.js", "style.css"]) assert.ok(keptFiles.includes(needed), `${needed} must be kept`);
      // Required remediation information is never removed to fit.
      assert.deepEqual(fitted.context.remediationContext!.failingChecks, base.context.remediationContext!.failingChecks);
      assert.equal(fitted.context.authoritativeUserRequest, base.context.authoritativeUserRequest);
      assert.ok(fitted.telemetry.shrinkStepsApplied.length > 0);
    });
  });

  test("a ceiling that cannot be met is a blocked result — never a silently oversized send", async () => {
    await scenario(async ({ db, role, task, context }) => {
      const result = await optimizeContextForPaidCall({ db, role, task, context, capability: "CODING", routingMode: "FREE_MULTI_MODEL", inputTokenCeiling: 300 });
      assert.equal(result.ok, false);
      assert.equal(result.telemetry.blocked, true);
      assert.match(result.telemetry.blockReason ?? "", /burst ceiling of 300 tokens/);
    });
  });
});
