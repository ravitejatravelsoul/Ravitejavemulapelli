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
import { createIncident, updateIncident } from "../domain/office-incidents.ts";
import { setDeliveryState } from "../domain/workspace.ts";
import { recordEvent } from "../domain/events.ts";
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
      await page.getByRole("button", { name: "Close & resume" }).click();
      await page.locator("[data-locked=true]").waitFor();
      const beforeWatch = await root.evaluate((e) => ({
        x: e.dataset.playerX,
        z: e.dataset.playerZ,
        yaw: e.dataset.yaw,
      }));
      await page.keyboard.press("KeyV");
      await page.locator("[data-cinematic=true]").waitFor();
      await page
        .getByTestId("handoff-cue")
        .locator('xpath=self::*[@data-phase="TRANSFER"]')
        .waitFor({ timeout: 45000 });
      await page.screenshot({ path: join(evidence, "handoff-transfer.png") });
      await page.keyboard.press("Escape");
      await page.locator("[data-cinematic=false]").waitFor();
      await page.waitForTimeout(500);
      assert.deepEqual(
        await root.evaluate((e) => ({
          x: e.dataset.playerX,
          z: e.dataset.playerZ,
          yaw: e.dataset.yaw,
        })),
        beforeWatch,
        "Watch restores exact Boss pose",
      );
      await page
        .getByTestId("handoff-cue")
        .waitFor({ state: "detached", timeout: 45000 });
      await page
        .getByRole("button", { name: "Resume exploration →", exact: true })
        .click();
      const key = async (k: string, ms: number) => {
        await page.keyboard.down(k);
        await page.waitForTimeout(ms);
        await page.keyboard.up(k);
        await page.waitForTimeout(120);
      };
      const go = async (x: number, z: number) => {
        const until = Date.now() + 20000;
        while (Date.now() < until) {
          const d = await root.evaluate((e) => e.dataset),
            dx = x - Number(d.playerX),
            dz = z - Number(d.playerZ);
          if (Math.hypot(dx, dz) < 0.12) return;
          await key(
            Math.abs(dx) > 0.08
              ? dx > 0
                ? "KeyD"
                : "KeyA"
              : dz > 0
                ? "KeyS"
                : "KeyW",
            Math.min(
              350,
              Math.max(
                35,
                (Math.abs(dx) > 0.08 ? Math.abs(dx) : Math.abs(dz)) * 250,
              ),
            ),
          );
        }
        await page.screenshot({ path: join(evidence, "walk-blocked.png") });
        throw Error(
          "Walk blocked " +
            x +
            "," +
            z +
            " " +
            JSON.stringify(await root.evaluate((e) => e.dataset)),
        );
      };
      await go(0, 8);
      await go(-5, 8);
      await go(-5, -3);
      await go(-15.2, -3);
      await go(-15.2, -10);
      await go(-12, -10);
      await go(-12, -11);
      const caption = page.getByTestId("proximity-briefing");
      await caption.waitFor();
      assert.match(await caption.innerText(), /testing: Test actual frontend/);
      await page.screenshot({ path: join(evidence, "qa-proximity.png") });
      await page.keyboard.press("KeyE");
      assert.match(
        await page.getByTestId("agent-briefing").innerText(),
        /testing/i,
      );
      await page.getByRole("button", { name: "Close & resume" }).click();
      await go(-12, -10);
      await page.waitForTimeout(500);
      await go(-12, -11);
      assert.equal(
        await caption.count(),
        0,
        "same state does not greet again after a brief departure",
      );
      await go(-12, -10);
      await go(-15.2, -10);
      await go(-15.2, -3);
      await go(-5, -3);
      await go(-5, 5);
      await go(0, 5);
      await go(0, 8);
      await page.keyboard.press("Escape");
      const retryAttempt = createTaskAttempt(db, task.id);
      const retryRun = createAgentRunForAttempt(db, {
        taskAttemptId: retryAttempt.id,
        roleId: task.roleId,
        provider: "groq",
        model: "fixture-model",
      });
      updateAgentRunStatus(db, retryRun.id, "RUNNING");
      updateTaskStatus(db, task.id, "IN_PROGRESS");
      for (const role of ["qa-agent", "security-reviewer", "code-reviewer"]) {
        const source =
          role === "qa-agent"
            ? nextTask
            : createTask(db, {
                projectId: project.id,
                roleId: role,
                title: "Review fixture",
              });
        updateTaskStatus(db, source.id, "FAILED");
        recordEvent(db, {
          projectId: project.id,
          type: "agent_run.failed",
          actor: role,
          payload: {
            taskId: source.id,
            remediationTargetTaskIds: [task.id],
            attemptNumber: 1,
          },
        });
        const cue = page.getByTestId("handoff-cue");
        await cue
          .locator(
            'xpath=self::*[starts-with(@data-transition,"remediation:")]',
          )
          .waitFor({ timeout: 60000 });
        await page.getByRole("button", { name: "Watch", exact: true }).click();
        await cue
          .locator('xpath=self::*[@data-phase="TRANSFER"]')
          .waitFor({ timeout: 45000 });
        await page.screenshot({
          path: join(evidence, "remediation-" + role + ".png"),
        });
        await cue.waitFor({ state: "detached", timeout: 45000 });
      }

      const incident = createIncident(db, {
        projectId: project.id,
        symptom: "runner-offline",
        status: "REPAIRING",
        diagnosis: "PRIVATE_REPAIR_DETAIL",
      });
      await page
        .getByRole("button", { name: "Resume exploration →", exact: true })
        .click();
      await go(0, 8);
      await go(5, 8);
      await go(5, -3);
      await go(11.5, -3);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: join(evidence, "engineer-repairing.png") });
      updateIncident(db, incident.id, { status: "ESCALATED" });
      await page.waitForTimeout(1800);
      await page.screenshot({
        path: join(evidence, "engineer-owner-required.png"),
      });
      updateIncident(db, incident.id, {
        status: "RESOLVED",
        resolvedAt: Date.now(),
      });
      await page.waitForTimeout(1800);
      await menu("Owner Command");

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
      // Representative remote state: browser consumes snapshots at 10s, without a runner.
      let remotePolls = 0;
      await page.route("**/office/headquarters-state*", (r) => {
        remotePolls++;
        return r.fulfill({
          json: {
            ...check.dto,
            mode: "remote",
            revision: "remote-fixture",
            observedAt: Date.now(),
          },
        });
      });
      await page.reload();
      await page.locator("[data-ready=true]").waitFor({ timeout: 45000 });
      const remoteInitial = remotePolls;
      await page.waitForTimeout(6500);
      assert.equal(
        remotePolls,
        remoteInitial,
        "remote snapshots do not use local polling cadence",
      );
      await page.waitForTimeout(4500);
      assert.equal(
        remotePolls,
        remoteInitial + 1,
        "remote consumes one snapshot per 10s",
      );
      await page.unroute("**/office/headquarters-state*");
      await page.reload();
      await page.locator("[data-ready=true]").waitFor({ timeout: 45000 });
      await page.getByRole("button", { name: "ENTER OFFICE" }).click();
      await page.keyboard.press("Escape");
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
      // Delivery fixture validates the animation only; it is not live-project evidence.
      await page
        .getByRole("button", { name: "Open Office", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Close Office", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Close & resume" }).click();
      const release = createTask(db, {
        projectId: project.id,
        roleId: "release-agent",
        title: "Release fixture",
      });
      const releaseAttempt = createTaskAttempt(db, release.id),
        releaseRun = createAgentRunForAttempt(db, {
          taskAttemptId: releaseAttempt.id,
          roleId: release.roleId,
          provider: "groq",
          model: "fixture-model",
        });
      updateAgentRunStatus(db, releaseRun.id, "SUCCEEDED", Date.now());
      db.prepare("UPDATE tasks SET status='DONE' WHERE projectId=?").run(
        project.id,
      );
      updateProjectStatus(db, project.id, "READY_FOR_REVIEW");
      setDeliveryState(db, project.id, "VERIFIED");
      const deliveryCue = page.getByTestId("handoff-cue");
      await deliveryCue
        .locator('xpath=self::*[starts-with(@data-transition,"delivery:")]')
        .waitFor({ timeout: 15000 });
      await page.keyboard.press("KeyV");
      await deliveryCue
        .locator('xpath=self::*[@data-phase="TRANSFER"]')
        .waitFor({ timeout: 20000 });
      await page.screenshot({
        path: join(evidence, "verified-delivery-transfer.png"),
      });
      await deliveryCue.waitFor({ state: "detached", timeout: 20000 });
      await page.screenshot({
        path: join(evidence, "verified-delivery-complete.png"),
      });
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
