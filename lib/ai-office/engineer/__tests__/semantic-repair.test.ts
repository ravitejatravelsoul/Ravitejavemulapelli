import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, getTask } from "../../domain/tasks.ts";
import { recordFailure, createArtifact, listArtifactsForProject, listDecisionsForProject, createApproval, decideApproval } from "../../domain/project-outputs.ts";
import { approveApproval } from "../../approvals/approval-service.ts";
import { upsertRecommendedRouting, applyRecommendedRouting } from "../../domain/model-routing.ts";
import { writeFile } from "../../workspace/workspace-service.ts";
import { upsertWorkspaceFileRecord } from "../../domain/workspace.ts";
import { listOpenIncidents } from "../../domain/office-incidents.ts";
import { listSemanticRepairPlansForTask, getSemanticRepairPlan } from "../../domain/semantic-repair.ts";
import { computeFailureSignature, detectSemanticFailureLoop, classifyMismatch, MIN_SEMANTIC_FAILURES_FOR_LOOP } from "../semantic-failure-detection.ts";
import {
  proposeSemanticRepair,
  approveSemanticRepairPlan,
  rejectSemanticRepairPlan,
  executeApprovedSemanticRepair,
  applyApprovedArchitectureRemediation,
  buildTargetedRepairContext,
} from "../semantic-repair-execution.ts";

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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-semantic-repair-workspace-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
  try {
    return await fn();
  } finally {
    if (priorRoot === undefined) delete process.env.AI_OFFICE_WORKSPACES_ROOT;
    else process.env.AI_OFFICE_WORKSPACES_ROOT = priorRoot;
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function claudeTextMessage(text: string, usage = { input_tokens: 500, output_tokens: 200 }) {
  return { content: [{ type: "text", text, citations: null }], usage } as unknown as Awaited<
    ReturnType<import("@anthropic-ai/sdk").default["messages"]["create"]>
  >;
}

function claudeClient(handler: () => ReturnType<typeof claudeTextMessage> | Promise<ReturnType<typeof claudeTextMessage>>) {
  return { messages: { create: async () => handler() } } as unknown as import("../../providers/claude/claude-adapter.ts").ClaudeAdapterOptions["client"];
}

function setupHybridProject(t: ReturnType<typeof createTestDb>, opts: { monthlyBudgetCapUsd?: number | null; rawIdeaText?: string } = {}) {
  const owner = getOwner(t.db)!;
  upsertRecommendedRouting(t.db, { capability: "CODING", model: "NO QUALIFIED LOCAL MODEL", reason: "no coding-qualified local model" });
  applyRecommendedRouting(t.db);
  const { project } = createProjectWithIdea(t.db, {
    title: "Semantic Repair Test",
    rawIdeaText: opts.rawIdeaText ?? "Build a personal task manager.",
    ownerId: owner.id,
    aiPolicyMode: "HYBRID",
    monthlyBudgetCapUsd: opts.monthlyBudgetCapUsd ?? 3.0,
  });
  return { owner, project };
}

const IDENTITY_REJECTION_1 =
  "Corrective attempt rejected before applying — it would have changed the product's identity: The candidate code provides a complete implementation for storage and task management, but the original request implied extending or modifying an existing class structure, which is not fully reflected here.";
const IDENTITY_REJECTION_2 =
  "Corrective attempt rejected before applying — it would have changed the product's identity: The candidate provided two new files instead of providing the necessary missing implementation for the existing TaskStore class methods.";

const GOOD_REPAIR_OUTPUT = JSON.stringify({
  summary: "Targeted fix applied without touching the established contract.",
  artifacts: [],
  decisions: [],
  testResults: [],
  events: [],
  fileOperations: [{ kind: "file-operation", action: "write", path: "js/taskStore.js", content: "export class TaskStore { /* fixed */ }" }],
  recommendedNextActions: [],
});

describe("computeFailureSignature / detectSemanticFailureLoop", () => {
  test("a single semantic failure is not yet a loop", () => {
    const t = createTestDb();
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });

    const loop = detectSemanticFailureLoop(t.db, task);
    assert.equal(loop.detected, false);
    t.close();
  });

  test("repeated semantic failure IS detected as a loop once the threshold is reached", () => {
    const t = createTestDb();
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

    assert.equal(MIN_SEMANTIC_FAILURES_FOR_LOOP, 2);
    const loop = detectSemanticFailureLoop(t.db, task);
    assert.equal(loop.detected, true);
    assert.equal(loop.semanticFailures.length, 2);
    t.close();
  });

  test("purely operational failures (e.g. malformed JSON) never count toward a semantic loop", () => {
    const t = createTestDb();
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: "Claude's model output was not valid JSON." });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: "Ollama's HTTP response body was not valid JSON." });

    const loop = detectSemanticFailureLoop(t.db, task);
    assert.equal(loop.detected, false, "operational noise must never be mistaken for a semantic loop");
    t.close();
  });

  test("identical failure signature deduplicated — two differently-worded but same-category rejections collapse onto one signature", () => {
    const sigA = computeFailureSignature([IDENTITY_REJECTION_1]);
    const sigB = computeFailureSignature([IDENTITY_REJECTION_2]);
    assert.equal(sigA, sigB, "both are 'would have changed the product's identity' rejections — same category, same signature");

    const differentCategory = computeFailureSignature(["The page loaded and worked, but does not match the requested product: wrong color scheme."]);
    assert.notEqual(sigA, differentCategory, "a genuinely different failure category must get a different signature");
  });
});

