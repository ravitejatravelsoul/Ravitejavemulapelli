import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, createWorkspace } from "../workspace-service.ts";
import { validateWorkspaceIntegrity, describeIntegrityFailure } from "../workspace-integrity.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-office-integrity-test-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = root;
});
afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(root, { recursive: true, force: true });
});

const PROJECT = "33333333-3333-3333-3333-333333333333";

describe("validateWorkspaceIntegrity", () => {
  test("1. index.html references an existing script.js → PASS", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "index.html", '<html><body><script src="script.js"></script></body></html>');
    await writeFile(PROJECT, "script.js", "console.log('hi');");

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.missingReferences, []);
  });

  test("2. index.html references a missing script.js → FAIL", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "index.html", '<html><body><script src="script.js"></script></body></html>');

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "FAIL");
    assert.deepEqual(result.missingReferences, [{ sourceFile: "index.html", reference: "script.js" }]);
  });

  test("3. index.html references a missing style.css (stylesheet link) → FAIL", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "index.html", '<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>');

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "FAIL");
    assert.deepEqual(result.missingReferences, [{ sourceFile: "index.html", reference: "style.css" }]);
  });

  test("4. a remote CDN script is ignored → PASS", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "index.html", '<html><body><script src="https://cdn.example.com/lib.js"></script></body></html>');

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS");
  });

  test("5. a data URI image is ignored", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "index.html", '<html><body><img src="data:image/png;base64,aaaa"></body></html>');

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS");
  });

  test("6. hash/query suffixes are stripped before checking existence", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "index.html", '<html><body><script src="script.js?v=1"></script></body></html>');
    await writeFile(PROJECT, "script.js", "console.log('hi');");

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS", "script.js?v=1 must resolve to the real script.js file");
  });

  test("7. a nested relative local path resolves against its own directory, not the workspace root", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "pages/about.html", '<html><body><script src="scripts/about.js"></script></body></html>');
    await writeFile(PROJECT, "pages/scripts/about.js", "console.log('about');");

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS");
  });

  test("8. a reference that normalizes outside the workspace root is never flagged as missing (no traversal, no false positive)", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "index.html", '<html><body><script src="../../etc/passwd"></script></body></html>');

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS", "an out-of-workspace reference is skipped, never resolved against the real filesystem");
  });

  test("mailto/tel/javascript/hash-only references are never treated as missing local files", async () => {
    await createWorkspace(PROJECT);
    await writeFile(
      PROJECT,
      "index.html",
      '<html><body><a href="mailto:a@b.com"></a><img src="#anchor"><script src="javascript:void(0)"></script></body></html>',
    );

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS");
  });

  test("a <link> tag without rel=stylesheet (e.g. a favicon) is not validated — avoids a false positive on a lower-confidence reference", async () => {
    await createWorkspace(PROJECT);
    await writeFile(PROJECT, "index.html", '<html><head><link rel="icon" href="favicon.ico"></head><body></body></html>');

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS");
  });

  test("multiple missing references are all reported, not just the first", async () => {
    await createWorkspace(PROJECT);
    await writeFile(
      PROJECT,
      "index.html",
      '<html><head><link rel="stylesheet" href="style.css"></head><body><script src="script.js"></script></body></html>',
    );

    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "FAIL");
    assert.equal(result.missingReferences.length, 2);
  });

  test("no workspace at all is treated as PASS (nothing to validate) — this validator only judges what a workspace actually contains", async () => {
    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "PASS");
  });
});

describe("describeIntegrityFailure", () => {
  test("produces the exact human-readable sentence used as the semantic failure reason", () => {
    const description = describeIntegrityFailure({
      status: "FAIL",
      missingReferences: [{ sourceFile: "index.html", reference: "script.js" }],
    });
    assert.equal(description, "Workspace integrity validation failed: index.html references script.js, but script.js does not exist.");
  });

  test("notes additional missing references beyond the first", () => {
    const description = describeIntegrityFailure({
      status: "FAIL",
      missingReferences: [
        { sourceFile: "index.html", reference: "script.js" },
        { sourceFile: "index.html", reference: "style.css" },
      ],
    });
    assert.match(description, /and 1 more missing reference/);
  });
});
