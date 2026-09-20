import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { chromium } from "playwright";
/** No runner, project fixtures, model credentials or domain mutations. Browser input only. */
test(
  "3D prototype: authenticated exploration, collisions, demo, interaction and cleanup",
  { timeout: 360000 },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "office-world-test-")),
      evidence = resolve(".data/world-modern-v2");
    mkdirSync(evidence, { recursive: true });
    const password = randomBytes(18).toString("hex"),
      salt = randomBytes(16).toString("hex"),
      port = 3915,
      base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      AI_OFFICE_E2E_DIST_DIR: ".next-e2e-world",
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
    if (process.env.AI_OFFICE_WORLD_SKIP_BUILD !== "true")
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
      await page.goto(base + "/office/world-prototype");
      assert.match(page.url(), /office\/login/);
      await page.fill("[name=email]", env.OFFICE_OWNER_EMAIL);
      await page.fill("[name=password]", password);
      await page.click("button[type=submit]");
      await page.waitForURL(base + "/office");
      await page
        .getByRole("link", { name: "3D Prototype", exact: true })
        .click();
      const root = page.getByTestId("world-prototype");
      const worldStart = Date.now();
      await page.locator("[data-ready=true]").waitFor({ timeout: 45000 });
      const readyMs = Date.now() - worldStart;
      const state = async () => root.evaluate((e) => e.dataset);
      const shot = async (name: string) => {
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(evidence, name + ".png") });
        console.log("World evidence:", name);
      };
      const key = async (k: string, ms: number) => {
        await page.keyboard.down(k);
        await page.waitForTimeout(ms);
        await page.keyboard.up(k);
        await page.waitForTimeout(160);
      };
      async function look(yaw = 0, pitch = 0) {
        for (const [field, target, positive, negative] of [
          ["yaw", yaw, "ArrowLeft", "ArrowRight"],
          ["pitch", pitch, "ArrowUp", "ArrowDown"],
        ] as const) {
          for (let i = 0; i < 20; i++) {
            const s = await state(),
              d = target - Number(s[field]);
            if (Math.abs(d) < 0.025) break;
            await key(
              d > 0 ? positive : negative,
              Math.min(600, Math.max(18, Math.abs(d) * 960)),
            );
          }
        }
      }
      async function go(x: number, z: number) {
        await look();
        const until = Date.now() + 22000;
        while (Date.now() < until) {
          const s = await state(),
            dx = x - Number(s.playerX),
            dz = z - Number(s.playerZ);
          if (Math.hypot(dx, dz) < 0.42) return;
          const k =
            Math.abs(dx) > 0.18
              ? dx > 0
                ? "KeyD"
                : "KeyA"
              : dz > 0
                ? "KeyS"
                : "KeyW";
          await key(
            k,
            Math.min(
              380,
              Math.max(
                40,
                ((Math.abs(dx) > 0.18 ? Math.abs(dx) : Math.abs(dz)) / 2.6) *
                  650,
              ),
            ),
          );
        }
        assert.fail(
          "Path blocked: " + x + "," + z + " " + JSON.stringify(await state()),
        );
      }
      await shot("01-reception");
      await page.getByRole("button", { name: "ENTER OFFICE" }).click();
      await page.waitForTimeout(400);
      await page.locator("[data-locked=true]").waitFor();
      assert.equal((await state()).locked, "true");
      const yaw = Number((await state()).yaw);
      await page.mouse.move(800, 480);
      await page.waitForTimeout(300);
      assert.notEqual(Number((await state()).yaw), yaw, "real mouse look");
      await look();
      await go(0, 8);
      await shot("10-headquarters-overview");
      await go(-5, 5);
      await look(-0.75, -0.04);
      await shot("02-command-atrium");
      await go(-10, 5.7);
      await look(1.2, -0.18);
      await shot("03-product-owner");
      await page.keyboard.press("KeyE");
      await page.getByRole("dialog", { name: "Prototype agent" }).waitFor();
      assert.match(await page.getByRole("dialog").innerText(), /Product Owner/);
      await shot("interaction");
      await page.getByRole("button", { name: "Close & resume" }).click();
      await go(-10, 5.5);
      await look();
      await key("KeyS", 1800);
      assert.ok(Number((await state()).playerZ) < 6.1, "desk collision");
      await go(-5, 5);
      await go(-5, -3);
      await go(-10, -3);
      await look(0.5, -0.08);
      await shot("04-architecture-area");
      await go(-5, -3);
      await go(-5, -9);
      await go(0, -9);
      await go(0, -13);
      await shot("06-owner-room");
      await go(0, -9);
      await go(5, -9);
      await go(5, -3);
      await go(11.5, -3);
      await shot("07-server-area");
      await go(11.5, -10);
      await go(12, -12.5);
      await look(-0.15, -0.08);
      await shot("08-delivery-vault");
      await go(11.5, -10);
      await go(11.5, -3);
      await go(5, -3);
      await go(5, 5);
      await go(10, 5.5);
      await look(-1.3, -0.15);
      await shot("05-engineering-area");
      await go(10, 3);
      await go(15, 3);
      await go(15, 5);
      await look();
      await key("KeyD", 1800);
      assert.ok(Number((await state()).playerX) < 16.6, "outer wall collision");
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Reset position", exact: true })
        .click();
      await page.waitForTimeout(400);
      assert.ok(Math.abs(Number((await state()).playerX)) < 0.01);
      assert.equal(Number((await state()).playerZ), 15);
      await go(-5, 5);
      await go(-5, -3);
      await go(-10, -1.7);
      await look(0.65, -0.12);
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Play office demo", exact: true })
        .click();
      const stages = new Set<string>();
      const fps: number[] = [];
      let first = false,
        second = false;
      const until = Date.now() + 85000;
      while (Date.now() < until) {
        const s = await state(),
          t = Number(s.demoTime);
        stages.add(await page.locator("footer strong").innerText());
        fps.push(
          Number(
            (await page.getByTestId("world-performance").innerText()).split(
              " ",
            )[0],
          ),
        );
        if (t >= 15.3 && !first) {
          await shot("09a-po-architect-handoff");
          first = true;
          await go(-5, -3);
          await go(-5, 5);
          await go(5, 3.5);
          await look(-2.4, -0.15);
        }
        if (t >= 38.4 && !second) {
          await shot("09b-architect-developer-handoff");
          second = true;
        }
        if (t >= 59.9) break;
        await page.waitForTimeout(150);
      }
      assert.ok(first && second);
      assert.ok(Number((await state()).demoTime) >= 59.9, "complete demo");
      await page.keyboard.press("Escape");
      await page.locator("[data-locked=false]").waitFor();
      assert.equal((await state()).locked, "false");
      assert.equal(
        await page.getByLabel("Render quality").inputValue(),
        "auto",
      );
      for (const quality of ["balanced", "high", "auto"]) {
        await page.getByLabel("Render quality").selectOption(quality);
        assert.equal(
          await page.getByLabel("Render quality").inputValue(),
          quality,
        );
      }
      await page
        .getByRole("button", { name: "Resume exploration", exact: false })
        .click();
      await page.locator("[data-locked=true]").waitFor();
      assert.equal((await state()).locked, "true");
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForTimeout(400);
      await shot("resize");
      assert.equal(
        await page
          .locator("canvas")
          .evaluate((e) => e.getBoundingClientRect().width),
        1024,
      );
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "Exit 3D Office" }).click();
      await page.waitForURL(base + "/office");
      assert.equal(await page.locator("canvas").count(), 0);
      assert.equal(
        await page.evaluate(() => document.pointerLockElement === null),
        true,
      );
      await page
        .getByRole("link", { name: "3D Prototype", exact: true })
        .click();
      await page.locator("[data-ready=true]").waitFor();
      assert.equal(
        (await state()).demoTime,
        "idle",
        "unmount resets visual-only state",
      );
      const mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await mobile.addCookies(await page.context().cookies());
      const phone = await mobile.newPage();
      await phone.goto(base + "/office/world-prototype");
      await phone
        .getByText("A world best explored on desktop.", { exact: true })
        .waitFor();
      assert.equal(
        await phone.locator("canvas").count(),
        0,
        "mobile avoids unsupported WASD canvas",
      );
      await phone.screenshot({ path: join(evidence, "mobile-fallback.png") });
      await mobile.close();
      const unsupported = await chromium.launch({ args: ["--disable-webgl"] });
      try {
        const fallback = await unsupported.newPage();
        await fallback.context().addCookies(await page.context().cookies());
        await fallback.goto(base + "/office/world-prototype");
        await fallback
          .getByRole("heading", { name: "3D view unavailable", exact: true })
          .waitFor();
        assert.equal(await fallback.locator("canvas").count(), 0);
        await fallback
          .getByRole("link", { name: "Return to Office", exact: true })
          .waitFor();
        await fallback.screenshot({
          path: join(evidence, "webgl-fallback.png"),
        });
      } finally {
        await unsupported.close();
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(external, [], "no external requests or model calls");
      fps.sort((a, b) => a - b);
      writeFileSync(
        join(evidence, "browser-report.json"),
        JSON.stringify(
          {
            readyMs,
            errors,
            externalRequests: external,
            stages: [...stages],
            demoComplete: true,
            fpsMedian: fps[Math.floor(fps.length / 2)],
            fpsP10: fps[Math.floor(fps.length * 0.1)],
            samples: fps.length,
            renderer: await page.locator("canvas").evaluate((c) => {
              const gl = (c as HTMLCanvasElement).getContext("webgl2");
              if (!gl) return "unavailable";
              const e = gl.getExtension("WEBGL_debug_renderer_info");
              return e
                ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER);
            }),
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.close();
      if (server.pid) {
        if (process.platform === "win32")
          spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
        else server.kill();
      }
      const target = resolve(folder);
      assert.equal(dirname(target), resolve(tmpdir()));
      assert.ok(basename(target).startsWith("office-world-test-"));
      rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 300,
      });
    }
  },
);
