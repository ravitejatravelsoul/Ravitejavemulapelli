import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkStructuralRepairScope, checkSemanticRepairConsistency } from "../semantic-repair-consistency.ts";
import type { FileOperationPayload } from "../../providers/types.ts";

/**
 * Regression suite for the exact real defect this module fixes: a live
 * TaskFlow semantic repair, correctly targeted at the approved
 * TaskStore contract, was wrongly rejected by the generic whole-product
 * intent-consistency checker with an invented reinterpretation of the
 * original request. Fixture data below mirrors the real case (Section 8
 * of the follow-up brief): current files js/storage.js + js/taskStore.js,
 * authoritative contract "TaskStore".
 */

const CURRENT_STORAGE_JS = `const Storage = { read() {}, write() {}, remove() {}, isAvailable() {} };
export default Storage;`;

const CURRENT_TASKSTORE_JS = `import Storage from './storage.js';
export class TaskStore {
  constructor() {}
  add(input) {}
  update(id, input) {}
  complete(id) {}
  reopen(id) {}
  remove(id) {}
  getFiltered(filter, query) {}
  getCounts() {}
}
export default TaskStore;`;

const CURRENT_FILES = [
  { path: "js/storage.js", content: CURRENT_STORAGE_JS },
  { path: "js/taskStore.js", content: CURRENT_TASKSTORE_JS },
];

const ALLOWED_FILES = ["js/storage.js", "js/taskStore.js"];

function writeOp(path: string, content: string): FileOperationPayload {
  return { kind: "file-operation", action: "write", path, content };
}

function deleteOp(path: string): FileOperationPayload {
  return { kind: "file-operation", action: "delete", path };
}

