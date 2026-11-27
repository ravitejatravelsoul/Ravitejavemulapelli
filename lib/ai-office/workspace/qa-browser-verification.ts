import { compactFailureEvidence } from "../agents/failure-evidence.ts";
import "server-only";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { readFile, workspaceExists, getContentType, WorkspacePathError } from "./workspace-service.ts";

/**
 * Real, provider-independent browser QA for a project's actual generated
 * deliverable — replaces "QA passed" meaning only "a fixture returned PASS
 * text" with a genuine Playwright check against the real workspace files.
 *
 * The static file server here is deliberately short-lived and
 * request-scoped: bound to 127.0.0.1 on an ephemeral port, serving only
 * this one project's workspace, started and stopped within a single call
 * to `runQABrowserVerification()` (always in `finally`). This is a
 * separate design from the owner-facing preview Route Handler — there is
 * nothing here that can be left running between calls, so nothing to
 * orphan. Never bound to a non-loopback address; never reused across
 * calls.
 *
 * Real incident, Scenario B acceptance run (2026-11-27): a real
 * full-stack expense tracker's "Save" button correctly called a real
 * backend API — but this module always served the frontend from its own
 * isolated static server, with no backend attached at all, so that
 * `fetch()` could only ever fail (no listener on that path), and the
 * page's visible-text-changes-on-click check failed identically to a
 * genuinely broken button. `options.baseUrl`, when passed by
 * `runFullStackVerification` in backend-verification.ts, points this
 * check at a real, already-running backend process instead of starting
 * the isolated static server — so a full-stack deliverable's frontend
 * and backend are verified together, as one integrated application,
 * exactly the way a real user would experience it.
 */

export interface QABrowserVerificationResult {
  status: "PASS" | "FAIL";
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
  targetUrl: string;
}

function startEphemeralStaticServer(projectId: string): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void (async () => {
        try {
          const requestPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
          const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
          const content = await readFile(projectId, relativePath);
          res.writeHead(200, { "Content-Type": getContentType(relativePath) });
          res.end(content);
        } catch (error) {
          const status = error instanceof WorkspacePathError ? 400 : 404;
          res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(status === 400 ? "Invalid path." : "Not found.");
        }
      })();
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Hostnames the verification browser must never reach — every loopback,
 * RFC1918 private range, and link-local address (169.254.0.0/16 also
 * covers the cloud-metadata endpoint IP used by several cloud providers)
 * OTHER than this call's own ephemeral static server, which is allowed
 * through by its exact origin, checked separately. Generated code is
 * untrusted (Priority 0 security hardening): nothing it runs in this
 * headless browser may probe the host's internal network or any other
 * local service. Deliberately does NOT restrict public internet hosts —
 * workspace-integrity.ts's own design already permits a deliverable to
 * reference a real CDN script/stylesheet, and this check must not
 * regress that.
 */
function isBlockedNetworkTarget(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^fe80:|^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/.test(h)) return true;
  return false;
}

/**
 * Generic diagnosis for "<element> intercepts pointer events": finds
 * elements that are marked hidden (hidden class/attribute/aria-hidden)
 * yet are still rendered and cover a large part of the viewport, so a
 * remediation attempt sees the concrete cause (a hidden state that does
 * not actually hide the element), not just a timeout. Never throws.
 */
async function diagnoseHiddenOverlay(page: import("playwright").Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const vw = window.innerWidth * window.innerHeight;
      const found: string[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const marked = el.matches("[hidden], [aria-hidden='true']") || Array.from(el.classList).some((c) => /^(is-)?hidden$|^d-none$|^hide$/.test(c));
        if (!marked) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < vw * 0.25) continue;
        const desc = `<${el.tagName.toLowerCase()}${el.id ? ` id="${el.id}"` : ""} class="${el.className}">`;
        found.push(`${desc} is marked hidden but is still rendered (computed display:${cs.display}, position:${cs.position}, ${Math.round((r.width * r.height * 100) / vw)}% of the viewport) and intercepts clicks on other controls — a CSS rule is overriding its hidden state`);
      }
      return found.length ? found.slice(0, 3).join("; ") : null;
    });
  } catch {
    return null;
  }
}

