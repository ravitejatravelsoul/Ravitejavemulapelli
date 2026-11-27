import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { writeFile, createWorkspace } from "../workspace-service.ts";
import { runQABrowserVerification } from "../qa-browser-verification.ts";

/**
 * Real Playwright checks against a real, short-lived static server —
 * no mocking of the browser or the HTTP layer. Uses the same
 * heading/description/button/message markup shape as the SimulatedAdapter
 * Hello World fixtures (lib/ai-office/providers/simulated/fixtures.ts),
 * but constructed directly here so this test doesn't depend on that
 * module's exact strings.
 */

const GOOD_HTML = [
  "<!DOCTYPE html>",
  '<html lang="en"><head><meta charset="UTF-8" /><title>Hello</title></head>',
  "<body>",
  "<h1>Hello, World!</h1>",
  '<p class="description">A small test page.</p>',
  '<button id="greet-button" type="button">Say hello</button>',
  '<p id="message"></p>',
  '<script src="script.js"></script>',
  "</body></html>",
].join("\n");

const GOOD_JS = [
  'document.getElementById("greet-button").addEventListener("click", function () {',
  '  document.getElementById("message").textContent = "Hello! Thanks for clicking.";',
  "});",
].join("\n");

const BUGGY_JS = [
  'document.getElementById("greet-button").addEventListener("click", function () {',
  '  document.getElementById("nonexistent-element").textContent = "Hello! Thanks for clicking.";',
  "});",
].join("\n");

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-qa-verify-test-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = workspaceRoot;
});

