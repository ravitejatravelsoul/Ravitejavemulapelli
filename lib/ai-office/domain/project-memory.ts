import "server-only";
import type { DatabaseSync } from "node:sqlite";

/**
 * project_memory_cache repository — not built in Phase 3 (that phase's
 * required-entity list didn't include it); added now because Phase 4 is
 * the first phase that actually needs to exercise it. See
 * docs/ai-office/06-data-model.md §7.
 *
 * `updateProjectMemory` is a deterministic, plain-TypeScript summarizer
 * — string templating over already-persisted rows, never an LLM call.
 * AgentRunner calls it after every task reaches a terminal state so the
 * cache always reflects "what actually happened," not a guess.
 */

export interface ProjectMemoryRow {
  projectId: string;
  summary: string;
  fileMap: string | null; // JSON, nullable
  knownIssues: string; // JSON array
  lastUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
}

export function getProjectMemory(db: DatabaseSync, projectId: string): ProjectMemoryRow | undefined {
  return db.prepare("SELECT * FROM project_memory_cache WHERE projectId = ?").get(projectId) as
    | unknown as ProjectMemoryRow
    | undefined;
}

/** Token economics phase, Part 4 — how many of a task's most recent unresolved-failure reasons the compact memory keeps verbatim; older ones are dropped rather than accumulated forever (the real, unabridged history remains queryable via `listUnresolvedFailures`/`failures` — this is only the *compact* summary a paid-provider prompt might reference). */
const MAX_KNOWN_ISSUES = 10;

function upsertProjectMemory(
  db: DatabaseSync,
  input: { projectId: string; summary: string; knownIssues: unknown[]; fileMap: Array<{ path: string; sizeBytes: number }> | null },
): ProjectMemoryRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO project_memory_cache (projectId, summary, fileMap, knownIssues, lastUpdatedAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (projectId) DO UPDATE SET
       summary = excluded.summary,
       fileMap = excluded.fileMap,
       knownIssues = excluded.knownIssues,
       lastUpdatedAt = excluded.lastUpdatedAt,
       updatedAt = excluded.updatedAt`,
  ).run(
    input.projectId,
    input.summary,
    input.fileMap ? JSON.stringify(input.fileMap) : null,
    JSON.stringify(input.knownIssues.slice(-MAX_KNOWN_ISSUES)),
    now,
    now,
    now,
  );
  return getProjectMemory(db, input.projectId) as ProjectMemoryRow;
}

/** Parses the compact file map back out — `undefined` for a legacy row from before this phase (column exists but was never populated) or a project with no workspace at all; never a filesystem read. */
export function getProjectFileMap(memory: ProjectMemoryRow | undefined): Array<{ path: string; sizeBytes: number }> | undefined {
  if (!memory?.fileMap) return undefined;
  try {
    return JSON.parse(memory.fileMap) as Array<{ path: string; sizeBytes: number }>;
  } catch {
    return undefined;
  }
}

/**
 * Deterministic recompute from already-persisted rows — plain counting
 * and templating, not a summarizer model. Called by AgentRunner after
 * each task reaches a terminal state (see lib/ai-office/agents/agent-runner.ts).
 */
export function refreshProjectMemory(db: DatabaseSync, projectId: string): ProjectMemoryRow {
  const project = db.prepare("SELECT title, status FROM projects WHERE id = ?").get(projectId) as
    | unknown as { title: string; status: string }
    | undefined;
  if (!project) throw new Error(`Cannot refresh project memory: project ${projectId} does not exist.`);

  const tasks = db
    .prepare("SELECT id, title, status, roleId FROM tasks WHERE projectId = ? ORDER BY createdAt")
    .all(projectId) as unknown as Array<{ id: string; title: string; status: string; roleId: string }>;

  const completed = tasks.filter((t) => t.status === "DONE");
  const current = tasks.find((t) => t.status === "IN_PROGRESS" || t.status === "PENDING" || t.status === "BLOCKED");

  const latestTest = db
    .prepare("SELECT status FROM test_results WHERE projectId = ? ORDER BY createdAt DESC LIMIT 1")
    .get(projectId) as unknown as { status: string } | undefined;

  const unresolvedFailures = db
    .prepare("SELECT reason FROM failures WHERE projectId = ? AND resolved = 0 ORDER BY createdAt")
    .all(projectId) as unknown as Array<{ reason: string }>;

  const decisionCount = (
    db.prepare("SELECT COUNT(*) as count FROM project_decisions WHERE projectId = ?").get(projectId) as unknown as {
      count: number;
    }
  ).count;

  const summaryLines = [
    `Project "${project.title}" is ${project.status}.`,
    `${completed.length}/${tasks.length} tasks complete.`,
    current ? `Current task: "${current.title}" (${current.roleId}, ${current.status}).` : "No task currently in progress.",
    latestTest ? `Latest test result: ${latestTest.status}.` : "No test results yet.",
    decisionCount > 0 ? `${decisionCount} recorded decision(s).` : "No recorded decisions yet.",
  ];

  // Token economics phase, Part 4 — a compact path+size map of the real
  // workspace, deterministically derived (no filesystem read, no model
  // call), so a role that needs to know "what files exist" can consult
  // this cheap summary instead of a paid provider re-deriving it from a
  // full directory listing every time. Capped, not the whole workspace —
  // a project with far more files than this only loses the map's
  // completeness, never crashes or grows this cache unboundedly.
  const MAX_FILE_MAP_ENTRIES = 50;
  const fileRows = db
    .prepare("SELECT path, sizeBytes FROM workspace_files WHERE projectId = ? ORDER BY path LIMIT ?")
    .all(projectId, MAX_FILE_MAP_ENTRIES) as unknown as Array<{ path: string; sizeBytes: number }>;

  return upsertProjectMemory(db, {
    projectId,
    summary: summaryLines.join(" "),
    knownIssues: unresolvedFailures.map((f) => f.reason),
    fileMap: fileRows.length > 0 ? fileRows : null,
  });
}