describe("classifyMismatch — deterministic first-pass classification (no AI call)", () => {
  test("IMPLEMENTATION_WRONG: affected files already establish a real contract; architecture is merely silent about it", () => {
    const result = classifyMismatch({
      authoritativeUserRequest: "Build a personal task manager.",
      architectureContent: "# Architecture\nKeep it minimal.",
      codeArtifactContent: null,
      affectedFiles: [{ path: "js/taskStore.js", content: "export class TaskStore { add() {} }" }],
      failureReasons: [IDENTITY_REJECTION_1],
    });
    assert.equal(result.classification, "IMPLEMENTATION_WRONG");
    assert.match(result.authoritativeContract, /TaskStore/);
  });

  test("IMPLEMENTATION_WRONG: architecture explicitly documents the same contract the files implement", () => {
    const result = classifyMismatch({
      authoritativeUserRequest: "Build a small tool.",
      architectureContent: "Use a Widget class to manage state.",
      codeArtifactContent: null,
      affectedFiles: [{ path: "widget.js", content: "export class Widget {}" }],
      failureReasons: ["some rejection"],
    });
    assert.equal(result.classification, "IMPLEMENTATION_WRONG");
    assert.match(result.authoritativeContract, /Widget/);
  });

  test("ARCHITECTURE_STALE: architecture names an older structure, but a recorded 'code' artifact confirms a different, deliberately-built one", () => {
    const result = classifyMismatch({
      authoritativeUserRequest: "Build a small tool.",
      architectureContent: "Use a LegacyManager class to manage state.",
      codeArtifactContent: "widget.js — Widget class: manages the UI state directly.",
      affectedFiles: [{ path: "widget.js", content: "export class Widget {}" }],
      failureReasons: ["some rejection"],
    });
    assert.equal(result.classification, "ARCHITECTURE_STALE");
    assert.match(result.authoritativeContract, /Widget/);
  });

  test("BOTH_INCONSISTENT: architecture and files name different structures, with no recorded 'code' artifact confirming either was a deliberate success", () => {
    const result = classifyMismatch({
      authoritativeUserRequest: "Build a small tool.",
      architectureContent: "Use a LegacyManager class to manage state.",
      codeArtifactContent: null,
      affectedFiles: [{ path: "widget.js", content: "export class Widget {}" }],
      failureReasons: ["some rejection"],
    });
    assert.equal(result.classification, "BOTH_INCONSISTENT");
  });

  test("OWNER_CLARIFICATION_REQUIRED: no specific structural contract found anywhere", () => {
    const result = classifyMismatch({
      authoritativeUserRequest: "Build a small tool.",
      architectureContent: "Keep it minimal.",
      codeArtifactContent: null,
      affectedFiles: [{ path: "index.html", content: "<html></html>" }],
      failureReasons: ["some rejection"],
    });
    assert.equal(result.classification, "OWNER_CLARIFICATION_REQUIRED");
  });

  test("OWNER_CLARIFICATION_REQUIRED: architecture names a structure nothing has actually built yet", () => {
    const result = classifyMismatch({
      authoritativeUserRequest: "Build a small tool.",
      architectureContent: "Use a Widget class to manage state.",
      codeArtifactContent: null,
      affectedFiles: [{ path: "index.html", content: "<html></html>" }],
      failureReasons: ["some rejection"],
    });
    assert.equal(result.classification, "OWNER_CLARIFICATION_REQUIRED");
  });
});

