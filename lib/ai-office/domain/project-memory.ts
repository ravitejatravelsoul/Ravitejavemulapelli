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

function upsertProjectMemory(
  db: DatabaseSync,
  input: { projectId: string; summary: string; knownIssues: unknown[] },
): ProjectMemoryRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO project_memory_cache (projectId, summary, fileMap, knownIssues, lastUpdatedAt, createdAt, updatedAt)
     VALUES (?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT (projectId) DO UPDATE SET
       summary = excluded.summary,
       knownIssues = excluded.knownIssues,
       lastUpdatedAt = excluded.lastUpdatedAt,
       updatedAt = excluded.updatedAt`,
  ).run(input.projectId, input.summary, JSON.stringify(input.knownIssues), now, now, now);
  return getProjectMemory(db, input.projectId) as ProjectMemoryRow;
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

  return upsertProjectMemory(db, {
    projectId,
    summary: summaryLines.join(" "),
    knownIssues: unresolvedFailures.map((f) => f.reason),
  });
}
