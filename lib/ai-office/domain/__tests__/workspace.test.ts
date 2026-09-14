import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../users.ts";
import { createProjectWithIdea } from "../projects.ts";
import { createTask } from "../tasks.ts";
import {
  getWorkspace,
  getOrCreateWorkspace,
  setDeliveryState,
  upsertWorkspaceFileRecord,
  deleteWorkspaceFileRecord,
  listWorkspaceFileRecords,
  sumWorkspaceFileSizes,
  upsertRunnerHeartbeat,
  getMostRecentRunnerHeartbeat,
} from "../workspace.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  return project;
}

describe("workspaces repository", () => {
  test("getWorkspace returns undefined until a workspace row is created", () => {
    const t = createTestDb();
    const project = setupProject(t);
    assert.equal(getWorkspace(t.db, project.id), undefined);
    t.close();
  });

  test("getOrCreateWorkspace is idempotent and defaults to NOT_STARTED", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const first = getOrCreateWorkspace(t.db, project.id);
    const second = getOrCreateWorkspace(t.db, project.id);
    assert.equal(first.id, second.id);
    assert.equal(first.deliveryState, "NOT_STARTED");
    t.close();
  });

  test("setDeliveryState updates state and creates the row if it didn't exist yet", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const updated = setDeliveryState(t.db, project.id, "VERIFIED");
    assert.equal(updated.deliveryState, "VERIFIED");
    t.close();
  });
});

describe("workspace_files repository", () => {
  test("upsertWorkspaceFileRecord creates then updates the same (projectId, path) row", () => {
    const t = createTestDb();
    const project = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "Implement frontend" });

    upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "index.html", sizeBytes: 100, roleId: "frontend-developer", taskId: task.id });
    let records = listWorkspaceFileRecords(t.db, project.id);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.sizeBytes, 100);

    upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "index.html", sizeBytes: 250, roleId: "frontend-developer", taskId: task.id });
    records = listWorkspaceFileRecords(t.db, project.id);
    assert.equal(records.length, 1, "same path must update, not duplicate");
    assert.equal(records[0]!.sizeBytes, 250);
  });

  test("deleteWorkspaceFileRecord removes exactly one file's record", () => {
    const t = createTestDb();
    const project = setupProject(t);
    upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "a.txt", sizeBytes: 10, roleId: null, taskId: null });
    upsertWorkspaceFileRecord(t.db, { projectId: project.id, path: "b.txt", sizeBytes: 20, roleId: null, taskId: null });
    deleteWorkspaceFileRecord(t.db, project.id, "a.txt");
    const records = listWorkspaceFileRecords(t.db, project.id);
    assert.deepEqual(
      records.map((r) => r.path),
      ["b.txt"],
    );
  });

  test("sumWorkspaceFileSizes totals only the given project's files", () => {
    const t = createTestDb();
    const projectA = setupProject(t);
    const owner = getOwner(t.db)!;
    const { project: projectB } = createProjectWithIdea(t.db, { title: "Q", rawIdeaText: "Build another tool.", ownerId: owner.id });

    upsertWorkspaceFileRecord(t.db, { projectId: projectA.id, path: "a.txt", sizeBytes: 100, roleId: null, taskId: null });
    upsertWorkspaceFileRecord(t.db, { projectId: projectA.id, path: "b.txt", sizeBytes: 50, roleId: null, taskId: null });
    upsertWorkspaceFileRecord(t.db, { projectId: projectB.id, path: "a.txt", sizeBytes: 9999, roleId: null, taskId: null });

    assert.equal(sumWorkspaceFileSizes(t.db, projectA.id), 150);
    assert.equal(sumWorkspaceFileSizes(t.db, projectB.id), 9999);
  });
});

describe("runner_heartbeats repository", () => {
  test("upsertRunnerHeartbeat creates then updates the same runner's row", () => {
    const t = createTestDb();
    const first = upsertRunnerHeartbeat(t.db, { runnerId: "runner-1", status: "IDLE", now: 1000 });
    assert.equal(first.status, "IDLE");
    assert.equal(first.startedAt, 1000);

    const second = upsertRunnerHeartbeat(t.db, { runnerId: "runner-1", status: "WORKING", now: 2000 });
    assert.equal(second.status, "WORKING");
    assert.equal(second.startedAt, 1000, "startedAt must not change on subsequent heartbeats");
    assert.equal(second.lastSeenAt, 2000);
  });

  test("getMostRecentRunnerHeartbeat returns whichever runner reported in most recently", () => {
    const t = createTestDb();
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-old", status: "IDLE", now: 1000 });
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-new", status: "WORKING", now: 5000 });
    const latest = getMostRecentRunnerHeartbeat(t.db);
    assert.equal(latest?.runnerId, "runner-new");
  });

  test("getMostRecentRunnerHeartbeat returns undefined when no runner has ever reported in", () => {
    const t = createTestDb();
    assert.equal(getMostRecentRunnerHeartbeat(t.db), undefined);
  });
});
