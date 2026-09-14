// Node ESM loader hook that makes "playwright"/"playwright-core"
// unresolvable — reproduces the real, confirmed Vercel production
// failure (FUNCTION_INVOCATION_FAILED: "Cannot find module
// '.../playwright-core/browsers.json'") locally, without needing a
// broken Playwright install: any code path that tries to load Playwright
// under this loader fails the same way a genuinely broken/missing
// install would. Loaded via NODE_OPTIONS="--import <this file>" for the
// server spawned in office-limited-production.e2e.ts.
//
// Unlike block-node-sqlite's loader (removed — it didn't actually work:
// Turbopack's bundled runtime resolves "node:"-prefixed built-ins via its
// own internal `Context.externalRequire`, which bypasses Node's `resolve`
// hook entirely), "playwright"/"playwright-core" are regular npm
// packages resolved through Node's normal module resolution even when
// referenced as an "external" from a Turbopack-bundled chunk — confirmed
// directly: this loader, applied to a real `next start` server, causes
// any actual attempt to load Playwright to throw exactly like a broken
// install would, while leaving a limited-production /office request
// (which never attempts to load it, after this fix) completely
// unaffected.
import { register } from "node:module";

register(new URL("./block-playwright-hooks.mjs", import.meta.url));
