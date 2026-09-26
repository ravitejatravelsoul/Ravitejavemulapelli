import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { compactFailureEvidence } from "../failure-evidence.ts";

const ESC = String.fromCharCode(27);
const dim = (line: string) => `${ESC}[2m${line}${ESC}[22m`;
const INTERCEPT = '  - <div aria-modal="true" role="alertdialog" id="confirm-delete" class="modal hidden" aria-labelledby="confirm-delete-title">…</div> intercepts pointer events';

// Mirrors the raw Playwright message stored by the real failed project (colour codes + retry loop).
const REAL = [
  "Browser verification threw an unexpected error: locator.click: Timeout 30000ms exceeded.",
  "Call log:",
  ...[
    "  - waiting for locator('button').first()",
    '    - locator resolved to <button class="primary" id="add-note-btn" aria-label="Add a new note">+ Add Note</button>',
    "  - attempting click action",
    "    2 × waiting for element to be visible, enabled and stable",
    "      - element is visible, enabled and stable",
    "      - scrolling into view if needed",
    "      - done scrolling",
    INTERCEPT,
    "    - retrying click action",
    "    - waiting 20ms",
    "    2 × waiting for element to be visible, enabled and stable",
    "      - element is visible, enabled and stable",
    "      - scrolling into view if needed",
    "      - done scrolling",
    INTERCEPT,
    "    - retrying click action",
    "    - waiting 100ms",
  ].map(dim),
].join("\n");

describe("compactFailureEvidence", () => {
  test("removes colour codes and retry-loop noise but keeps the primary error and the exact intercepting element", () => {
    const out = compactFailureEvidence(REAL);
    assert.ok(!out.includes(ESC));
    assert.match(out, /locator\.click: Timeout 30000ms exceeded/);
    assert.match(out, /locator resolved to <button class="primary" id="add-note-btn"/);
    assert.match(out, /<div aria-modal="true" role="alertdialog" id="confirm-delete" class="modal hidden"[^\n]*intercepts pointer events \(repeated 2x\)/);
    assert.ok(!/retrying click action|scrolling into view|done scrolling|waiting 100ms/.test(out));
    assert.ok(out.length < REAL.length / 2, `expected a large reduction, got ${out.length} of ${REAL.length}`);
  });

  test("never drops a distinct diagnostic line, and caps very long evidence while keeping head and tail", () => {
    const long = ["FIRST primary error", ...Array.from({ length: 200 }, (_, i) => `unique observation number ${i}`), "LAST final observation"].join("\n");
    const out = compactFailureEvidence(long, 600);
    assert.match(out, /FIRST primary error/);
    assert.match(out, /LAST final observation/);
    assert.match(out, /evidence compacted/);
    assert.ok(out.length <= 700);
    assert.equal(compactFailureEvidence("only line", 600), "only line");
  });
});
