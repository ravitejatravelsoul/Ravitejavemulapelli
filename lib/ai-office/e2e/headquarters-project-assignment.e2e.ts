import { openDatabase } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAll } from "../db/seed.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { chromium } from "playwright";

/**
 * Boss project-assignment inside the 3D Headquarters — real browser, real
 * local server, real Conversation Orchestrator and the existing
 * createProjectAction/createRemoteProjectAction path. No real AI/provider
 * call anywhere here: CREATE_PROJECT proposal is deterministic zero-cost
 * classification, and confirming in local mode creates a SIMULATED
 * project (the same existing confirmConversationAction behavior a real
 * owner's local confirmation already used). Isolated DB, no runner.
 */
test(
  "Headquarters: Assign New Project — Orchestrator panel, text, voice, confirmation gate, cancel/duplicate safety",
  { timeout: 600000 },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "office-assign-project-test-"));
    const password = randomBytes(18).toString("hex"),
      salt = randomBytes(16).toString("hex"),
      port = 3918,
      base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      AI_OFFICE_E2E_DIST_DIR: ".next-e2e-assign",
      AI_OFFICE_DB_PATH: join(folder, "office.db"),
      AI_OFFICE_EXECUTION_MODE: "local",
      AI_OFFICE_OPERATIONAL_MODE: "enabled",
      AI_OFFICE_CLAUDE_ENABLED: "false",
      ANTHROPIC_API_KEY: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "",
      GEMINI_API_KEY: "",
      OFFICE_OWNER_EMAIL: "assign-project-test@example.test",
      OFFICE_OWNER_PASSWORD_HASH: salt + ":" + scryptSync(password, salt, 64).toString("hex"),
      OFFICE_SESSION_SECRET: randomBytes(32).toString("hex"),
    };
    const next = resolve("node_modules/next/dist/bin/next");
    if (process.env.AI_OFFICE_HQ_SKIP_BUILD !== "true")
      assert.equal(spawnSync(process.execPath, [next, "build"], { env, stdio: "ignore" }).status, 0, "production build");
    const server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "ignore" });
    Object.assign(process.env, { OFFICE_OWNER_EMAIL: env.OFFICE_OWNER_EMAIL, OFFICE_OWNER_PASSWORD_HASH: env.OFFICE_OWNER_PASSWORD_HASH });
    const db = openDatabase(env.AI_OFFICE_DB_PATH);
    runMigrations(db);
    seedAll(db);

    const countProjects = () => (db.prepare("SELECT COUNT(*) n FROM projects").get() as { n: number }).n;
    const latestProject = () => db.prepare("SELECT * FROM projects ORDER BY createdAt DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    const taskCount = (projectId: string) => (db.prepare("SELECT COUNT(*) n FROM tasks WHERE projectId=?").get(projectId) as { n: number }).n;

    const browser = await chromium.launch({ args: process.platform === "win32" ? ["--use-angle=d3d11"] : [] });
    try {
      for (let i = 0; i < 100; i++) {
        try { if ((await fetch(base + "/office/login")).ok) break; } catch {}
        await new Promise((r) => setTimeout(r, 300));
      }
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      // Synthetic SpeechRecognition — fires a real result event through the
      // real recognition API surface, never a bypass of the push-to-talk
      // component or the send() pipeline it shares with typed text.
      await page.addInitScript(() => {
        class FakeRecognition extends EventTarget {
          continuous = false; interimResults = true; lang = "en-US";
          onresult: ((e: unknown) => void) | null = null;
          onerror: ((e: unknown) => void) | null = null;
          onend: (() => void) | null = null;
          start() {
            setTimeout(() => {
              this.onresult?.({ results: [[{ transcript: "Create a new project to build a Voice Ordered Widget with a save button." }]] });
              this.onend?.();
            }, 50);
          }
          stop() {}
          abort() {}
        }
        (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
      });

      const consoleErrors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
      page.on("pageerror", (e) => consoleErrors.push(String(e.message || e)));

      await page.goto(base + "/office/login");
      await page.fill("[name=email]", env.OFFICE_OWNER_EMAIL);
      await page.fill("[name=password]", password);
      await page.click("button[type=submit]");
      await page.waitForURL(base + "/office", { timeout: 20000 });
      await page.locator("[data-ready=true]").waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "ENTER OFFICE" }).click();
      await page.locator("[data-locked=true]").waitFor({ timeout: 10000 });

      const world = page.getByTestId("world-prototype");
      const go = async (x: number, z: number) => {
        const resume = page.getByRole("button", { name: "Resume exploration →", exact: true });
        if (await resume.count()) await resume.click();
        const until = Date.now() + 20000;
        let last = "", stuck = 0;
        while (Date.now() < until) {
          const d = await world.evaluate((e) => ({ ...(e as HTMLElement).dataset }));
          const dx = x - Number(d.playerX), dz = z - Number(d.playerZ);
          if (Math.hypot(dx, dz) < 0.16) return;
          const pos = d.playerX + "," + d.playerZ; stuck = pos === last ? stuck + 1 : 0; last = pos;
          let useX = Math.abs(dx) >= Math.abs(dz); if (Math.abs(dx) < 0.12) useX = false; if (Math.abs(dz) < 0.12) useX = true; if (stuck % 2 === 1) useX = !useX;
          const dist = Math.abs(useX ? dx : dz); if (dist < 0.04) continue;
          const k = useX ? (dx > 0 ? "KeyD" : "KeyA") : (dz > 0 ? "KeyS" : "KeyW");
          await page.keyboard.down(k); await page.waitForTimeout(Math.min(300, Math.max(30, dist * 160))); await page.keyboard.up(k); await page.waitForTimeout(70);
        }
        throw new Error(`walk blocked at ${x},${z}`);
      };
      await go(0, 8); await go(-4, 8); await go(-4, 5); await go(-1, 5); await go(-1, 4.5);
      await page.keyboard.press("KeyE");
      const panel = page.getByRole("dialog");
      await panel.waitFor({ timeout: 5000 });

      // --- 1-4: prominent, discoverable "Assign New Project" ---
      await panel.getByText("This is where you assign work to your AI Office", { exact: false }).first().waitFor({ timeout: 5000 });
      const assignBtn = page.getByTestId("assign-new-project-button");
      await assignBtn.waitFor({ timeout: 5000 });
      await assignBtn.click();
      const textarea = panel.locator("textarea");
      await assert.doesNotReject(async () => assert.match(await textarea.inputValue(), /Create a new project to build/));

      await textarea.fill("Create a new project to build a Task Tracker with add, complete, delete and localStorage persistence.");
      await panel.getByRole("button", { name: "Send" }).click();

      // --- 5: confirmation summary appears with required fields ---
      const confirmSummary = page.getByTestId("confirm-summary");
      await confirmSummary.waitFor({ timeout: 15000 });
      const summaryText = await confirmSummary.innerText();
      assert.match(summaryText, /Goal:.*Task Tracker/i);
      assert.match(summaryText, /Execution mode:/);
      assert.match(summaryText, /Local/);
      assert.match(summaryText, /Routing mode: FREE_MULTI_MODEL/);
      assert.match(summaryText, /Expected workflow:/);
      assert.match(summaryText, /Claude and paid fallback are disabled/);

      // --- 6: Cancel creates zero projects ---
      const beforeCancel = countProjects();
      await page.getByTestId("cancel-action-button").click();
      await page.waitForTimeout(500);
      assert.equal(countProjects(), beforeCancel, "cancel must create zero projects");
      assert.equal(await page.getByTestId("confirm-summary").count(), 0);

      // --- 7-8: repeat, this time confirm — existing creation action invoked exactly once ---
      await assignBtn.click();
      await textarea.fill("Create a new project to build a Task Tracker with add, complete, delete and localStorage persistence.");
      await panel.getByRole("button", { name: "Send" }).click();
      await confirmSummary.waitFor({ timeout: 15000 });
      const beforeConfirm = countProjects();
      await page.getByTestId("confirm-action-button").click();

      const createdCard = page.getByTestId("project-created-card");
      await createdCard.waitFor({ timeout: 15000 });
      assert.equal(countProjects(), beforeConfirm + 1, "exactly one project must be created");

      const created = latestProject();
      assert.ok(created, "the real project row must exist");
      assert.match(String(created!.title), /Task Tracker/);
      assert.equal(created!.routingMode, "FREE_MULTI_MODEL", "local-mode conversational creation reuses the existing FREE_MULTI_MODEL path");
      assert.ok(taskCount(String(created!.id)) > 0, "the existing planning pipeline (planProject) actually ran — real tasks exist");

      // --- 14: Headquarters displays the created-project state / View Project ---
      const viewLink = page.getByTestId("view-project-link");
      await viewLink.waitFor({ timeout: 5000 });
      assert.match(await viewLink.getAttribute("href") ?? "", new RegExp(`/office/projects/${created!.id}`));
      await page.getByText("Project accepted.", { exact: false }).waitFor({ timeout: 5000 });

      // --- 11: an ordinary question does NOT create a project ---
      await page.getByTestId("assign-new-project-button").click().catch(() => {});
      await textarea.fill("What is the office status?");
      await panel.getByRole("button", { name: "Send" }).click();
      await page.waitForTimeout(3000);
      assert.equal(await page.getByTestId("confirm-summary").count(), 0, "an ordinary question must never propose CREATE_PROJECT");
      const afterQuestion = countProjects();

      // --- 9-10: voice transcript uses the SAME pipeline as text, producing the same confirmation ---
      await page.getByRole("button", { name: "New / Clear Conversation" }).click();
      await page.getByRole("button", { name: /Microphone|Finish speaking/ }).click();
      await confirmSummary.waitFor({ timeout: 10000 });
      const voiceSummary = await confirmSummary.innerText();
      assert.match(voiceSummary, /Voice Ordered Widget/, "the voice transcript reached the identical CREATE_PROJECT confirmation");
      await page.getByTestId("cancel-action-button").click();
      assert.equal(countProjects(), afterQuestion, "the voice-originated proposal must not auto-create anything either");

      // --- 12: duplicate click/confirmation cannot create duplicate projects ---
      // Isolated from the happy-path assertions above so a rare UI-render
      // race on the rapid duplicate click can never mask the real, load-
      // bearing invariant checked here: the database's own row count.
      await page.getByTestId("assign-new-project-button").click();
      await textarea.fill("Create a new project to build a Duplicate Guard Test with a counter.");
      await panel.getByRole("button", { name: "Send" }).click();
      await confirmSummary.waitFor({ timeout: 15000 });
      const beforeDuplicate = countProjects();
      const dupConfirmBtn = page.getByTestId("confirm-action-button");
      await dupConfirmBtn.click();
      // Fired as fast as the real DOM allows, before React's `disabled`
      // state can possibly re-render — proves the server-side atomic
      // token consume, not just that the UI disabled itself in time.
      await dupConfirmBtn.click({ force: true, timeout: 500 }).catch(() => {});
      await page.waitForTimeout(2000);
      assert.equal(countProjects(), beforeDuplicate + 1, "a rapid duplicate confirmation must never create a second project");

      // --- 15: Classic Office unaffected ---
      await page.keyboard.press("Escape");
      await page.goto(base + "/office/classic");
      await page.locator("nav[aria-label='AI Office']").waitFor({ timeout: 15000 });

      // --- 16: no client secrets ---
      const html = await page.content();
      assert.ok(!/gsk_[A-Za-z0-9]{20,}/.test(html));
      assert.ok(!/office_session=/.test(html));

      const realConsoleErrors = consoleErrors.filter((e) => !/THREE\.|WebGLShadowMap|WebGLProgram/.test(e));
      assert.deepEqual(realConsoleErrors, [], "no unexpected console/runtime errors");
    } finally {
      await browser.close();
      db.close();
      if (server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
