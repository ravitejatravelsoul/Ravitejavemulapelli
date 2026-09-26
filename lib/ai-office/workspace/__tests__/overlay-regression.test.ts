import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, createWorkspace } from "../workspace-service.ts";
import { runQABrowserVerification } from "../qa-browser-verification.ts";
import { validateWorkspaceIntegrity, describeIntegrityFailure } from "../workspace-integrity.ts";

/**
 * Regression for the real failed project: a generated app declared
 * `.hidden{display:none}` BEFORE a component rule `.modal{display:flex;
 * position:fixed;...}`, so the "hidden" confirmation overlay stayed
 * rendered full-screen and intercepted the primary button's clicks. Names
 * here are deliberately different from the original app's.
 */

const PROJECT = "44444444-4444-4444-4444-444444444444";
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>App</title><link rel="stylesheet" href="style.css"></head><body>
<h1>Items</h1><p>Manage a few items on this page.</p>
<button id="add" type="button">Add item</button><p id="status"></p>
<div id="confirm" class="scrim hidden" role="alertdialog" aria-modal="true"><div class="box"><button id="yes" type="button">Yes</button></div></div>
<script src="app.js"></script></body></html>`;
const JS = 'document.getElementById("add").addEventListener("click",function(){document.getElementById("status").textContent="Added an item";});';
const SCRIM = ".scrim { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,.5); display: flex; z-index: 1000; }\n";
const BROKEN_CSS = `.hidden { display: none; }\n${SCRIM}`;
const FIXED_CSS = `${SCRIM}.hidden { display: none !important; }\n`;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-office-overlay-test-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = root;
});
afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(root, { recursive: true, force: true });
});

async function write(cssContent: string) {
  await createWorkspace(PROJECT);
  await writeFile(PROJECT, "index.html", PAGE);
  await writeFile(PROJECT, "style.css", cssContent);
  await writeFile(PROJECT, "app.js", JS);
}

describe("hidden overlay regression", () => {
  test("the deterministic integrity gate flags the defect before QA, with an actionable, generic explanation", async () => {
    await write(BROKEN_CSS);
    const result = await validateWorkspaceIntegrity(PROJECT);
    assert.equal(result.status, "FAIL");
    assert.equal(result.hiddenStateConflicts?.length, 1);
    const text = describeIntegrityFailure(result);
    assert.match(text, /\.hidden/);
    assert.match(text, /\.scrim/);
    assert.match(text, /!important/);
  });

  test("real browser QA: the blocked click is reported with the concrete cause, compacted (no ANSI, no retry loop)", async () => {
    await write(BROKEN_CSS);
    const qa = await runQABrowserVerification(PROJECT);
    assert.equal(qa.status, "FAIL");
    assert.ok(!qa.summary.includes(String.fromCharCode(27)));
    assert.match(qa.summary, /intercepts pointer events/);
    assert.match(qa.summary, /Diagnosis: <div id="confirm" class="scrim hidden"> is marked hidden but is still rendered/);
    assert.ok(!/retrying click action|done scrolling/.test(qa.summary));
    assert.ok(qa.summary.length < 1600, `summary should be compact, got ${qa.summary.length}`);
  });

  test("with the hidden state winning the cascade, the integrity gate passes and real QA passes", async () => {
    await write(FIXED_CSS);
    assert.equal((await validateWorkspaceIntegrity(PROJECT)).status, "PASS");
    const qa = await runQABrowserVerification(PROJECT);
    assert.equal(qa.status, "PASS", qa.summary);
  });
});
