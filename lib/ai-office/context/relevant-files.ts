import "server-only";

/**
 * Token economics phase, Part 5 — a deterministic, dependency-free
 * first-pass file selector. Pure and synchronous on purpose: it only scores
 * already-known file *metadata* (path, size, who last touched it) plus
 * plain-text task signals (title, failure reasons) — no filesystem access,
 * no model call, so it's trivially and exactly unit-testable. Reading file
 * *content* to expand the selection via detected references
 * (`expandWithReferencedFiles` below) is a separate, explicitly async step,
 * since it genuinely needs `workspace-service.ts`'s real file reads.
 */

export interface FileCandidate {
  path: string;
  sizeBytes: number;
  /** From `workspace_files.lastModifiedByTaskId` — the strongest possible relevance signal: this exact task already wrote this file. */
  lastModifiedByTaskId: string | null;
}

export interface SelectRelevantFilesInput {
  files: FileCandidate[];
  taskId: string;
  taskTitle: string;
  /** Every unresolved failure reason for this task, most recent last — mined for filenames/keywords a corrective attempt should prioritize. */
  failingChecks: string[];
  maxFiles: number;
}

export interface SelectRelevantFilesResult {
  selectedPaths: string[];
  excludedPaths: string[];
}

const CODE_EXTENSION_KEYWORDS: Record<string, string[]> = {
  html: ["html", "page", "markup", "ui", "frontend", "web"],
  css: ["style", "css", "layout", "design", "frontend"],
  js: ["script", "javascript", "js", "button", "click", "interactive", "frontend", "logic"],
  ts: ["script", "typescript", "ts", "logic", "backend"],
  json: ["config", "data", "manifest"],
};

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

/** Case-insensitive substring/keyword scoring — never a regex over untrusted content, just simple text containment against a short, bounded set of signals. */
function scoreFile(file: FileCandidate, taskId: string, lowerTitle: string, lowerFailures: string[]): number {
  let score = 0;

  // Strongest signal: this exact task already produced/touched this file —
  // a retry almost always needs to see (and usually keep) what it built.
  if (file.lastModifiedByTaskId === taskId) score += 100;

  const lowerPath = file.path.toLowerCase();

  // A failure reason naming this file's exact filename is the single most
  // targeted signal a corrective attempt can have.
  for (const failure of lowerFailures) {
    if (failure.includes(lowerPath)) score += 80;
  }

  // The conventional web entry point — almost always relevant for a
  // frontend/UI task even when nothing else points at it specifically.
  if (lowerPath === "index.html") score += 30;

  const ext = extensionOf(file.path);
  const keywords = CODE_EXTENSION_KEYWORDS[ext] ?? [];
  for (const keyword of keywords) {
    if (lowerTitle.includes(keyword)) score += 15;
    for (const failure of lowerFailures) {
      if (failure.includes(keyword)) score += 10;
    }
  }

  // A tiny tie-breaking preference for smaller files — cheaper to include
  // when two files are otherwise equally relevant.
  score += Math.max(0, 5 - Math.floor(file.sizeBytes / 2000));

  return score;
}

/**
 * Ranks every candidate file by relevance and keeps the top `maxFiles` —
 * ties broken by original (path-sorted) order for determinism. A
 * `maxFiles` of 0 selects nothing (matches a capability budget that grants
 * this role no file access at all).
 */
export function selectRelevantFiles(input: SelectRelevantFilesInput): SelectRelevantFilesResult {
  if (input.maxFiles <= 0 || input.files.length === 0) {
    return { selectedPaths: [], excludedPaths: input.files.map((f) => f.path) };
  }

  const lowerTitle = input.taskTitle.toLowerCase();
  const lowerFailures = input.failingChecks.map((f) => f.toLowerCase());

  const scored = input.files
    .map((file, index) => ({ file, index, score: scoreFile(file, input.taskId, lowerTitle, lowerFailures) }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));

  const selected = scored.slice(0, input.maxFiles);
  const excluded = scored.slice(input.maxFiles);

  return {
    selectedPaths: selected.map((s) => s.file.path),
    excludedPaths: excluded.map((s) => s.file.path),
  };
}

/** Matches a local (non-remote, non-data-URI) relative reference in an `href`/`src` attribute or an ES-module `import ... from "..."` specifier — deliberately simple and conservative; a pattern this doesn't recognize is just not auto-included, never a correctness risk. */
const LOCAL_REFERENCE_PATTERN = /(?:href|src)\s*=\s*["']([^"':]+?)["']|from\s+["'](\.[^"']+)["']/gi;

/** Extracts locally-referenced file paths from one file's content — used to pull in a selected anchor file's direct dependencies (Part 5's "imports/references where safely detectable") without ever executing or fully parsing the file. */
export function extractLocalReferences(content: string): string[] {
  const refs = new Set<string>();
  for (const match of content.matchAll(LOCAL_REFERENCE_PATTERN)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw || raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:") || raw.startsWith("//")) continue;
    const cleaned = raw.replace(/^\.\//, "").split(/[?#]/)[0];
    if (cleaned) refs.add(cleaned);
  }
  return [...refs];
}