describe("targeted context excludes unrelated files", () => {
  test("gathered evidence/context includes ONLY files attributed to the failing task, never the whole workspace", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupHybridProject(t);
      const failingTask = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
      const otherTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

      await writeFile(project.id, "js/taskStore.js", "export class TaskStore {}");
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "js/taskStore.js", sizeBytes: 10, roleId: "backend-developer", taskId: failingTask.id });
      await writeFile(project.id, "index.html", "<html></html>");
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "index.html", sizeBytes: 10, roleId: "frontend-developer", taskId: otherTask.id });

      recordFailure(t.db, { projectId: project.id, taskId: failingTask.id, reason: IDENTITY_REJECTION_1 });
      recordFailure(t.db, { projectId: project.id, taskId: failingTask.id, reason: IDENTITY_REJECTION_2 });

      const result = await proposeSemanticRepair(t.db, failingTask.id, "test");
      assert.equal(result.status, "proposed");
      if (result.status !== "proposed") throw new Error("unreachable");
      assert.deepEqual(result.plan.affectedFiles, ["js/taskStore.js"], "must include only the failing task's own attributed file");
      assert.ok(!result.plan.affectedFiles.includes("index.html"), "must never include a file attributed to a different task");

      t.close();
    });
  });

  test("buildTargetedRepairContext echoes only the evidence it was given — pure, no hidden project-wide data", () => {
    const context = buildTargetedRepairContext(
      { id: "task-1", projectId: "proj-1", roleId: "backend-developer", title: "Implement backend" },
      { authoritativeUserRequest: "Build X.", architectureContent: "arch text", codeArtifactContent: null, affectedFiles: [{ path: "a.js", content: "content-a" }], failureReasons: ["reason"] },
      { classification: "IMPLEMENTATION_WRONG", rootCause: "root", authoritativeContract: "Foo", requiredChanges: [], mustPreserve: [] },
    );
    assert.deepEqual(context.relevantFiles, [{ path: "a.js", content: "content-a" }]);
    assert.equal(context.relevantArtifacts.length, 1);
    assert.equal(context.relevantArtifacts[0].content, "arch text");
    assert.deepEqual(context.remediationContext?.currentFiles, [{ path: "a.js", content: "content-a" }]);
  });
});

describe("proposeSemanticRepair — dedup and bounded-retry enforcement", () => {
  test("a repeated detection of the SAME signature returns the existing in-flight plan, never a duplicate", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
      await writeFile(project.id, "js/taskStore.js", "export class TaskStore {}");
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "js/taskStore.js", sizeBytes: 10, roleId: "backend-developer", taskId: task.id });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

      const first = await proposeSemanticRepair(t.db, task.id, "test");
      assert.equal(first.status, "proposed");
      const second = await proposeSemanticRepair(t.db, task.id, "test");
      assert.equal(second.status, "already-in-flight");
      assert.equal(listSemanticRepairPlansForTask(t.db, task.id).length, 1, "never a duplicate plan for the same signature");
      t.close();
    });
  });

  test("OWNER_CLARIFICATION_REQUIRED immediately escalates — never left waiting silently", async () => {
    const t = createTestDb();
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

    const result = await proposeSemanticRepair(t.db, task.id, "test");
    assert.equal(result.status, "escalated-needs-owner");
    if (result.status !== "escalated-needs-owner") throw new Error("unreachable");
    assert.equal(result.plan.classification, "OWNER_CLARIFICATION_REQUIRED");
    assert.equal(result.plan.status, "ESCALATED");

    const incidents = listOpenIncidents(t.db);
    assert.equal(incidents.filter((i) => i.taskId === task.id).length, 1);
    assert.equal(incidents.find((i) => i.taskId === task.id)?.status, "ESCALATED");
    t.close();
  });
});

