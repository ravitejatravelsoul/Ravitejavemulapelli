import "server-only";
import { posix } from "node:path";
import { listFiles, readFile } from "./workspace-service.ts";
import { findHiddenStateConflicts, describeHiddenStateConflict, type HiddenStateConflict } from "./css-visibility.ts";

/**
 * Deterministic deliverable integrity validation (deliverable integrity
 * gate follow-up) — NOT an AI/model check. A real UI acceptance run
 * showed frontend-developer write an `index.html` that referenced
 * `script.js`/`style.css` it never actually created; the task still
 * completed because `fileOperations` was non-empty, and only real
 * (slow) Playwright QA eventually caught the broken button. This module
 * catches that exact class of defect immediately after materialization,
 * using only the already-safe `workspace-service.ts` boundary — no raw
 * `fs` access, no path outside what `listFiles`/`readFile` already
 * expose, no network requests ever (remote resources are recognized and
 * explicitly skipped, never fetched).
 *
 * Deliberately narrow, per the explicit "do not overvalidate" brief:
 * only `<script src>`, `<img src>`, and `<link rel="stylesheet" href>`
 * are checked — high-confidence, unambiguous "this must exist for the
 * page to work" references. This never replaces real QA, code review,
 * intent consistency, or security review; it only catches an obvious,
 * mechanically-detectable broken reference before those slower/costlier
 * checks would eventually catch the same thing.
 */

export interface MissingReference {
  sourceFile: string;
  /** The raw reference text exactly as written in the source file (e.g. "script.js?v=1"), not the resolved/cleaned path. */
  reference: string;
}

/**
 * A `<script src>` pointing at a file extension no browser can execute
 * directly — real incident, Scenario A (Pomodoro) acceptance run:
 * frontend-developer wrote `public/index.html` referencing
 * `/src/index.tsx` for a "modern" app. This execution environment never
 * runs a bundler/transpiler (QA's workspace server — see
 * qa-browser-verification.ts's docblock — serves only static files, and
 * each GitHub Actions cycle terminates after one bounded task), so a
 * `.tsx`/`.jsx` reference is unconditionally broken here regardless of
 * whether the file exists or is internally consistent — the earlier
 * `missingReferences` check alone could never catch this class, since it
 * only looks for existence, not executability. Flagged before even a
 * first corrective attempt, with the reason explaining WHY (not just
 * WHAT), so the developer role is told to use a build-less structure
 * instead of guessing again at fixing paths within an approach that can
 * never work in this environment.
 */
export interface UnsupportedScriptReference {
  sourceFile: string;
  reference: string;
  extension: string;
}

export interface WorkspaceIntegrityResult {
  status: "PASS" | "FAIL";
  missingReferences: MissingReference[];
  /** Elements meant to be hidden whose own display rule wins the CSS cascade (see css-visibility.ts) — always present, empty when none. */
  hiddenStateConflicts?: HiddenStateConflict[];
  /** Always present, empty when none — see UnsupportedScriptReference's docblock. */
  unsupportedScriptReferences?: UnsupportedScriptReference[];
}

const SCRIPT_SRC_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
/** No browser executes these directly without a build step — see UnsupportedScriptReference's docblock. Deliberately NOT .mjs/.js (both run directly) or .json/.wasm (never valid as a <script src> target either way, but that's a missing-reference/HTML-authoring concern, not this check's). */
const UNSUPPORTED_SCRIPT_EXTENSIONS = new Set(["tsx", "ts", "jsx"]);
const IMG_SRC_PATTERN = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;

function isStylesheetLinkTag(tag: string): boolean {
  return /\brel\s*=\s*["']stylesheet["']/i.test(tag);
}

/** Every local `<img src>`/stylesheet `<link>` reference found in an HTML document's markup, exactly as written (not yet cleaned/resolved) — `<script src>` is handled separately by the caller so its extension can be checked before its existence. Regex-based on purpose — this is intentionally not a full HTML/DOM parse, matching the brief's "start with high-confidence web-resource integrity," not a general-purpose HTML engine. */
function extractImgAndStylesheetReferences(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(IMG_SRC_PATTERN)) refs.push(match[1]);
  for (const match of html.matchAll(LINK_TAG_PATTERN)) {
    const tag = match[0];
    if (!isStylesheetLinkTag(tag)) continue; // favicons/preload/canonical/etc are lower-confidence "required" signals — deliberately excluded to avoid false positives
    const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (hrefMatch) refs.push(hrefMatch[1]);
  }
  return refs;
}

/** Remote/non-file schemes and fragment-only references are never "missing local files" — this validator only ever checks resources this workspace itself is supposed to contain, and never fetches anything over the network. */
function isLocalReference(reference: string): boolean {
  const trimmed = reference.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("//")) return false; // protocol-relative remote URL
  return !/^(https?:|data:|blob:|mailto:|tel:|javascript:|#)/i.test(trimmed);
}