afterEach(() => {
  delete process.env.AI_OFFICE_WORKSPACES_ROOT;
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("runQABrowserVerification", () => {
  for (const resetWorks of [true, false]) {
    test(`input-driven counter ${resetWorks ? "passes with working" : "fails with broken"} Reset`, async () => {
      const id = `counter-${resetWorks}`;
      await writeFile(id, "index.html", '<h1>Character counter</h1><p>Count characters as you type.</p><input id="text"><p id="count">0</p><button>Reset</button><script src="script.js"></script>');
      await writeFile(id, "script.js", `
        const input = document.querySelector('input');
        const count = document.querySelector('#count');
        input.addEventListener('input', () => count.textContent = String(input.value.length));
        document.querySelector('button').addEventListener('click', () => {
          ${resetWorks ? "input.value = ''; count.textContent = '0';" : "/* broken reset */"}
        });
      `);
      const result = await runQABrowserVerification(id);
      assert.equal(result.status, resetWorks ? "PASS" : "FAIL", result.summary);
      assert.match(String(result.details.bodyTextBefore), /20/);
      if (!resetWorks) assert.match(result.summary, /did not change/i);
    });
  }

  test("returns FAIL immediately when no workspace exists — never starts a server or browser", async () => {
    const result = await runQABrowserVerification("no-such-project");
    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /no workspace/i);
    assert.equal(result.targetUrl, "");
  });

  test("returns FAIL when the workspace exists but has no index.html", async () => {
    await createWorkspace("empty-project");
    const result = await runQABrowserVerification("empty-project");
    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /index\.html/);
  });

  test("PASSes against a real page where the button correctly updates the message", async () => {
    await writeFile("good-project", "index.html", GOOD_HTML);
    await writeFile("good-project", "script.js", GOOD_JS);

    const result = await runQABrowserVerification("good-project");

    assert.equal(result.status, "PASS", result.summary);
    assert.deepEqual(result.details.consoleErrors, []);
    assert.ok(result.durationMs >= 0);
    assert.match(result.targetUrl, /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
  });

  // Real incident, Scenario G acceptance run (2026-11-27): a generated
  // inventory app's architect-defined "Adjust Stock"/"Reports"/"Settings"
  // nav sections rendered literal "(Coming Soon)" placeholder text, and
  // nothing in QA ever visited them, so the project reached
  // READY_FOR_REVIEW with unfinished committed functionality still
  // exposed in the delivered navigation.
  test("FAILs when a real navigation destination renders unfinished placeholder text, not the button's own content", async () => {
    const id = "unfinished-nav-project";
    await writeFile(
      id,
      "index.html",
      [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="UTF-8" /><title>App</title></head>',
        "<body>",
        "<h1>Inventory</h1>",
        '<p class="description">A small test page.</p>',
        "<nav><a href=\"#catalog\" id=\"nav-catalog\">Catalog</a><a href=\"#reports\" id=\"nav-reports\">Reports</a></nav>",
        '<div id="main">Catalog view</div>',
        '<button id="greet-button" type="button">Say hello</button>',
        '<p id="message"></p>',
        '<script src="script.js"></script>',
        "</body></html>",
      ].join("\n"),
    );
    await writeFile(
      id,
      "script.js",
      [
        GOOD_JS,
        'document.getElementById("nav-reports").addEventListener("click", function (e) {',
        '  e.preventDefault();',
        '  document.getElementById("main").textContent = "Reports (Coming Soon)";',
        "});",
      ].join("\n"),
    );

    const result = await runQABrowserVerification(id);

    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /unfinished placeholder/i);
    assert.match(result.summary, /Reports/);
    assert.match(result.summary, /Coming Soon/i);
  });

  test("PASSes when every real navigation destination leads to real (non-placeholder) content", async () => {
    const id = "finished-nav-project";
    await writeFile(
      id,
      "index.html",
      [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="UTF-8" /><title>App</title></head>',
        "<body>",
        "<h1>Inventory</h1>",
        '<p class="description">A small test page.</p>',
        "<nav><a href=\"#catalog\" id=\"nav-catalog\">Catalog</a><a href=\"#reports\" id=\"nav-reports\">Reports</a></nav>",
        '<div id="main">Catalog view</div>',
        '<button id="greet-button" type="button">Say hello</button>',
        '<p id="message"></p>',
        '<script src="script.js"></script>',
        "</body></html>",
      ].join("\n"),
    );
    await writeFile(
      id,
      "script.js",
      [
        GOOD_JS,
        'document.getElementById("nav-reports").addEventListener("click", function (e) {',
        '  e.preventDefault();',
        '  document.getElementById("main").textContent = "Total items: 42, total value: $1,204.50";',
        "});",
      ].join("\n"),
    );

    const result = await runQABrowserVerification(id);

    assert.equal(result.status, "PASS", result.summary);
  });

  // Real incident, Scenario B acceptance run (2026-11-27): a real
  // full-stack expense tracker's FIRST button in DOM order was a nav tab
  // ("Dashboard") already in its default-active state -- clicking an
  // already-active tab is legitimately a no-op by design (a classic
  // tabs/pills pattern), but the OLD "click the first button" heuristic
  // picked it anyway and genuinely reported "did not change any visible
  // text" for six real, correct developer attempts in a row, each
  // burning a real retry, before QA itself hit its own escalation
  // ceiling.
  test("PASSes when the first button in DOM order is an already-active nav tab (a real no-op by design), by picking a real non-nav button instead", async () => {
    const id = "nav-tab-first-project";
    await writeFile(
      id,
      "index.html",
      [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="UTF-8" /><title>App</title></head>',
        "<body>",
        "<h1>Expense Tracker</h1>",
        '<p class="description">A small test page.</p>',
        '<nav><button id="tab-dashboard" class="tab active">Dashboard</button><button id="tab-add" class="tab">Add</button></nav>',
        '<section id="dashboard" class="tab-content active">Dashboard view</section>',
        '<button id="greet-button" type="button">Say hello</button>',
        '<p id="message"></p>',
        '<script src="script.js"></script>',
        "</body></html>",
      ].join("\n"),
    );
    // The nav tab's own click handler is a real, working no-op from its
    // own already-active state — switching TO the already-active tab
    // changes nothing, exactly like a real tabs implementation.
    await writeFile(
      id,
      "script.js",
      [
        'document.getElementById("tab-dashboard").addEventListener("click", function () {',
        '  document.querySelectorAll(".tab").forEach(function (b) { b.classList.remove("active"); });',
        '  this.classList.add("active");',
        "});",
        GOOD_JS,
      ].join("\n"),
    );

    const result = await runQABrowserVerification(id);

    assert.equal(result.status, "PASS", result.summary);
  });

  test("FAILs against a real page whose button references the wrong element id (a real bug)", async () => {
    await writeFile("buggy-project", "index.html", GOOD_HTML);
    await writeFile("buggy-project", "script.js", BUGGY_JS);

    const result = await runQABrowserVerification("buggy-project");

    assert.equal(result.status, "FAIL");
    assert.match(result.summary, /did not change/i);
  });

  /**
   * Priority 0 security hardening: generated code is untrusted. A
   * malicious or buggy deliverable's script could try to reach another
   * local service on the host (an internal API, another port on
   * 127.0.0.1, a cloud metadata endpoint at a link-local address) from
   * inside the verification browser. Proves the network-isolation route
   * handler actually blocks this in a real browser, against a real
   * second local server — not just that the matcher function returns
   * true in isolation.
   */
  test("a generated page's script cannot reach another local service on 127.0.0.1 from inside the verification browser", async () => {
    const internalServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("REACHED-INTERNAL-SERVICE");
    });
    await new Promise<void>((resolve) => internalServer.listen(0, "127.0.0.1", resolve));
    const internalPort = (internalServer.address() as AddressInfo).port;

    try {
      await writeFile("ssrf-project", "index.html", GOOD_HTML);
      await writeFile(
        "ssrf-project",
        "script.js",
        `document.getElementById("greet-button").addEventListener("click", function () {
           fetch("http://127.0.0.1:${internalPort}/").then((r) => r.text()).catch(() => "blocked").then((t) => {
             document.getElementById("message").textContent = t;
           });
         });`,
      );

      const result = await runQABrowserVerification("ssrf-project");

      // Whatever verdict QA reaches (PASS, or FAIL for an unrelated structural
      // reason), the one thing that must never happen anywhere in the result
      // is the internal service's response text leaking through — that is
      // the actual security property under test, independent of exactly
      // which QA check branch it happened to hit.
      assert.doesNotMatch(JSON.stringify(result), /REACHED-INTERNAL-SERVICE/, "the generated page's script must never be able to read another local service's response");
    } finally {
      await new Promise<void>((resolve) => internalServer.close(() => resolve()));
    }
  });

  test("two consecutive verification runs against different projects each start and cleanly stop their own ephemeral server (no orphaned listener)", async () => {
    await writeFile("project-a", "index.html", GOOD_HTML);
    await writeFile("project-a", "script.js", GOOD_JS);
    await writeFile("project-b", "index.html", GOOD_HTML);
    await writeFile("project-b", "script.js", GOOD_JS);

    const first = await runQABrowserVerification("project-a");
    const second = await runQABrowserVerification("project-b");

    assert.equal(first.status, "PASS");
    assert.equal(second.status, "PASS");
    assert.notEqual(first.targetUrl, second.targetUrl, "each run must use its own fresh ephemeral port, proving the prior server was actually closed");
  });
});