describe("second same-signature repair failure escalates — never spends repeatedly", () => {
  test("after a repair attempt fails once, a fresh detection of the SAME signature refuses to spawn a new cycle", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
      await writeFile(project.id, "js/taskStore.js", "export class TaskStore {}");
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "js/taskStore.js", sizeBytes: 10, roleId: "backend-developer", taskId: task.id });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

      const proposed = await proposeSemanticRepair(t.db, task.id, "test");
      assert.equal(proposed.status, "proposed");
      if (proposed.status !== "proposed") throw new Error("unreachable");

      approveSemanticRepairPlan(t.db, proposed.plan.id, owner.id);
      // No ANTHROPIC_API_KEY configured — the repair call is blocked by
      // the SAME approval/config gate any normal agent would hit.
      delete process.env.ANTHROPIC_API_KEY;
      const executed = await executeApprovedSemanticRepair(t.db, proposed.plan.id, owner.id);
      assert.equal(executed.status, "failed");
      assert.equal(getSemanticRepairPlan(t.db, proposed.plan.id)?.status, "ESCALATED");

      // A fresh detection cycle for the exact same still-unresolved
      // signature must recognize the escalated plan and refuse to spawn
      // a new one.
      const secondDetection = await proposeSemanticRepair(t.db, task.id, "test");
      assert.equal(secondDetection.status, "already-escalated");
      assert.equal(listSemanticRepairPlansForTask(t.db, task.id).length, 1, "never a second, independent repair cycle for the same signature");

      t.close();
    });
  });
});

describe("paid repair cannot bypass approval / repair cost uses the normal budget gate", () => {
  test("an APPROVED plan still refuses to run when Claude use itself was never approved for the project", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
      await writeFile(project.id, "js/taskStore.js", "export class TaskStore {}");
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "js/taskStore.js", sizeBytes: 10, roleId: "backend-developer", taskId: task.id });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

      const proposed = await proposeSemanticRepair(t.db, task.id, "test");
      if (proposed.status !== "proposed") throw new Error("unreachable");
      approveSemanticRepairPlan(t.db, proposed.plan.id, owner.id);

      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";
      let called = false;
      const result = await executeApprovedSemanticRepair(t.db, proposed.plan.id, owner.id, {
        claudeClientOverride: claudeClient(() => {
          called = true;
          return claudeTextMessage(GOOD_REPAIR_OUTPUT);
        }),
      });

      assert.equal(result.status, "failed");
      assert.match(result.reason, /PAID AI APPROVAL REQUIRED/);
      assert.equal(called, false, "the provider must never be reached without the project's own Claude approval — no privileged bypass");
      t.close();
    });
  });

  test("an APPROVED plan still refuses to run when the project is over its LIVE budget cap — the same budget gate, not a separate weaker one", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t, { monthlyBudgetCapUsd: 0.00001 });
      const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
      await writeFile(project.id, "js/taskStore.js", "export class TaskStore {}");
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "js/taskStore.js", sizeBytes: 10, roleId: "backend-developer", taskId: task.id });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

      const proposed = await proposeSemanticRepair(t.db, task.id, "test");
      if (proposed.status !== "proposed") throw new Error("unreachable");
      approveSemanticRepairPlan(t.db, proposed.plan.id, owner.id);

      // Approve Claude use itself so the ONLY remaining blocker is budget.
      const claudeApproval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
      approveApproval(t.db, { approvalId: claudeApproval.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

      let called = false;
      const result = await executeApprovedSemanticRepair(t.db, proposed.plan.id, owner.id, {
        claudeClientOverride: claudeClient(() => {
          called = true;
          return claudeTextMessage(GOOD_REPAIR_OUTPUT);
        }),
      });

      assert.equal(result.status, "failed");
      assert.match(result.reason, /cap/i);
      assert.equal(called, false, "refused before ever reaching the provider — same budget gate as any normal agent");
      t.close();
    });
  });

  test("a real (mocked) repair call, fully approved and in-budget, applies files and resolves the incident — real usage/audit recorded", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
      await writeFile(project.id, "js/taskStore.js", "export class TaskStore {}");
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "js/taskStore.js", sizeBytes: 10, roleId: "backend-developer", taskId: task.id });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

      const proposed = await proposeSemanticRepair(t.db, task.id, "test");
      if (proposed.status !== "proposed") throw new Error("unreachable");
      approveSemanticRepairPlan(t.db, proposed.plan.id, owner.id);

      const claudeApproval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
      approveApproval(t.db, { approvalId: claudeApproval.id, decidedByUserId: owner.id });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";

      const result = await executeApprovedSemanticRepair(t.db, proposed.plan.id, owner.id, {
        claudeClientOverride: claudeClient(() => claudeTextMessage(GOOD_REPAIR_OUTPUT)),
      });

      assert.equal(result.status, "repaired");
      if (result.status !== "repaired") throw new Error("unreachable");
      assert.equal(result.plan.status, "VERIFIED");
      assert.ok(result.plan.actualRepairCostUsd != null && result.plan.actualRepairCostUsd > 0, "real usage cost must be recorded, never left null for a real call");
      assert.equal(getTask(t.db, task.id)?.status, "DONE");
      assert.equal(listOpenIncidents(t.db).find((i) => i.taskId === task.id), undefined, "the incident must be resolved, not left open");

      t.close();
    });
  });
});