function stripQueryAndHash(reference: string): string {
  return reference.split(/[?#]/)[0]!;
}

/**
 * Resolves `reference` relative to the directory of `sourceFile`, purely
 * as string manipulation against the workspace's own relative-path
 * namespace — never touches the filesystem, never calls
 * `resolveSafePath` (that validates and resolves *real absolute disk
 * paths*, which is the wrong tool here: this function only needs to
 * know whether the resolved relative path matches an entry in the
 * workspace's already-safely-enumerated file list). A reference that
 * normalizes to escape the workspace root (`../../secret`) is never
 * flagged as "missing" — this validator has no way to safely check
 * something outside the workspace, so per the brief's "if unsure, don't
 * fail the build," it's silently skipped rather than treated as broken
 * OR resolved against the real filesystem.
 */
function resolveRelativeReference(sourceFile: string, reference: string): string | null {
  const sourceDir = posix.dirname(sourceFile);
  const joined = posix.normalize(posix.join(sourceDir === "." ? "" : sourceDir, reference));
  if (joined === ".." || joined.startsWith("../")) return null;
  return joined;
}

/** Real, deterministic, non-AI validation of a project's materialized workspace — every local resource an HTML file references must actually exist as a real file in that same workspace. Never fetches anything remote; never touches a path outside what `listFiles`/`readFile` already expose. */
export async function validateWorkspaceIntegrity(projectId: string): Promise<WorkspaceIntegrityResult> {
  const files = await listFiles(projectId);
  const fileSet = new Set(files);
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f));

  const missingReferences: MissingReference[] = [];
  const unsupportedScriptReferences: UnsupportedScriptReference[] = [];
  for (const sourceFile of htmlFiles) {
    const content = await readFile(projectId, sourceFile);
    for (const match of content.matchAll(SCRIPT_SRC_PATTERN)) {
      const rawReference = match[1]!;
      if (!isLocalReference(rawReference)) continue;
      const cleaned = stripQueryAndHash(rawReference);
      if (cleaned === "") continue;
      const extension = cleaned.split(".").pop()?.toLowerCase() ?? "";
      if (UNSUPPORTED_SCRIPT_EXTENSIONS.has(extension)) {
        unsupportedScriptReferences.push({ sourceFile, reference: rawReference, extension });
        continue; // already flagged as a distinct, more specific defect — redundant as a "missing" check too
      }
      const resolved = resolveRelativeReference(sourceFile, cleaned);
      if (resolved === null) continue;
      if (!fileSet.has(resolved)) {
        missingReferences.push({ sourceFile, reference: rawReference });
      }
    }
    for (const rawReference of extractImgAndStylesheetReferences(content)) {
      if (!isLocalReference(rawReference)) continue;
      const cleaned = stripQueryAndHash(rawReference);
      if (cleaned === "") continue;
      const resolved = resolveRelativeReference(sourceFile, cleaned);
      if (resolved === null) continue;
      if (!fileSet.has(resolved)) {
        missingReferences.push({ sourceFile, reference: rawReference });
      }
    }
  }

  const cssFiles = files.filter((f) => /\.css$/i.test(f));
  const hiddenStateConflicts = findHiddenStateConflicts({
    html: await Promise.all(htmlFiles.map(async (file) => ({ file, content: await readFile(projectId, file) }))),
    css: await Promise.all(cssFiles.map(async (file) => ({ file, content: await readFile(projectId, file) }))),
  });

  return missingReferences.length > 0 || hiddenStateConflicts.length > 0 || unsupportedScriptReferences.length > 0
    ? { status: "FAIL", missingReferences, hiddenStateConflicts, unsupportedScriptReferences }
    : { status: "PASS", missingReferences: [], hiddenStateConflicts: [], unsupportedScriptReferences: [] };
}

/** A single, human-readable sentence for the first detected defect — used as both the semantic failure reason and the corrective-attempt context, so the message a developer role sees is exactly the message recorded as the failure. Unsupported-script-type defects are reported first: they're the most actionable (the whole approach needs to change, not just one path) and the most certain (no existence check needed — the extension alone makes it unconditionally broken here). */
export function describeIntegrityFailure(result: WorkspaceIntegrityResult): string {
  const unsupportedScript = result.unsupportedScriptReferences?.[0];
  if (unsupportedScript) {
    const extra = (result.unsupportedScriptReferences?.length ?? 1) - 1;
    return (
      `Workspace integrity validation failed: ${unsupportedScript.sourceFile} loads ${unsupportedScript.reference} directly as a script, but this environment serves files as plain static assets with no build step — ` +
      `a browser cannot execute a .${unsupportedScript.extension} file directly. Rewrite this as plain, build-less HTML/CSS/JavaScript that runs directly in a browser (no TypeScript, no JSX, no bundler-style imports) instead of fixing this reference's path.` +
      (extra > 0 ? ` (and ${extra} more unsupported script reference${extra === 1 ? "" : "s"})` : "")
    );
  }
  const first = result.missingReferences[0];
  if (!first && result.hiddenStateConflicts?.[0]) {
    const extra = result.hiddenStateConflicts.length - 1;
    return `Workspace integrity validation failed: ${describeHiddenStateConflict(result.hiddenStateConflicts[0])}${extra > 0 ? ` (and ${extra} more hidden-state conflict${extra === 1 ? "" : "s"})` : ""}`;
  }
  if (!first) return "Workspace integrity validation failed.";
  const rest = result.missingReferences.length - 1;
  const suffix = rest > 0 ? ` (and ${rest} more missing reference${rest === 1 ? "" : "s"})` : "";
  return `Workspace integrity validation failed: ${first.sourceFile} references ${first.reference}, but ${stripQueryAndHash(first.reference)} does not exist.${suffix}`;
}