/**
 * Real incident, Scenario G acceptance run (2026-11-27): a generated
 * inventory app's architect-defined "Adjust Stock"/"Reports"/"Settings"
 * nav sections were never actually implemented — each one just rendered
 * literal placeholder text ("... (Coming Soon)") — and nothing in QA or
 * release verification ever visited them, so the project reached
 * READY_FOR_REVIEW with unfinished committed functionality still
 * exposed in the delivered navigation. Deterministic and generic (no
 * AI judgment, no app-specific knowledge): every reachable top-level
 * navigation destination is actually clicked and its resulting content
 * is checked for a real, placeholder-shaped phrase — never a guess
 * about what the destination's final content *should* say.
 */
const PLACEHOLDER_TEXT_PATTERN = /\b(coming soon|not yet implemented|to be implemented|under construction|work in progress|work-in-progress|placeholder content|placeholder text|lorem ipsum|todo:|tbd\b|not implemented|feature coming)\b/i;
/** Bounded — a real nav never has an unbounded number of top-level destinations, and this must never turn into an unbounded crawl of a large app. */
const MAX_NAV_ITEMS_CHECKED = 15;

async function findUnfinishedNavDestination(page: import("playwright").Page): Promise<{ label: string; matchedPhrase: string } | null> {
  const navItems = page.locator('nav a, nav button, [role="navigation"] a, [role="navigation"] button');
  const count = Math.min(await navItems.count(), MAX_NAV_ITEMS_CHECKED);
  for (let i = 0; i < count; i++) {
    const item = navItems.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const label = ((await item.textContent().catch(() => "")) ?? "").trim() || `nav item ${i + 1}`;
    try {
      await item.click({ timeout: 3000 });
      await page.waitForTimeout(150);
    } catch {
      continue; // a click that fails to even register is a different, separately-caught failure mode
    }
    const text = ((await page.locator("body").textContent().catch(() => "")) ?? "");
    const match = PLACEHOLDER_TEXT_PATTERN.exec(text);
    if (match) return { label, matchedPhrase: match[0] };
  }
  return null;
}

/**
 * Real incident, Scenario B acceptance run (2026-11-27): once the
 * check above stopped picking an already-active nav tab as "the"
 * button, the next real deliverable's only non-nav button (a form
 * "Save" submit) turned out to live inside a tab section that is NOT
 * the default-active one — genuinely invisible at initial load. A
 * primary action living behind tab navigation is an extremely common,
 * legitimate pattern (this module's own nav-destination check above
 * already proves each tab leads to real content) — the right test is
 * to actually navigate there first, the same way a real user would
 * click the relevant tab, rather than declaring the deliverable broken
 * for not exposing every control on its very first screen. Returns the
 * nav item's own label when a navigation was needed, so the caller can
 * recompute its "before" text baseline from the POST-navigation state —
 * otherwise every click would trivially "change the page" just from
 * having navigated, regardless of whether the button itself works.
 */
async function findReachablePrimaryButton(page: import("playwright").Page): Promise<{ button: import("playwright").Locator; navigatedViaLabel: string | null } | null> {
  const nonNavButtonSelector = 'button:not(nav button, [role="navigation"] button)';
  const isUsable = async (locator: import("playwright").Locator) => (await locator.count()) > 0 && (await locator.isVisible().catch(() => false));

  const direct = page.locator(nonNavButtonSelector).first();
  if (await isUsable(direct)) return { button: direct, navigatedViaLabel: null };

  const navItems = page.locator('nav a, nav button, [role="navigation"] a, [role="navigation"] button');
  const count = Math.min(await navItems.count(), MAX_NAV_ITEMS_CHECKED);
  for (let i = 0; i < count; i++) {
    const item = navItems.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const label = ((await item.textContent().catch(() => "")) ?? "").trim() || `nav item ${i + 1}`;
    try {
      await item.click({ timeout: 3000 });
      await page.waitForTimeout(150);
    } catch {
      continue;
    }
    const candidate = page.locator(nonNavButtonSelector).first();
    if (await isUsable(candidate)) return { button: candidate, navigatedViaLabel: label };
  }
  return null;
}

/**
 * Verifies the real generated deliverable in a real headless browser:
 * page loads, a heading and a description-like paragraph exist, a button
 * exists and clicking it changes some visible text on the page, no
 * console/page errors occur, and the page doesn't grossly overflow its
 * viewport. Deliberately structural rather than tied to specific element
 * ids/classes, so the same check applies to both SimulatedAdapter's fixed
 * fixture markup and a real model's (Ollama's) differently-structured
 * markup for the same kind of deliverable.
 */