describe("architecture change invalidates only dependent work / history preserved", () => {
  test("applying an ARCHITECTURE_STALE remediation adds a NEW artifact version (never deletes/overwrites the old one) and reopens only the affected task", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);
    const architectTask = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    const untouchedTask = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    createArtifact(t.db, { projectId: project.id, taskId: architectTask.id, type: "architecture", content: "Use a LegacyManager class.", version: 1 });
    createArtifact(t.db, { projectId: project.id, taskId: task.id, type: "code", content: "widget.js — Widget class: manages state.", version: 1 });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

    // Force the task to BLOCKED (as a real ceiling-exhaustion would) so
    // the "reopen only the affected task" behavior is actually exercised.
    t.db.prepare("UPDATE tasks SET status = 'BLOCKED' WHERE id = ?").run(task.id);
    t.db.prepare("UPDATE tasks SET status = 'BLOCKED' WHERE id = ?").run(untouchedTask.id);

    const proposed = await proposeSemanticRepair(t.db, task.id, "test");
    assert.equal(proposed.status, "proposed");
    if (proposed.status !== "proposed") throw new Error("unreachable");
    assert.equal(proposed.plan.classification, "ARCHITECTURE_STALE");
    assert.ok(proposed.plan.architectureApprovalId, "an architecture-replacement approval must have been created");

    decideApproval(t.db, proposed.plan.architectureApprovalId!, "APPROVED", { decidedBy: owner.id });

    const updated = applyApprovedArchitectureRemediation(t.db, proposed.plan.id, owner.id, "Use a Widget class to manage state (updated to match the real implementation).");
    assert.equal(updated.status, "APPLIED");

    const architectureArtifacts = listArtifactsForProject(t.db, project.id).filter((a) => a.type === "architecture");
    assert.equal(architectureArtifacts.length, 2, "the old version must be preserved, never deleted or overwritten");
    assert.equal(architectureArtifacts.find((a) => a.version === 1)?.content, "Use a LegacyManager class.", "the original version's content is untouched");
    assert.equal(architectureArtifacts.find((a) => a.version === 2)?.content, "Use a Widget class to manage state (updated to match the real implementation).");

    assert.ok(listDecisionsForProject(t.db, project.id).some((d) => d.summary.includes("Architecture updated")), "a real decision record explaining why must exist");

    assert.equal(getTask(t.db, task.id)?.status, "PENDING", "the affected task is reopened for a fresh normal attempt");
    assert.equal(getTask(t.db, untouchedTask.id)?.status, "BLOCKED", "a different task must never be touched by this remediation");

    t.close();
  });

  test("applyApprovedArchitectureRemediation refuses when the approval is not yet APPROVED — never silently rewrites architecture", async () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = setupHybridProject(t);
    const architectTask = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Design architecture" });
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    createArtifact(t.db, { projectId: project.id, taskId: architectTask.id, type: "architecture", content: "Use a LegacyManager class.", version: 1 });
    createArtifact(t.db, { projectId: project.id, taskId: task.id, type: "code", content: "widget.js — Widget class: manages state.", version: 1 });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

    const proposed = await proposeSemanticRepair(t.db, task.id, "test");
    if (proposed.status !== "proposed") throw new Error("unreachable");

    assert.throws(() => applyApprovedArchitectureRemediation(t.db, proposed.plan.id, owner.id, "new content"), /not APPROVED/);
    assert.equal(listArtifactsForProject(t.db, project.id).filter((a) => a.type === "architecture").length, 1);
    t.close();
  });
});

