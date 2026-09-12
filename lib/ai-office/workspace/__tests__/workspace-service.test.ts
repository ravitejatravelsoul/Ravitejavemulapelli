import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveSafePath,
  workspaceExists,
  createWorkspace,
  listFiles,
  readFile,
  writeFile,
  deleteFile,
  createDirectory,
  getWorkspaceMetadata,
  WorkspacePathError,
  WorkspaceLimitError,
  MAX_FILE_SIZE_BYTES,
  MAX_WORKSPACE_SIZE_BYTES,
} from "../workspace-service.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-office-workspace-test-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = root;
});

afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(root, { recursive: true, force: true });
});

const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";

describe("resolveSafePath — rejects unsafe input", () => {
  test("rejects absolute paths", () => {
    assert.throws(() => resolveSafePath(PROJECT_A, "/etc/passwd"), WorkspacePathError);
    assert.throws(() => resolveSafePath(PROJECT_A, "C:\\Windows\\System32\\config"), WorkspacePathError);
  });

  test("rejects UNC/device paths", () => {
    assert.throws(() => resolveSafePath(PROJECT_A, "\\\\server\\share\\file.txt"), WorkspacePathError);
  });

  test("rejects '..' traversal anywhere in the path", () => {
    assert.throws(() => resolveSafePath(PROJECT_A, "../outside.txt"), WorkspacePathError);
    assert.throws(() => resolveSafePath(PROJECT_A, "nested/../../outside.txt"), WorkspacePathError);
    assert.throws(() => resolveSafePath(PROJECT_A, `../${PROJECT_B}/secret.txt`), WorkspacePathError);
  });

  test("rejects null bytes", () => {
    assert.throws(() => resolveSafePath(PROJECT_A, "file\0.txt"), WorkspacePathError);
  });

  test("rejects Windows reserved device names", () => {
    assert.throws(() => resolveSafePath(PROJECT_A, "CON"), WorkspacePathError);
    assert.throws(() => resolveSafePath(PROJECT_A, "CON.txt"), WorkspacePathError);
    assert.throws(() => resolveSafePath(PROJECT_A, "nested/NUL"), WorkspacePathError);
    assert.throws(() => resolveSafePath(PROJECT_A, "lpt1.log"), WorkspacePathError);
  });

  test("rejects an invalid project id", () => {
    assert.throws(() => resolveSafePath("../not-a-real-project", "file.txt"), WorkspacePathError);
    assert.throws(() => resolveSafePath("proj/with/slashes", "file.txt"), WorkspacePathError);
  });

  test("accepts a plain nested relative path", () => {
    const resolved = resolveSafePath(PROJECT_A, "src/index.html");
    assert.ok(resolved.includes(PROJECT_A));
    assert.ok(resolved.endsWith(join("src", "index.html")));
  });
});

