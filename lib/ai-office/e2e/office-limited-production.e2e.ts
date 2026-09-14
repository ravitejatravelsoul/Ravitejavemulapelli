import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

/**
 * Reimplemented rather than imported — see office-navigation.e2e.ts's
 * identical note (this file runs under plain `node --test`, which cannot
 * resolve the "@/..." alias `credentials.ts` also uses).
 */
function hashOwnerPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

/**
 * Real-browser regression suite for the fix to the post-login Vercel 500:
 * `app/office/(protected)/layout.tsx` used to call `getAppDatabase()`/
 * `getOwner()`/`getOfficeStatus()` unconditionally, so an authenticated
 * production visitor (where `AI_OFFICE_OPERATIONAL_MODE` defaults to
 * disabled — see lib/ai-office/config/operational-mode.ts) hit SQLite on
 * Vercel's non-durable serverless filesystem and got a server error
 * immediately after a successful login.
 *
 * This suite spawns its own real production build (`next build` + `next
 * start`, exactly like office-navigation.e2e.ts) with operational mode
 * left at its safe default (disabled, since no `AI_OFFICE_OPERATIONAL_MODE`
 * override is set and the child runs with `NODE_ENV=production`) AND a
 * deliberately poisoned `AI_OFFICE_DB_PATH` (nested under a plain file,
 * not a directory — `getAppDatabase()` would throw immediately if ever
 * called). Every test below succeeding despite that poisoned path is the
 * direct, structural proof that the authenticated limited-production
 * render path never touches SQLite — not just that it happens to work
 * with a healthy database.
 *
 * A separate spawned server (own port, own build dir) from
 * office-navigation.e2e.ts's, which explicitly opts back into full
 * operational mode to test the real local workspace — that suite's
 * behavior is unchanged and still the source of truth for local/
 * operational-mode-enabled regression coverage.
 */

const PORT = Number(process.env.AI_OFFICE_E2E_LIMITED_PORT) || 3912;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_EMAIL = "limited-e2e-owner@example.test";
const TEST_PASSWORD = "LimitedE2eSmokeTest#" + Math.random().toString(36).slice(2, 10);

let server: ChildProcess;
let poisonedDir: string;
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

