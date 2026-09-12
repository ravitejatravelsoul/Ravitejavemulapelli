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
  options: { entryFile?: string } = {},
): Promise<QABrowserVerificationResult> {
  const entryFile = options.entryFile ?? "index.html";
  const startedAt = Date.now();

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

  let server: http.Server | undefined;
  let browser: import("playwright").Browser | undefined;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let targetUrl = "";

  const finish = (
    status: QABrowserVerificationResult["status"],
    summary: string,
    details: Record<string, unknown>,
  ): QABrowserVerificationResult => ({ status, summary, details, durationMs: Date.now() - startedAt, targetUrl });

  try {
    const started = await startEphemeralStaticServer(projectId);
    server = started.server;
    targetUrl = `${started.baseUrl}/${entryFile}`;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
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

    const bodyTextBefore = ((await page.locator("body").textContent()) ?? "").trim();
    const descriptionLength = bodyTextBefore.replace(headingText, "").trim().length;
    if (descriptionLength < 5) {
      return finish("FAIL", "No description-like text found alongside the heading.", { consoleErrors, pageErrors, bodyTextBefore });
    }

    const button = page.locator("button").first();
    if ((await button.count()) === 0) {
      return finish("FAIL", "No button found on the page.", { consoleErrors, pageErrors });
    }

    await button.click();
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

    return finish("PASS", "Page loaded, heading and description are present, and clicking the button changed the page's visible text with no console/page errors.", {
      consoleErrors,
      pageErrors,
    });
  } catch (error) {
    return {
      status: "FAIL",
      summary: `Browser verification threw an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      details: { consoleErrors, pageErrors },
      durationMs: Date.now() - startedAt,
      targetUrl,
    };
  } finally {
    if (browser) await browser.close();
    if (server) await stopServer(server);
  }
}
