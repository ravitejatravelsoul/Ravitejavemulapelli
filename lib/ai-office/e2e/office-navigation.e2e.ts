import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

/**
 * Deliberately reimplemented here rather than importing
 * `../auth/credentials.ts`'s `hashOwnerPassword` — that module also
 * imports `@/lib/...`-aliased files (for its *other* export,
 * `verifyOwnerCredentials`), which only Next's bundler resolves; this
 * file runs under plain `node --test`, exactly like every other test in
 * this codebase (see lib/ai-office/db/client.ts's identical note on
 * relative, extension-explicit imports). Must stay byte-for-byte
 * identical to the real implementation's format (`${salt}:${hashHex}`,
 * scrypt, 64-byte key) or the seeded owner simply can't log in.
 */
function hashOwnerPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

/**
 * A permanent, real-browser regression guard for exactly the defect class
 * found in the first Claude LIVE pilot's system-reliability report: a
 * full-viewport, invisible overlay (the Teja Assistant's old backdrop)
 * silently intercepted clicks on the primary sidebar navigation — every
 * prior verification had only ever asserted an element was *visible*,
 * never that clicking it actually navigated anywhere. This suite performs
 * real `.click()`s through a real Chromium instance against a real,
 * spawned production (`next build` + `next start`) server and asserts the
 * resulting URL, not just DOM presence.
 *
 * Deliberately NOT part of `npm run test:ai-office` (that suite is
 * DB/domain-logic-only, with zero Next.js server dependency, and stays
 * fast/hermetic by design) — run explicitly via `npm run
 * test:ai-office:e2e`. Fully isolated from the real `.data/office.db`:
 * `AI_OFFICE_DB_PATH` points the spawned server at a disposable temp
 * file, and `OFFICE_OWNER_EMAIL`/`OFFICE_OWNER_PASSWORD_HASH` seed a
 * fresh, throwaway test-only owner account in it — the real owner
 * account and the real pilot project are never touched.
 */

const PORT = Number(process.env.AI_OFFICE_E2E_PORT) || 3911;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_EMAIL = "e2e-owner@example.test";
const TEST_PASSWORD = "E2eSmokeTest#" + Math.random().toString(36).slice(2, 10);

let server: ChildProcess;
let dbDir: string;
let browser: Browser;

function waitForServerReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(`${BASE}/office/login`);
        if (res.status === 200) {
          resolve();
          return;
        }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        reject(new Error(`Server did not become ready on ${BASE} within ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, 500);
    };
    void attempt();
  });
}

before(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "ai-office-e2e-db-"));
  const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const sharedEnv = {
    ...process.env,
    AI_OFFICE_DB_PATH: join(dbDir, "office.db"),
    // A distinct build output directory, *inside* the project root (Next
    // requires this — an absolute/external path is rejected), is what
    // actually lets this run alongside an already-running interactive
    // `next dev` in the same directory without colliding with it.
    AI_OFFICE_E2E_DIST_DIR: ".next-e2e",
    OFFICE_OWNER_EMAIL: TEST_EMAIL,
    OFFICE_OWNER_PASSWORD_HASH: hashOwnerPassword(TEST_PASSWORD),
    // Deliberately no ANTHROPIC_* vars — this suite never needs Claude configured.
    // This spawns a REAL `next build` + `next start` (NODE_ENV=production
    // in the child), which the V1 limited-production operational-mode
    // guard (lib/ai-office/config/operational-mode.ts) would otherwise
    // read as "no durable hosting configured" and correctly disable
    // project creation/execution — exactly its intended behavior for a
    // real Vercel deployment, but wrong for this suite, which tests a
    // fully operational AI Office end-to-end against a production build,
    // not the production-lockdown behavior itself. Explicit opt-in, the
    // same escape hatch a real durably-hosted production deployment would use.
    AI_OFFICE_OPERATIONAL_MODE: "enabled",
  };

  // A real production build + `next start`, not `next dev` — `next dev`
  // both (a) refuses to run a second instance from the same project
  // directory at all (its single-dev-server lock lives inside the *default*
  // `.next/`, keyed by directory, not port — a different `distDir` avoids
  // that specific conflict) and (b), even once that's worked around, was
  // observed to fail its HMR WebSocket's upgrade handshake in this spawn
  // setup, which left client components un-hydrated (a click landing on
  // the right element but never reaching React's handler — exactly the
  // silent-failure shape a "did the click even happen" smoke test exists
  // to catch, just from Next's dev tooling instead of this app's code).
  // `next start` has no HMR, no dev-server singleton lock, and is a more
  // faithful stand-in for what an owner's browser actually experiences.
  const build = spawnSync(process.execPath, [nextBin, "build"], { cwd: process.cwd(), env: sharedEnv, stdio: "ignore" });
  if (build.status !== 0) {
    throw new Error(`next build failed for the e2e suite (exit code ${build.status}) — see the isolated .next-e2e build output for details.`);
  }

  server = spawn(process.execPath, [nextBin, "start", "--port", String(PORT)], {
    cwd: process.cwd(),
    env: sharedEnv,
    stdio: "ignore",
  });
  await waitForServerReady(60_000);
  browser = await chromium.launch();
});

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

after(async () => {
  await browser?.close().catch(() => {});
  if (server && !server.killed && server.pid) {
    if (process.platform === "win32") {
      // Windows doesn't tie a spawned child's own children to it the way
      // POSIX process groups do — Next's server process can itself spawn
      // further workers, so a plain `child.kill()` may leave part of the
      // tree (and its open SQLite file handles) running. `taskkill /T`
      // kills the whole tree.
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
    } else {
      server.kill();
    }
    await waitForExit(server, 5000);
  }
  // A small grace window plus fs.rmSync's own retry/backoff — Windows can
  // hold the just-closed SQLite (WAL-mode) file handles open for a brief
  // moment after the process is confirmed gone, not the instant it exits.
  rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

describe("Office navigation — real clicks, real browser, isolated database", () => {
  test("sign in, then every sidebar destination is genuinely clickable (URL actually changes), not merely rendered", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.goto(`${BASE}/office/login`);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/office`, { timeout: 15_000 });
    // /office is the fullscreen Headquarters (it covers the shell); the shell's own nav is exercised from Classic Office.
    await page.goto(`${BASE}/office/classic`);

    const destinations = [
      "/office/projects",
      "/office/agents",
      "/office/workspaces",
      "/office/local-models",
      "/office/analytics",
      "/office/settings",
      "/office/classic",
      "/office",
    ];

    for (const href of destinations) {
      const link = page.locator(`nav[aria-label="AI Office"] a[href="${href}"]`).first();
      await link.click({ timeout: 5000 });
      await page.waitForURL(`${BASE}${href}`, { timeout: 5000 });
      assert.equal(page.url(), `${BASE}${href}`, `clicking the "${href}" sidebar link must actually navigate there`);
    }

    assert.deepEqual(consoleErrors, [], "no uncaught client-side errors during navigation");
    await page.close();
  });

  test("opening the Teja Assistant panel never blocks navigation to another page (regression guard for the exact incident found)", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(`${BASE}/office/login`);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/office`, { timeout: 15_000 });
    // The assistant lives in the shared shell; the Headquarters scene is fullscreen, so drive it from Classic Office.
    await page.goto(`${BASE}/office/classic`);

    const launcher = page.getByRole("button", { name: /Open Teja assistant/i });
    await launcher.waitFor({ state: "visible", timeout: 10_000 });
    await launcher.click();
    try {
      await page.waitForSelector('div[role="dialog"]', { timeout: 10_000 });
    } catch (e) {
      console.log("console/page errors during test:", JSON.stringify(errors));
      throw e;
    }

    const projectsLink = page.locator('nav[aria-label="AI Office"] a[href="/office/projects"]').first();
    await projectsLink.click({ timeout: 5000 });
    await page.waitForURL(`${BASE}/office/projects`, { timeout: 5000 });
    assert.equal(page.url(), `${BASE}/office/projects`, "sidebar nav must work even while the assistant panel is open");

    await page.close();
  });

  /**
   * Platform-hardening phase, Part 1/15 regression guard — a real defect
   * found on a narrow (mobile) viewport: the project detail page's
   * TabsList uses `flex-wrap` so its tabs wrap to a second row once there
   * are enough of them, but the base Tabs component also hardcodes a
   * fixed `h-9` height. The wrapped second row then overflowed that fixed
   * height and visually spilled onto the TabsContent below it — every tab
   * still LOOKED clickable (`visible`/`enabled` both true), but a real
   * click on it actually landed on the content card underneath instead
   * (Playwright's own "element intercepts pointer events" failure — not a
   * console error, not a hydration warning, just a click silently
   * swallowed by the wrong element). Fixed by adding `h-auto` alongside
   * `flex-wrap`. This test creates a real project through the real UI
   * (not a fixture) and, at a narrow viewport, clicks through every real
   * tab present, asserting each one actually activates — the general
   * form of "no pointer interception," not dependent on a specific tab
   * count ever recurring exactly.
   */
  test("every project-detail tab is genuinely clickable on a narrow (mobile) viewport — no pointer interception from wrapped tabs", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(`${BASE}/office/login`);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/office`, { timeout: 15_000 });

    await page.goto(`${BASE}/office/projects/new`);
    await page.fill("#title", "Mobile Tab Click Test");
    await page.fill("#ideaText", "A tiny idea used only to exercise the project detail page's tabs on a narrow viewport.");
    await page.getByRole("button", { name: "Simulation" }).click();
    await page.getByRole("button", { name: "Create Project" }).click();
    await page.waitForURL(/\/office\/projects\/[a-f0-9-]+$/, { timeout: 15_000 });

    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    assert.ok(count >= 4, `expected several real tabs on the project detail page, found ${count}`);

    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      const label = await tab.textContent();
      await tab.click({ timeout: 5000 });
      const selected = await tab.getAttribute("aria-selected");
      assert.equal(selected, "true", `clicking tab "${label}" on a narrow viewport must actually select it, not be intercepted by another element`);
    }

    assert.deepEqual(errors, [], "no console/page errors while clicking through every tab");
    await page.close();
  });
});