before(async () => {
  // A path SQLite cannot possibly open: nested under a plain *file*, not a
  // directory. If the limited-production render path ever accidentally
  // called getAppDatabase(), mkdirSync on this path's parent would throw
  // (ENOTDIR) and the request would fail loudly — see credentials.test.ts
  // for the same technique used against the auth fix.
  poisonedDir = mkdtempSync(join(tmpdir(), "ai-office-e2e-limited-"));
  const notADirectory = join(poisonedDir, "not-a-directory");
  writeFileSync(notADirectory, "");
  const poisonedDbPath = join(notADirectory, "office.db");

  const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const sharedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AI_OFFICE_DB_PATH: poisonedDbPath,
    AI_OFFICE_E2E_DIST_DIR: ".next-e2e-limited",
    OFFICE_OWNER_EMAIL: TEST_EMAIL,
    OFFICE_OWNER_PASSWORD_HASH: hashOwnerPassword(TEST_PASSWORD),
  };
  // Deliberately absent (not merely falsy) — this is exactly the real
  // Vercel-production condition this suite exists to guard: no override,
  // NODE_ENV is "production" (set implicitly by `next build`/`next
  // start`), so isAiOfficeOperationalModeEnabled() must default to false.
  delete sharedEnv.AI_OFFICE_OPERATIONAL_MODE;

  const build = spawnSync(process.execPath, [nextBin, "build"], { cwd: process.cwd(), env: sharedEnv, stdio: "ignore" });
  if (build.status !== 0) {
    throw new Error(`next build failed for the limited-production e2e suite (exit code ${build.status}).`);
  }

  server = spawn(process.execPath, [nextBin, "start", "--port", String(PORT)], {
    cwd: process.cwd(),
    env: sharedEnv,
    stdio: "ignore",
  });
  await waitForServerReady(60_000);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close().catch(() => {});
  if (server && !server.killed && server.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
    } else {
      server.kill();
    }
    await waitForExit(server, 5000);
  }
  rmSync(poisonedDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

async function login(browserInstance: Browser) {
  const page = await browserInstance.newPage({ viewport: { width: 1440, height: 900 } });
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
  return { page, errors };
}

describe("Limited-production authenticated shell — real browser, real production build, poisoned SQLite path", () => {
  test("A+D: login reaches an authenticated page with no server error, showing the LOCAL-ONLY / PRODUCTION OPERATIONS DISABLED badge and a Sign out control", async () => {
    const { page, errors } = await login(browser);

    const bodyText = await page.locator("body").innerText();
    assert.ok(!/couldn.t load|server error/i.test(bodyText), `expected no server-error page, got: ${bodyText.slice(0, 300)}`);
    assert.ok(/local-only/i.test(bodyText), "expected the LOCAL-ONLY badge text");
    assert.ok(/production operations disabled/i.test(bodyText), "expected the PRODUCTION OPERATIONS DISABLED badge text");
    assert.ok(/limited production/i.test(bodyText), "expected a LIMITED PRODUCTION status indicator");
    assert.ok(bodyText.includes(TEST_EMAIL), "expected the signed-in session identity (email) to be shown");

    await page.getByRole("button", { name: /sign out/i }).waitFor({ state: "visible", timeout: 5000 });

    assert.deepEqual(errors, [], "no console/page errors on the limited-production shell");
    await page.close();
  });

  test("E: operational children (sidebar nav, office floor) are not rendered in the limited shell", async () => {
    const { page } = await login(browser);

    assert.equal(await page.locator('nav[aria-label="AI Office"]').count(), 0, "the full operational sidebar nav must not render");
    assert.equal(
      await page.getByRole("button", { name: /Open Teja assistant/i }).count(),
      0,
      "the Teja Assistant launcher (which drives operational actions) must not render",
    );

    await page.close();
  });

  test("F: every deep protected route resolves to the same safe limited shell — no route touches local-only infrastructure", async () => {
    const { page } = await login(browser);

    const deepRoutes = [
      "/office/projects",
      "/office/agents",
      "/office/workspaces",
      "/office/analytics",
      "/office/settings",
      "/office/engineer",
      "/office/local-models",
      "/office/communications",
    ];

    for (const route of deepRoutes) {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));

      const response = await page.goto(`${BASE}${route}`, { waitUntil: "load", timeout: 15_000 });
      assert.ok(response, `expected a response navigating to ${route}`);
      assert.equal(response!.status(), 200, `${route} must not return a server error status`);

      const bodyText = await page.locator("body").innerText();
      assert.ok(!/couldn.t load|server error/i.test(bodyText), `${route} must not render a server-error page, got: ${bodyText.slice(0, 300)}`);
      assert.ok(/local-only/i.test(bodyText), `${route} must resolve to the same limited-production shell`);

      assert.deepEqual(errors, [], `no console/page errors navigating directly to ${route}`);
    }

    await page.close();
  });

  test("H: signing out returns to the login page, and the auth boundary is enforced again afterward", async () => {
    const { page } = await login(browser);

    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(`${BASE}/office/login`, { timeout: 10_000 });
    assert.equal(page.url(), `${BASE}/office/login`, "sign out must return to the login page");

    const response = await page.goto(`${BASE}/office`, { waitUntil: "load", timeout: 15_000 });
    assert.ok(response, "expected a response navigating to /office after sign out");
    await page.waitForURL(`${BASE}/office/login`, { timeout: 10_000 });
    assert.equal(page.url(), `${BASE}/office/login`, "navigating to /office after sign out must redirect back to login, not render the authenticated shell");

    await page.close();
  });
});