describe("resolveSafePath — symlink escape rejection", () => {
  test("rejects a path that resolves through a symlink pointing outside the workspace", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "ai-office-outside-"));
    try {
      mkdirSync(join(root, PROJECT_A), { recursive: true });
      const linkPath = join(root, PROJECT_A, "escape-link");
      try {
        symlinkSync(outsideDir, linkPath, "junction");
      } catch {
        // Symlink creation can require elevated privileges on some Windows
        // configurations — skip this specific assertion there rather than
        // failing the whole suite on an environment limitation.
        return;
      }
      assert.throws(() => resolveSafePath(PROJECT_A, "escape-link/file.txt"), WorkspacePathError);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("cross-project isolation", () => {
  test("writing to project A never touches project B's workspace", async () => {
    await writeFile(PROJECT_A, "index.html", "<h1>A</h1>");
    await writeFile(PROJECT_B, "index.html", "<h1>B</h1>");

    assert.equal(await readFile(PROJECT_A, "index.html"), "<h1>A</h1>");
    assert.equal(await readFile(PROJECT_B, "index.html"), "<h1>B</h1>");

    const filesA = await listFiles(PROJECT_A);
    const filesB = await listFiles(PROJECT_B);
    assert.deepEqual(filesA, ["index.html"]);
    assert.deepEqual(filesB, ["index.html"]);
  });
});

describe("workspace lifecycle", () => {
  test("workspaceExists is false before creation and true after", async () => {
    assert.equal(workspaceExists(PROJECT_A), false);
    await createWorkspace(PROJECT_A);
    assert.equal(workspaceExists(PROJECT_A), true);
  });

  test("writeFile lazily creates the workspace and any nested directories", async () => {
    assert.equal(workspaceExists(PROJECT_A), false);
    await writeFile(PROJECT_A, "nested/deep/file.txt", "hello");
    assert.equal(workspaceExists(PROJECT_A), true);
    assert.equal(await readFile(PROJECT_A, "nested/deep/file.txt"), "hello");
  });

  test("listFiles returns a sorted, forward-slash-joined relative path list", async () => {
    await writeFile(PROJECT_A, "b.txt", "b");
    await writeFile(PROJECT_A, "a.txt", "a");
    await writeFile(PROJECT_A, "nested/c.txt", "c");
    assert.deepEqual(await listFiles(PROJECT_A), ["a.txt", "b.txt", "nested/c.txt"]);
  });

  test("writeFile is atomic — no partial file is ever left on the target path (no stray .tmp files after success)", async () => {
    await writeFile(PROJECT_A, "index.html", "<html></html>");
    const files = await listFiles(PROJECT_A);
    assert.ok(!files.some((f) => f.endsWith(".tmp")), "no leftover temp file should remain after a successful write");
  });

  test("deleteFile removes the file; a missing file is a safe no-op", async () => {
    await writeFile(PROJECT_A, "a.txt", "a");
    await deleteFile(PROJECT_A, "a.txt");
    assert.deepEqual(await listFiles(PROJECT_A), []);
    await assert.doesNotReject(() => deleteFile(PROJECT_A, "never-existed.txt"));
  });

  test("createDirectory creates an empty directory without error", async () => {
    await assert.doesNotReject(() => createDirectory(PROJECT_A, "empty-dir"));
  });

  test("getWorkspaceMetadata reports exists/fileCount/totalSizeBytes accurately", async () => {
    const before = await getWorkspaceMetadata(PROJECT_A);
    assert.equal(before.exists, false);

    await writeFile(PROJECT_A, "a.txt", "12345");
    await writeFile(PROJECT_A, "b.txt", "1234567890");
    const after = await getWorkspaceMetadata(PROJECT_A);
    assert.equal(after.exists, true);
    assert.equal(after.fileCount, 2);
    assert.equal(after.totalSizeBytes, 15);
  });
});

describe("size limits", () => {
  test("rejects a single file over the per-file byte limit", async () => {
    const tooBig = "x".repeat(MAX_FILE_SIZE_BYTES + 1);
    await assert.rejects(() => writeFile(PROJECT_A, "huge.txt", tooBig), WorkspaceLimitError);
  });

  test("rejects a write that would push the whole workspace over its total byte limit, even though each individual file stays under the per-file limit", async () => {
    // Fill the workspace with files just under the per-file cap until the
    // total is close to MAX_WORKSPACE_SIZE_BYTES, entirely independent of
    // the per-file check above.
    const chunkSize = MAX_FILE_SIZE_BYTES - 1024;
    const chunk = "x".repeat(chunkSize);
    const filesNeeded = Math.floor(MAX_WORKSPACE_SIZE_BYTES / chunkSize);
    for (let i = 0; i < filesNeeded; i++) {
      await writeFile(PROJECT_A, `chunk-${i}.txt`, chunk);
    }
    const meta = await getWorkspaceMetadata(PROJECT_A);
    assert.ok(meta.totalSizeBytes <= MAX_WORKSPACE_SIZE_BYTES, "setup must not itself exceed the limit");

    await assert.rejects(() => writeFile(PROJECT_A, "one-more.txt", "x".repeat(chunkSize)), WorkspaceLimitError);
  });

  test("overwriting an existing file correctly accounts for its previous size (doesn't double-count)", async () => {
    await writeFile(PROJECT_A, "a.txt", "x".repeat(1000));
    // Rewriting the same file with equal size must not spuriously trip the workspace-total limit.
    await assert.doesNotReject(() => writeFile(PROJECT_A, "a.txt", "y".repeat(1000)));
    const meta = await getWorkspaceMetadata(PROJECT_A);
    assert.equal(meta.totalSizeBytes, 1000);
  });
});
