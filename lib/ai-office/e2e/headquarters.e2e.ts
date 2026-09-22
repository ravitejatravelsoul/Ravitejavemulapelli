import { openDatabase } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAll } from "../db/seed.ts";
import { getOwner } from "../domain/users.ts";
import {
  createProjectWithIdea,
  updateProjectStatus,
  getProject,
} from "../domain/projects.ts";
import {
  createTask,
  updateTaskStatus,
  createTaskAttempt,
  createAgentRunForAttempt,
  updateAgentRunStatus,
  addTaskDependency,
} from "../domain/tasks.ts";
import { createApproval, getApproval } from "../domain/project-outputs.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { chromium } from "playwright";
/** Isolated deterministic data; no runner or model credentials. Existing authorized actions only. */
test(
  "3D headquarters: safe projection, owner actions, live reconciliation and fallback",
  { timeout: 600000 },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "office-world-test-")),
      evidence = resolve(".data/headquarters-e2e");
    mkdirSync(evidence, { recursive: true });
    const password = randomBytes(18).toString("hex"),
      salt = randomBytes(16).toString("hex"),
      port = 3917,
      base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      AI_OFFICE_E2E_DIST_DIR: ".next-e2e-hq",
      AI_OFFICE_DB_PATH: join(folder, "office.db"),
      AI_OFFICE_EXECUTION_MODE: "local",
      AI_OFFICE_OPERATIONAL_MODE: "enabled",
      AI_OFFICE_CLAUDE_ENABLED: "false",
      ANTHROPIC_API_KEY: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "",
      GEMINI_API_KEY: "",
      OFFICE_OWNER_EMAIL: "world-test@example.test",
      OFFICE_OWNER_PASSWORD_HASH:
        salt + ":" + scryptSync(password, salt, 64).toString("hex"),
      OFFICE_SESSION_SECRET: randomBytes(32).toString("hex"),
    };
    const next = resolve("node_modules/next/dist/bin/next");
    if (process.env.AI_OFFICE_HQ_SKIP_BUILD !== "true")
      assert.equal(
        spawnSync(process.execPath, [next, "build"], { env, stdio: "ignore" })
          .status,
        0,
        "production build",
      );
    const server = spawn(
      process.execPath,
      [next, "start", "--hostname", "127.0.0.1", "--port", String(port)],
      { env, stdio: "ignore" },
    );
    Object.assign(process.env, {
      OFFICE_OWNER_EMAIL: env.OFFICE_OWNER_EMAIL,
      OFFICE_OWNER_PASSWORD_HASH: env.OFFICE_OWNER_PASSWORD_HASH,
    });
    const db = openDatabase(env.AI_OFFICE_DB_PATH);
    runMigrations(db);
    seedAll(db);
    const { project } = createProjectWithIdea(db, {
      title: "Headquarters fixture",
      rawIdeaText: "Private fixture prompt",
      ownerId: getOwner(db)!.id,
    });
    const task = createTask(db, {
      projectId: project.id,
      roleId: "frontend-developer",
      title: "Actual frontend task",
    });
    updateProjectStatus(db, project.id, "IN_PROGRESS");
    const browser = await chromium.launch({
      args: process.platform === "win32" ? ["--use-angle=d3d11"] : [],
    });
    try {
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + "/office/login")).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 300));
      }
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const errors: string[] = [],
        external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (u.protocol.startsWith("http") && u.hostname !== "127.0.0.1") {
          external.push(u.hostname);
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(base + "/office/headquarters");
      assert.match(page.url(), /office\/login/);
      await page.fill("[name=email]", env.OFFICE_OWNER_EMAIL);
      await page.fill("[name=password]", password);
      await page.click("button[type=submit]");
      await page.waitForURL(base + "/office");

      page.on("dialog", (d) => d.accept());
      await page.goto(base + "/office/headquarters?project=" + project.id);
      const root = page.getByTestId("world-prototype");
      await page.locator("[data-ready=true]").waitFor({ timeout: 45000 });
      await page.getByRole("button", { name: "ENTER OFFICE" }).click();
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      const menu = async (name: string) => {
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name, exact: true }).click();
      };
      await menu("Command Core");
      assert.match(
        await page.getByRole("dialog").innerText(),
        /Headquarters fixture/,
      );
      await page
        .getByRole("button", { name: "Pause project", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Resume project", exact: true })
        .waitFor();
      assert.equal(getProject(db, project.id)!.status, "PAUSED");
      await page
        .getByRole("button", { name: "Resume project", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Pause project", exact: true })
        .waitFor();
      const approvals = ["approve", "reject"].map(() =>
        createApproval(db, {
          projectId: project.id,
          kind: "budget_increase",
          requestedBy: "orchestrator",
          context: { reason: "Recorded owner request", estimatedCostUsd: 0.25 },
        }),
      );
      await menu("Owner Command");
      await page
        .getByText("Recorded owner request", { exact: true })
        .first()
        .waitFor();
      assert.match(await page.getByRole("dialog").innerText(), /0.2500/);
      await page
        .getByRole("button", { name: "Approve", exact: true })
        .first()
        .click();
      await page.waitForTimeout(1800);
      await page
        .getByRole("button", { name: "Reject", exact: true })
        .first()
        .click();
      await page.waitForTimeout(1800);
      assert.deepEqual(
        approvals.map((a) => getApproval(db, a.id)!.status).sort(),
        ["APPROVED", "REJECTED"],
      );
      const open = page.getByRole("button", {
        name: "Open Office",
        exact: true,
      });
      if (await open.count()) await open.click();
      await page
        .getByRole("button", { name: "Close Office", exact: true })
        .waitFor();
      // Newly persisted source completion + successor start: no execution initiated by UI.
      const nextTask = createTask(db, {
        projectId: project.id,
        roleId: "qa-agent",
        title: "Test actual frontend",
      });
      addTaskDependency(db, nextTask.id, task.id);
      const a = createTaskAttempt(db, task.id),
        r = createAgentRunForAttempt(db, {
          taskAttemptId: a.id,
          roleId: task.roleId,
          provider: "groq",
          model: "fixture-model",
        });
      updateAgentRunStatus(db, r.id, "SUCCEEDED", Date.now() - 10);
      updateTaskStatus(db, task.id, "DONE");
      const b = createTaskAttempt(db, nextTask.id),
        rr = createAgentRunForAttempt(db, {
          taskAttemptId: b.id,
          roleId: nextTask.roleId,
          provider: "groq",
          model: "fixture-model",
        });
      updateAgentRunStatus(db, rr.id, "RUNNING");
      updateTaskStatus(db, nextTask.id, "IN_PROGRESS");
      await root
        .locator("xpath=self::*[string-length(@data-transition)>0]")
        .waitFor({ timeout: 12000 });
      await page.screenshot({ path: join(evidence, "owner-command.png") });
      await page
        .getByRole("button", { name: "Close Office", exact: true })
        .click();
      await page.locator("[data-office-closed=true]").waitFor();
      await menu("Infrastructure");
      assert.match(await page.getByRole("dialog").innerText(), /HEALTHY/);
      await menu("Model Lab");
      assert.match(
        await page.getByRole("dialog").innerText(),
        /never probes a model/,
      );
      await menu("Delivery Vault");
      assert.match(
        await page.getByRole("dialog").innerText(),
        /No verified delivery/,
      );
      const check = await page.evaluate(async (id) => {
        const url = "/office/headquarters-state?project=" + id;
        const r = await fetch(url);
        const dto = await r.json();
        const next = await fetch(url, {
          headers: { "If-None-Match": r.headers.get("etag")! },
        });
        return { status: r.status, dto, next: next.status };
      }, project.id);
      assert.equal(check.status, 200);
      assert.ok(!JSON.stringify(check.dto).includes("Private fixture prompt"));
      assert.equal(check.next, 304);
      const unauth = await browser.newContext();
      const denied = await unauth.request.get(
        base + "/office/headquarters-state",
        { maxRedirects: 0 },
      );
      assert.ok([307, 401].includes(denied.status()));
      await unauth.close();
      let polls = 0;
      page.on("request", (r) => {
        if (r.url().includes("/office/headquarters-state")) polls++;
      });
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(600);
      const hiddenPolls = polls;
      await page.waitForTimeout(3500);
      assert.equal(polls, hiddenPolls, "hidden tabs stop polling");
      await page.evaluate(() => {
        Reflect.deleteProperty(document, "hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(1800);
      assert.ok(polls > hiddenPolls, "return synchronizes current truth");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("HeapProfiler.collectGarbage");
      const memoryBefore = await cdp.send("Runtime.getHeapUsage");
      await page.waitForTimeout(20000);
      await cdp.send("HeapProfiler.collectGarbage");
      const memoryAfter = await cdp.send("Runtime.getHeapUsage");
      await cdp.detach();
      writeFileSync(
        join(evidence, "memory.json"),
        JSON.stringify(
          {
            before: memoryBefore.usedSize,
            after: memoryAfter.usedSize,
            visiblePolls: polls - hiddenPolls,
          },
          null,
          2,
        ),
      );
      // A broken projection must expose stale state and disable consequential actions.
      await page.route("**/office/headquarters-state*", (r) =>
        r.fulfill({ status: 503, body: "unavailable" }),
      );
      await menu("Owner Command");
      await page
        .getByText("STALE — LAST OBSERVED STATE", { exact: true })
        .waitFor({ timeout: 12000 });
      assert.equal(
        await page
          .getByRole("button", { name: "Open Office", exact: true })
          .isDisabled(),
        true,
      );
      await page.unroute("**/office/headquarters-state*");
      const mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        storageState: await page.context().storageState(),
      });
      const mp = await mobile.newPage();
      await mp.goto(base + "/office/headquarters");
      await mp
        .getByRole("heading", { name: "A world best explored on desktop." })
        .waitFor();
      assert.ok(
        await mp
          .getByRole("link", { name: "Return to Office", exact: true })
          .isVisible(),
      );
      await mobile.close();
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      writeFileSync(
        join(evidence, "checks.json"),
        JSON.stringify(
          {
            approvals: true,
            pauseResume: true,
            handoff: true,
            closed: true,
            stale: true,
            security: true,
            conditional304: true,
            mobile: true,
            errors,
            external,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.close();
      db.close();
      if (server.pid)
        spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
      // Test folder is the verified temporary directory created by this suite.
      if (
        dirname(folder) === tmpdir() &&
        basename(folder).startsWith("office-world-test-")
      )
        rmSync(folder, { recursive: true, force: true });
    }
  },
);
