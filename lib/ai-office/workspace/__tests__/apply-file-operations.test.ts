import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask } from "../../domain/tasks.ts";
import { readFile, listFiles, MAX_FILE_SIZE_BYTES } from "../workspace-service.ts";
import { listWorkspaceFileRecords, getWorkspace } from "../../domain/workspace.ts";
import { applyFileOperations, FileOperationValidationError } from "../apply-file-operations.ts";
import { WorkspacePathError } from "../workspace-service.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  return project;
}

function setupTask(t: ReturnType<typeof createTestDb>, projectId: string, title = "Implement frontend") {
  return createTask(t.db, { projectId, roleId: "frontend-developer", title });
}

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-apply-ops-test-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
});

afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("applyFileOperations — happy path", () => {
  test("applies every write, creates the workspace row, and records attribution per file", async () => {
    const t = createTestDb();
    const project = setupProject(t);
    const task = setupTask(t, project.id);
    const result = await applyFileOperations(t.db, {
      projectId: project.id,
      taskId: task.id,
      roleId: "frontend-developer",
      operations: [
        { kind: "file-operation", action: "write", path: "index.html", content: "<h1>Hi</h1>" },
        { kind: "file-operation", action: "write", path: "styles.css", content: "h1 { color: red; }" },
      ],
    });

    assert.deepEqual(result.appliedPaths, ["index.html", "styles.css"]);
    assert.equal(await readFile(project.id, "index.html"), "<h1>Hi</h1>");
    assert.deepEqual(await listFiles(project.id), ["index.html", "styles.css"]);

    assert.ok(getWorkspace(t.db, project.id), "a workspace row must exist once a real operation has been applied");
    const records = listWorkspaceFileRecords(t.db, project.id);
    assert.equal(records.length, 2);
    const indexRecord = records.find((r) => r.path === "index.html")!;
    assert.equal(indexRecord.lastModifiedByRoleId, "frontend-developer");
    assert.equal(indexRecord.lastModifiedByTaskId, task.id);
    assert.equal(indexRecord.sizeBytes, Buffer.byteLength("<h1>Hi</h1>", "utf8"));

    t.close();
  });

  test("a delete operation removes the file and its manifest record", async () => {
    const t = createTestDb();
    const project = setupProject(t);
    const task1 = setupTask(t, project.id, "Write a.txt");
    const task2 = setupTask(t, project.id, "Delete a.txt");
    await applyFileOperations(t.db, {
      projectId: project.id,
      taskId: task1.id,
      roleId: "frontend-developer",
      operations: [{ kind: "file-operation", action: "write", path: "a.txt", content: "a" }],
    });
    await applyFileOperations(t.db, {
      projectId: project.id,
      taskId: task2.id,
      roleId: "frontend-developer",
      operations: [{ kind: "file-operation", action: "delete", path: "a.txt" }],
    });

    assert.deepEqual(await listFiles(project.id), []);
    assert.deepEqual(listWorkspaceFileRecords(t.db, project.id), []);
    t.close();
  });

  test("an empty operations array is a safe no-op — no workspace row is created", async () => {
    const t = createTestDb();
    const project = setupProject(t);
    const result = await applyFileOperations(t.db, { projectId: project.id, taskId: "task-1", roleId: "frontend-developer", operations: [] });
    assert.deepEqual(result.appliedPaths, []);
    assert.equal(getWorkspace(t.db, project.id), undefined);
    t.close();
  });
});

describe("applyFileOperations — all-or-nothing validation", () => {
  test("a 'write' operation missing content is rejected before anything is applied", async () => {
    const t = createTestDb();
    const project = setupProject(t);
    await assert.rejects(
      () =>
        applyFileOperations(t.db, {
          projectId: project.id,
          taskId: "task-1",
          roleId: "frontend-developer",
          operations: [
            { kind: "file-operation", action: "write", path: "good.txt", content: "ok" },
            { kind: "file-operation", action: "write", path: "bad.txt" }, // no content
          ],
        }),
      FileOperationValidationError,
    );
    assert.deepEqual(await listFiles(project.id), [], "no file from the batch should exist — content validation happens before any write");
    t.close();
  });

  test("an unsafe path anywhere in the batch rejects the whole batch, not just that entry", async () => {
    const t = createTestDb();
    const project = setupProject(t);
    await assert.rejects(
      () =>
        applyFileOperations(t.db, {
          projectId: project.id,
          taskId: "task-1",
          roleId: "frontend-developer",
          operations: [
            { kind: "file-operation", action: "write", path: "good.txt", content: "ok" },
            { kind: "file-operation", action: "write", path: "../escape.txt", content: "bad" },
          ],
        }),
      WorkspacePathError,
    );
    assert.deepEqual(await listFiles(project.id), [], "the whole batch must be rejected, including the individually-safe entry");
    t.close();
  });

  test("a batch that would exceed the per-file limit is rejected before any write", async () => {
    const t = createTestDb();
    const project = setupProject(t);
    await assert.rejects(
      () =>
        applyFileOperations(t.db, {
          projectId: project.id,
          taskId: "task-1",
          roleId: "frontend-developer",
          operations: [
            { kind: "file-operation", action: "write", path: "small.txt", content: "ok" },
            { kind: "file-operation", action: "write", path: "huge.txt", content: "x".repeat(MAX_FILE_SIZE_BYTES + 1) },
          ],
        }),
      FileOperationValidationError,
    );
    assert.deepEqual(await listFiles(project.id), []);
    t.close();
  });
});