describe("checkStructuralRepairScope — deterministic, zero AI cost", () => {
  test("PASS: modifies existing TaskStore methods only, preserves the class, no unrelated files", () => {
    const patched = CURRENT_TASKSTORE_JS.replace("complete(id) {}", "complete(id) { /* fixed */ }");
    const result = checkStructuralRepairScope({
      allowedFilePaths: ALLOWED_FILES,
      authoritativeContract: "TaskStore",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/taskStore.js", patched)],
    });
    assert.equal(result.ok, true);
  });

  test("PASS: a necessary change touches both storage.js and taskStore.js when the approved plan explicitly allows both", () => {
    const result = checkStructuralRepairScope({
      allowedFilePaths: ALLOWED_FILES,
      authoritativeContract: "TaskStore",
      currentFiles: CURRENT_FILES,
      proposedOperations: [
        writeOp("js/storage.js", CURRENT_STORAGE_JS + "\n// minor fix"),
        writeOp("js/taskStore.js", CURRENT_TASKSTORE_JS.replace("add(input) {}", "add(input) { /* fixed */ }")),
      ],
    });
    assert.equal(result.ok, true);
  });

  test("FAIL: deletes the TaskStore class entirely — AUTHORITATIVE CONTRACT VIOLATION", () => {
    const result = checkStructuralRepairScope({
      allowedFilePaths: ALLOWED_FILES,
      authoritativeContract: "TaskStore",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/taskStore.js", "export function taskStoreHelper() {}")],
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.match(result.reason, /AUTHORITATIVE CONTRACT VIOLATION/);
    assert.match(result.reason, /TaskStore/);
  });

  test("FAIL: renames TaskStore to something else — the established contract identifier no longer exists", () => {
    const result = checkStructuralRepairScope({
      allowedFilePaths: ALLOWED_FILES,
      authoritativeContract: "TaskStore",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/taskStore.js", CURRENT_TASKSTORE_JS.replace(/TaskStore/g, "TaskManager"))],
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.match(result.reason, /AUTHORITATIVE CONTRACT VIOLATION/);
  });

  test("FAIL: creates an unrelated replacement module outside the approved scope — REPAIR SCOPE REJECTED", () => {
    const result = checkStructuralRepairScope({
      allowedFilePaths: ALLOWED_FILES,
      authoritativeContract: "TaskStore",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/newTaskManager.js", "export class NewTaskManager {}")],
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.match(result.reason, /REPAIR SCOPE REJECTED/);
    assert.match(result.reason, /js\/newTaskManager\.js/);
  });

  test("FAIL: rewrites an unrelated product area (a file never part of the approved plan)", () => {
    const result = checkStructuralRepairScope({
      allowedFilePaths: ALLOWED_FILES,
      authoritativeContract: "TaskStore",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("index.html", "<html><body>Completely different app</body></html>")],
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.match(result.reason, /REPAIR SCOPE REJECTED/);
    assert.match(result.reason, /index\.html/);
  });

  test("FAIL: unexpected deletion of an allowed file is still rejected — a repair may modify, never delete", () => {
    const result = checkStructuralRepairScope({
      allowedFilePaths: ALLOWED_FILES,
      authoritativeContract: "TaskStore",
      currentFiles: CURRENT_FILES,
      proposedOperations: [deleteOp("js/storage.js")],
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.match(result.reason, /Unexpected file deletion/);
  });
});

describe("checkSemanticRepairConsistency — full path (structural first, model only if needed)", () => {
  test("PASS: a genuinely in-scope, contract-preserving patch is consistent without ever needing the model to override it", async () => {
    const patched = CURRENT_TASKSTORE_JS.replace("complete(id) {}", "complete(id) { this.tasks.find(t=>t.id===id).completed = true; }");
    let modelCalled = false;
    const fetchImpl = (async () => {
      modelCalled = true;
      return { ok: true, status: 200, json: async () => ({ response: JSON.stringify({ productIntentPreserved: true, repairScopeSatisfied: true, outOfScopeChanges: [], reason: "ok" }) }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await checkSemanticRepairConsistency({
      authoritativeUserRequest: "Build a polished personal task manager called TaskFlow.",
      authoritativeContract: "TaskStore",
      allowedFilePaths: ALLOWED_FILES,
      requiredChanges: ["Fix the complete() method."],
      mustPreserve: ["The TaskStore class and its existing methods."],
      exactFailureReason: "complete() does not persist.",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/taskStore.js", patched)],
      fetchImpl,
    });
    assert.equal(result.outcome, "consistent");
    assert.equal(modelCalled, true, "the model check still runs to confirm product intent, even when structural checks already pass");
  });

  test("FAIL (structural, zero AI cost): out-of-scope file is rejected before ever reaching the model", async () => {
    let modelCalled = false;
    const fetchImpl = (async () => {
      modelCalled = true;
      return { ok: true, status: 200, json: async () => ({ response: JSON.stringify({ productIntentPreserved: true, repairScopeSatisfied: true, outOfScopeChanges: [], reason: "ok" }) }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await checkSemanticRepairConsistency({
      authoritativeUserRequest: "Build a polished personal task manager called TaskFlow.",
      authoritativeContract: "TaskStore",
      allowedFilePaths: ALLOWED_FILES,
      requiredChanges: ["Fix the complete() method."],
      mustPreserve: ["The TaskStore class and its existing methods."],
      exactFailureReason: "complete() does not persist.",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/unrelated.js", "export class Unrelated {}")],
      fetchImpl,
    });
    assert.equal(result.outcome, "inconsistent");
    assert.match(result.reason, /REPAIR SCOPE REJECTED/);
    assert.equal(modelCalled, false, "a structural violation must never spend even a local-model call");
  });

  test("FAIL (model-level): the model reports the patch changes product identity even though it's technically in-scope", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            productIntentPreserved: false,
            repairScopeSatisfied: true,
            outOfScopeChanges: [],
            reason: "The patch replaces task management with an unrelated notes-taking feature.",
          }),
        }),
      }) as unknown as Response) as unknown as typeof fetch;

    const result = await checkSemanticRepairConsistency({
      authoritativeUserRequest: "Build a polished personal task manager called TaskFlow.",
      authoritativeContract: "TaskStore",
      allowedFilePaths: ALLOWED_FILES,
      requiredChanges: ["Fix the complete() method."],
      mustPreserve: ["The TaskStore class and its existing methods."],
      exactFailureReason: "complete() does not persist.",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/taskStore.js", "export class TaskStore { /* now a notes app */ }")],
      fetchImpl,
    });
    assert.equal(result.outcome, "inconsistent");
    assert.match(result.reason, /PRODUCT INTENT VIOLATION/);
  });

  test("FAIL (model-level): the model flags an out-of-scope change even though every file is technically in the allowed list", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            productIntentPreserved: true,
            repairScopeSatisfied: false,
            outOfScopeChanges: ["Rewrote the entire storage layer instead of only fixing the reported bug."],
            reason: "Went beyond the approved repair scope.",
          }),
        }),
      }) as unknown as Response) as unknown as typeof fetch;

    const result = await checkSemanticRepairConsistency({
      authoritativeUserRequest: "Build a polished personal task manager called TaskFlow.",
      authoritativeContract: "TaskStore",
      allowedFilePaths: ALLOWED_FILES,
      requiredChanges: ["Fix the complete() method."],
      mustPreserve: ["The TaskStore class and its existing methods."],
      exactFailureReason: "complete() does not persist.",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/storage.js", "// completely rewritten")],
      fetchImpl,
    });
    assert.equal(result.outcome, "inconsistent");
    assert.match(result.reason, /REPAIR SCOPE REJECTED/);
    assert.match(result.reason, /Rewrote the entire storage layer/);
  });

  test("the local judge never redefines the whole-product request based on the narrower repair contract — the prompt keeps them separate", async () => {
    let capturedPrompt = "";
    const fetchImpl = (async (_url: string, opts: RequestInit) => {
      capturedPrompt = JSON.parse(opts.body as string).prompt;
      return { ok: true, status: 200, json: async () => ({ response: JSON.stringify({ productIntentPreserved: true, repairScopeSatisfied: true, outOfScopeChanges: [], reason: "ok" }) }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await checkSemanticRepairConsistency({
      authoritativeUserRequest: "Build a polished personal task manager called TaskFlow.",
      authoritativeContract: "TaskStore",
      allowedFilePaths: ALLOWED_FILES,
      requiredChanges: ["Fix the complete() method."],
      mustPreserve: ["The TaskStore class and its existing methods."],
      exactFailureReason: "complete() does not persist.",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/taskStore.js", CURRENT_TASKSTORE_JS)],
      fetchImpl,
    });

    assert.match(capturedPrompt, /AUTHORITATIVE PRODUCT REQUEST/);
    assert.match(capturedPrompt, /APPROVED REPAIR CONTRACT/);
    assert.match(capturedPrompt, /narrower interpretation/i);
  });

  test("outcome is 'unavailable' (fails open, matching the existing checkpoint's documented behavior) when the local model can't be reached, never a hard rejection", async () => {
    const fetchImpl = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const result = await checkSemanticRepairConsistency({
      authoritativeUserRequest: "Build a polished personal task manager called TaskFlow.",
      authoritativeContract: "TaskStore",
      allowedFilePaths: ALLOWED_FILES,
      requiredChanges: ["Fix the complete() method."],
      mustPreserve: ["The TaskStore class and its existing methods."],
      exactFailureReason: "complete() does not persist.",
      currentFiles: CURRENT_FILES,
      proposedOperations: [writeOp("js/taskStore.js", CURRENT_TASKSTORE_JS)],
      fetchImpl,
    });
    assert.equal(result.outcome, "unavailable");
  });
});
