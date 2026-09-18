import { runMigrations } from "../db/migrate.ts";
import { seedAll } from "../db/seed.ts";
import { createApproval } from "../domain/project-outputs.ts";
import { openDatabase } from "../db/client.ts";
import { createProjectWithIdea } from "../domain/projects.ts";
import { getOwner } from "../domain/users.ts";
import { listAgentRoles } from "../domain/agent-roles.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt } from "../domain/tasks.ts";
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
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

/** Persisted, isolated visual fixtures against a local production build.
 * All provider credentials are blank; the suite never executes a task.
 * Original navigation tests independently cover the rest of the office. */

const PORT = Number(process.env.AI_OFFICE_E2E_PORT) || 3913;
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
    AI_OFFICE_CLAUDE_ENABLED: "false", ANTHROPIC_API_KEY: "", GROQ_API_KEY: "", OPENROUTER_API_KEY: "", GEMINI_API_KEY: "",
    AI_OFFICE_DB_PATH: join(dbDir, "office.db"),
    // A distinct build output directory, *inside* the project root (Next
    // requires this — an absolute/external path is rejected), is what
    // actually lets this run alongside an already-running interactive
    // `next dev` in the same directory without colliding with it.
    AI_OFFICE_E2E_DIST_DIR: ".next-e2e-living",
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
  const build = process.env.AI_OFFICE_VISUAL_SKIP_BUILD === "true" ? {status:0} : spawnSync(process.execPath, [nextBin, "build"], { cwd: process.cwd(), env: sharedEnv, stdio: "ignore" });
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
  mkdirSync(".data/living-office-v2/screenshots", { recursive: true });
  await seedVisualFixture();
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
  if (dbDir) {
    const target = resolve(dbDir);
    assert.ok(dirname(target) === resolve(tmpdir()) && basename(target).startsWith("ai-office-e2e-db-"));
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

let fixtureId: string;
async function seedVisualFixture() {
  // Login page initializes the isolated test DB. These rows never touch a real office.
  const db = openDatabase(join(dbDir, "office.db"));
  runMigrations(db);
  process.env.OFFICE_OWNER_EMAIL=TEST_EMAIL;
  process.env.OFFICE_OWNER_PASSWORD_HASH=hashOwnerPassword(TEST_PASSWORD);
  seedAll(db);
  fixtureId = createProjectWithIdea(db, { title: "VISUAL TEST ONLY — Studio", ownerId: getOwner(db)!.id, rawIdeaText: "Deterministic visual fixture, no execution", routingMode: "FREE_MULTI_MODEL" }).project.id;
  db.prepare("UPDATE projects SET status = 'IN_PROGRESS' WHERE id = ?").run(fixtureId);
  for (const role of listAgentRoles(db).filter(r => r.id !== "orchestrator")) {
    const task = createTask(db, { projectId: fixtureId, roleId: role.id, title: `Fixture: ${role.name} task` });
    const attempt = createTaskAttempt(db, task.id);
    createAgentRunForAttempt(db, { taskAttemptId: attempt.id, roleId: role.id, provider: role.id === "frontend-developer" ? "openrouter" : "groq", model: role.id === "frontend-developer" ? "nex-agi/nex-n2.5-mini:free" : "openai/gpt-oss-20b" });
  }
  db.prepare("UPDATE tasks SET status='DONE', updatedAt=? WHERE projectId=?").run(Date.now()-60000,fixtureId);
  db.close();
}
function setScene(mixed: boolean) {
  const db = openDatabase(join(dbDir, "office.db"));
  const states: Record<string,string> = { "product-owner":"IN_PROGRESS", "solution-architect":"IN_PROGRESS", "frontend-developer":"IN_PROGRESS", "qa-agent":"IN_PROGRESS", "security-reviewer":"IN_PROGRESS", "backend-developer":"BLOCKED", "ui-ux-agent":"IN_PROGRESS", "release-agent":"DONE", "research-agent":"PENDING", "code-reviewer":"FAILED" };
  for (const [roleId,status] of Object.entries(states)) db.prepare("UPDATE tasks SET status=?, attemptCount=?, updatedAt=? WHERE projectId=? AND roleId=?").run(mixed ? status : "DONE", roleId === "ui-ux-agent" ? 2 : 1, mixed ? Date.now() : Date.now()-60000, fixtureId, roleId);
  db.close();
}
async function login(page: import('playwright').Page) {
  await page.goto(`${BASE}/office/login`);
  await page.fill('input[name="email"]', TEST_EMAIL);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/office`, {timeout:15000});
  await page.goto(`${BASE}/office?project=${fixtureId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("living-office").waitFor({state:"attached"});
}

describe("Living Office 2.0 — persisted fixtures, zero inference", () => {
  test("idle and mixed states, exact run models, all workspaces, keyboard, responsive and motion", async () => {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const errors:string[]=[];
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    try {
    await login(page);
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId("living-office").evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==="running").length),0);
    await page.emulateMedia({reducedMotion:"no-preference"});
    assert.equal(await page.locator('[data-agent]').count(),11);
    assert.equal(await page.locator('[data-agent][data-state="IDLE"]').count(),11);
    await page.screenshot({path:'.data/living-office-v2/screenshots/idle.png',fullPage:true});
    setScene(true);
    await page.reload({waitUntil:"domcontentloaded"});
    const expected:Record<string,string>={"product-owner":"THINKING","solution-architect":"WORKING","frontend-developer":"WORKING","qa-agent":"TESTING","security-reviewer":"REVIEWING","backend-developer":"BLOCKED","ui-ux-agent":"RETRYING","release-agent":"DONE","code-reviewer":"FAILED"};
    for(const [role,state] of Object.entries(expected)) assert.equal(await page.getByTestId(`station-${role}`).getAttribute('data-state'),state);
    assert.match(await page.getByTestId('station-frontend-developer').innerText(),/openrouter/);
    assert.match(await page.getByTestId('station-solution-architect').innerText(),/groq/);
    await page.getByTestId('station-ui-ux-agent').locator('button').hover();
    assert.match(await page.getByTestId('office-inspector').innerText(),/Attempt 2\/3/);
    for(const [name,width,height] of [['desktop',1920,1080],['laptop',1440,900],['compact',1366,768],['tablet',820,1180],['mobile',390,844]] as const) {
      await page.setViewportSize({width,height});
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.waitForFunction(()=>Array.from(document.images).filter(img=>img.src.includes("living-office")).every(img=>img.complete && img.naturalWidth>0));
      await page.screenshot({path:`.data/living-office-v2/screenshots/${name}.png`,fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal page overflow');
      if(width>=1024) {
        for(const role of Object.keys(expected)) assert.ok(await page.getByTestId(`station-${role}`).locator('button').isVisible());
      } else {
        assert.match(await page.getByTestId('mobile-office-summary').last().innerText(),/6 active/);
        await page.locator('[data-mobile-agent="frontend-developer"]').last().locator('button').click();
        await page.waitForURL(/agent=frontend-developer/, {waitUntil:"domcontentloaded"});
        await page.getByRole('button',{name:/Close.*workspace/i}).click();
      }
    }
    await page.setViewportSize({width:1440,height:900});
    for(const role of Object.keys(WORKSTATIONS_FOR_TEST)) {
      const button=page.getByTestId(`station-${role}`).locator('button');
      await button.focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(new RegExp(`agent=${role}`), {waitUntil:"domcontentloaded"});
      assert.equal(await button.getAttribute('aria-pressed'),'true');
      await page.getByRole('button',{name:/Close.*workspace/i}).click();
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForTimeout(100);
    const animations=await page.getByTestId('living-office').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==="running").length);
    assert.equal(animations,0);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.getByRole('button',{name:'Pause office motion'}).click();
    assert.equal(await page.getByTestId('living-office').getAttribute('data-motion-paused'),'true');
    await page.getByRole('button',{name:'Resume office motion'}).click();
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>document.querySelector('[data-testid="living-office"]')?.getAttribute('data-motion-paused')==='true');
    await page.evaluate(()=>{delete (document as unknown as Record<string,unknown>).visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>document.querySelector('[data-testid="living-office"]')?.getAttribute('data-motion-paused')==='false');
    const retryDb=openDatabase(join(dbDir,'office.db'));
    retryDb.prepare("UPDATE tasks SET attemptCount=2 WHERE projectId=? AND roleId='frontend-developer'").run(fixtureId);
    retryDb.close();
    await page.reload({waitUntil:'domcontentloaded'});
    assert.equal(await page.getByTestId('station-frontend-developer').getAttribute('data-state'),'RETRYING');
    await page.getByTestId('station-frontend-developer').locator('button').hover();
    assert.match(await page.getByTestId('office-inspector').innerText(),/Attempt 2\/3/);
    await page.screenshot({path:'.data/living-office-v2/screenshots/developer-retrying.png',fullPage:true});
    const approvalsDb=openDatabase(join(dbDir,"office.db"));
    createApproval(approvalsDb,{projectId:fixtureId,kind:"major_architecture_replacement",requestedBy:"orchestrator",context:{visualFixture:true}});
    approvalsDb.close();
    await page.reload({waitUntil:"domcontentloaded"});
    assert.equal(await page.getByTestId("station-orchestrator").getAttribute("data-state"),"WAITING");
    await page.screenshot({path:".data/living-office-v2/screenshots/owner-waiting.png",fullPage:true});
    assert.deepEqual(errors,[]);
    } finally { await page.close(); }
  });
  test("background DB transitions refresh without browser execution; completion settles", async () => {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    try {
    setScene(true); await login(page);
    const db=openDatabase(join(dbDir,'office.db'));
    db.prepare("UPDATE tasks SET status='DONE',updatedAt=? WHERE projectId=? AND roleId='frontend-developer'").run(Date.now(),fixtureId);
    await page.waitForFunction(()=>document.querySelector('[data-agent="frontend-developer"]')?.getAttribute('data-state')==='DONE',{},{timeout:12000});
    await page.waitForFunction(()=>document.querySelector('[data-agent="frontend-developer"]')?.getAttribute('data-state')==='IDLE',{},{timeout:22000});
    db.close();
    const measure = () => page.evaluate(async()=>{const times:number[]=[];await new Promise<void>(resolve=>{const start=performance.now();let prev=start;function frame(now:number){times.push(now-prev);prev=now;if(now-start>2000)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);});times.sort((a,b)=>a-b);return {frameP95Ms:times[Math.floor(times.length*.95)],elements:document.querySelectorAll('*').length};});
    const active = await measure();
    await page.getByRole('button',{name:'Pause office motion'}).click();
    const paused = await measure();
    writeFileSync('.data/living-office-v2/browser-performance.json',JSON.stringify({active,paused},null,2));
    assert.ok(active.frameP95Ms < Math.max(50,paused.frameP95Ms*1.5),'animation overhead stays within the same-browser frame budget');
    } finally { await page.close(); }
  });
});
const WORKSTATIONS_FOR_TEST={orchestrator:1,'product-owner':1,'research-agent':1,'solution-architect':1,'ui-ux-agent':1,'frontend-developer':1,'backend-developer':1,'qa-agent':1,'security-reviewer':1,'code-reviewer':1,'release-agent':1};