describe("rejectSemanticRepairPlan", () => {
  test("rejecting a plan escalates the incident and never auto-repairs", async () => {
    await withWorkspace(async () => {
      const t = createTestDb();
      const owner = getOwner(t.db)!;
      const { project } = setupHybridProject(t);
      const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
      await writeFile(project.id, "js/taskStore.js", "export class TaskStore {}");
      upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "js/taskStore.js", sizeBytes: 10, roleId: "backend-developer", taskId: task.id });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
      recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

      const proposed = await proposeSemanticRepair(t.db, task.id, "test");
      if (proposed.status !== "proposed") throw new Error("unreachable");

      const rejected = rejectSemanticRepairPlan(t.db, proposed.plan.id, owner.id, "Not the right approach.");
      assert.equal(rejected.status, "REJECTED");
      assert.equal(listOpenIncidents(t.db).find((i) => i.taskId === task.id)?.status, "ESCALATED");
      t.close();
    });
  });
});

describe("TaskFlow remains frozen during feature construction", () => {
  test("building and testing this capability never touches the real TaskFlow project's own database file", () => {
    // The real, live TaskFlow project lives in .data/office.db; every
    // test in this file uses createTestDb()'s isolated temp-file
    // database (db/test-helpers.ts) — never that file. This test
    // documents and locks in that invariant rather than merely relying
    // on convention.
    const t = createTestDb();
    assert.notEqual(t.dir.includes(".data"), true, "test databases must never live under the real .data directory");
    t.close();
  });

  test("detection/classification/plan-building never records any ai_usage or budget_reservations row — proposeSemanticRepair alone can never cost anything, even against a real project", async () => {
    const t = createTestDb();
    const { project } = setupHybridProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_1 });
    recordFailure(t.db, { projectId: project.id, taskId: task.id, reason: IDENTITY_REJECTION_2 });

    // Deliberately no ANTHROPIC_API_KEY — proving cost estimation itself
    // degrades to "not available" rather than requiring a credential,
    // and that nothing here ever reaches for real budget machinery. The
    // exact classification doesn't matter for this invariant (no
    // affected files are seeded, so this happens to classify as
    // OWNER_CLARIFICATION_REQUIRED) — what matters is that NEITHER
    // outcome of proposeSemanticRepair ever touches usage/budget tables.
    delete process.env.ANTHROPIC_API_KEY;
    const result = await proposeSemanticRepair(t.db, task.id, "test");
    assert.ok(result.status === "proposed" || result.status === "escalated-needs-owner");

    const usage = t.db.prepare("SELECT COUNT(*) as n FROM ai_usage").get() as { n: number };
    const reservations = t.db.prepare("SELECT COUNT(*) as n FROM budget_reservations").get() as { n: number };
    assert.equal(usage.n, 0, "proposing a repair plan must never itself record any real usage");
    assert.equal(reservations.n, 0, "proposing a repair plan must never itself reserve any budget");
    assert.equal(getTask(t.db, task.id)?.status, "PENDING", "the task's own status must be completely untouched by mere detection");
    t.close();
  });
});