export async function runQABrowserVerification(
  projectId: string,
  options: { entryFile?: string; baseUrl?: string } = {},
): Promise<QABrowserVerificationResult> {
  const entryFile = options.entryFile ?? "index.html";
  const startedAt = Date.now();

  // When `baseUrl` is given (a real, already-live backend process — see
  // runFullStackVerification in backend-verification.ts), the workspace's
  // own files are no longer what's being served, so the local-file
  // existence pre-checks below are meaningless; the real server is the
  // one source of truth and its own response is checked after `page.goto`
  // below, same as any other navigation failure.
  if (!options.baseUrl) {
    if (!workspaceExists(projectId)) {
      return {
        status: "FAIL",
        summary: "No workspace exists for this project — nothing to verify.",
        details: {},
        durationMs: Date.now() - startedAt,
        targetUrl: "",
      };
    }

    let entryContentExists = true;
    try {
      await readFile(projectId, entryFile);
    } catch {
      entryContentExists = false;
    }
    if (!entryContentExists) {
      return {
        status: "FAIL",
        summary: `"${entryFile}" does not exist in the project workspace — nothing to load.`,
        details: {},
        durationMs: Date.now() - startedAt,
        targetUrl: "",
      };
    }
  }

  let server: http.Server | undefined;
  let browser: import("playwright").Browser | undefined;
  let activePage: import("playwright").Page | undefined;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let targetUrl = "";

  const finish = (
    status: QABrowserVerificationResult["status"],
    summary: string,
    details: Record<string, unknown>,
  ): QABrowserVerificationResult => ({ status, summary, details, durationMs: Date.now() - startedAt, targetUrl });

  try {
    let serverOrigin: string;
    if (options.baseUrl) {
      serverOrigin = options.baseUrl;
    } else {
      const started = await startEphemeralStaticServer(projectId);
      server = started.server;
      serverOrigin = started.baseUrl;
    }
    targetUrl = `${serverOrigin}/${entryFile}`;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    activePage = page;
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === serverOrigin) return route.continue();
      if ((url.protocol === "http:" || url.protocol === "https:") && isBlockedNetworkTarget(url.hostname)) return route.abort();
      return route.continue();
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(targetUrl, { waitUntil: "load", timeout: 15_000 });

    const heading = page.locator("h1, h2").first();
    const headingCount = await heading.count();
    if (headingCount === 0) {
      return finish("FAIL", "No heading (h1/h2) found on the page.", { consoleErrors, pageErrors });
    }
    const headingText = ((await heading.textContent()) ?? "").trim();
    if (headingText.length === 0) {
      return finish("FAIL", "The page's heading is empty.", { consoleErrors, pageErrors });
    }

    let bodyTextBefore = ((await page.locator("body").textContent()) ?? "").trim();
    const descriptionLength = bodyTextBefore.replace(headingText, "").trim().length;
    if (descriptionLength < 5) {
      return finish("FAIL", "No description-like text found alongside the heading.", { consoleErrors, pageErrors, bodyTextBefore });
    }

    // Real incident, Scenario B acceptance run (2026-11-27): a real
    // full-stack expense tracker's FIRST button in DOM order was a nav
    // tab ("Dashboard") already in its default-active state — clicking
    // an already-active tab is legitimately a no-op by design (classic
    // tabs/pills/segmented-control pattern), but this picked it as THE
    // primary button to click-and-verify, and genuinely reported "did
    // not change any visible text" for six real, correct developer
    // attempts in a row, each one burning a real retry. Nav/tab
    // destinations are already verified separately, for real, by
    // findUnfinishedNavDestination below — prefer a reachable button
    // OUTSIDE that nav/tab context (navigating tabs first if needed —
    // see findReachablePrimaryButton), falling back to any button at
    // all only if the page genuinely has no other interactive control.
    const reachable = await findReachablePrimaryButton(page);
    const button = reachable?.button ?? page.locator("button").first();
    if ((await button.count()) === 0) {
      return finish("FAIL", "No button found on the page.", { consoleErrors, pageErrors });
    }
    // A navigation happened to even reach this button — recompute the
    // "before" baseline from THIS (post-navigation) state. Otherwise
    // every click would trivially "change the page" from having
    // navigated at all, regardless of whether the button itself does
    // anything real.
    if (reachable?.navigatedViaLabel) {
      bodyTextBefore = ((await page.locator("body").textContent()) ?? "").trim();
    }

    // Exercise input-driven controls from a non-empty, genuinely
    // submittable state. In particular, Reset on an already-empty
    // counter is legitimately a no-op. Capture the baseline after
    // filling so typing alone can never make a broken button pass.
    //
    // Real incident, Scenario B acceptance run (2026-11-27): a real
    // multi-field required form (type/amount/date/category/payment
    // method) only ever got its FIRST text-type field filled — amount
    // (type="number") and date (type="date") were left empty, so the
    // browser's own required-field validation silently blocked the
    // click from ever submitting at all, genuinely indistinguishable
    // from a broken button. Fills every visible, editable field with a
    // type-appropriate value, not just the first plain-text one.
    const fillableFields = page.locator("input, textarea, select");
    const fieldCount = await fillableFields.count();
    let filledAny = false;
    for (let i = 0; i < fieldCount; i++) {
      const field = fillableFields.nth(i);
      if (!(await field.isVisible().catch(() => false)) || !(await field.isEditable().catch(() => false))) continue;
      const tagName = await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
      if (tagName === "select") {
        await field.evaluate((el) => {
          const select = el as HTMLSelectElement;
          if (!select.value && select.options.length > 0) select.selectedIndex = 0;
        }).catch(() => {});
        filledAny = true;
        continue;
      }
      const inputType = (await field.getAttribute("type").catch(() => null))?.toLowerCase() ?? "text";
      if (["checkbox", "radio", "hidden", "submit", "button", "reset", "file", "color", "range"].includes(inputType)) continue;
      const value =
        inputType === "number" ? "1" :
        inputType === "date" ? new Date().toISOString().slice(0, 10) :
        inputType === "month" ? new Date().toISOString().slice(0, 7) :
        inputType === "time" ? "12:00" :
        inputType === "email" ? "test@example.com" :
        inputType === "tel" ? "555-0100" :
        inputType === "url" ? "https://example.com" :
        "Browser verification";
      await field.fill(value).catch(() => {});
      filledAny = true;
    }
    if (filledAny) {
      await page.waitForTimeout(200);
      bodyTextBefore = ((await page.locator("body").textContent()) ?? "").trim();
    }

    await button.click({ timeout: 5000 });
    await page.waitForTimeout(200);
    const bodyTextAfter = ((await page.locator("body").textContent()) ?? "").trim();

    if (bodyTextAfter === bodyTextBefore) {
      return finish("FAIL", "Clicking the button did not change any visible text on the page.", {
        consoleErrors,
        pageErrors,
        bodyTextBefore,
        bodyTextAfter,
      });
    }

    const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth * 1.5);
    if (viewportOverflow) {
      return finish("FAIL", "The page's content overflows its viewport far beyond a reasonable margin.", { consoleErrors, pageErrors });
    }

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      return finish("FAIL", "The page loaded and the button worked, but the browser reported console/page errors.", {
        consoleErrors,
        pageErrors,
      });
    }

    const unfinishedNav = await findUnfinishedNavDestination(page);
    if (unfinishedNav) {
      return finish(
        "FAIL",
        `The "${unfinishedNav.label}" navigation destination is an unfinished placeholder ("${unfinishedNav.matchedPhrase}"), not real functionality. Either implement it for real or remove it from the navigation entirely — a committed feature must not ship as a stub.`,
        { consoleErrors, pageErrors },
      );
    }

    return finish("PASS", "Page loaded, heading and description are present, clicking the button changed the page's visible text with no console/page errors, and every navigation destination leads to real (non-placeholder) content.", {
      consoleErrors,
      pageErrors,
      // Real, actually-rendered page text — not the fixture/model's own
      // description of what it built. Lets a caller (agent-runner.ts's
      // deliverable-consistency check) compare what was really produced
      // against the user's original request, not just trust "QA passed."
      headingText,
      bodyTextBefore,
      bodyTextAfter,
      buttonText: await button.textContent(),
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const overlay = /intercepts pointer events/i.test(rawMessage) && activePage ? await diagnoseHiddenOverlay(activePage) : null;
    return {
      status: "FAIL",
      summary: `Browser verification threw an unexpected error: ${compactFailureEvidence(rawMessage)}${overlay ? `
Diagnosis: ${overlay}` : ""}`,
      details: { consoleErrors, pageErrors, ...(overlay ? { hiddenOverlayDiagnosis: overlay } : {}) },
      durationMs: Date.now() - startedAt,
      targetUrl,
    };
  } finally {
    if (browser) await browser.close();
    if (server) await stopServer(server);
  }
}
