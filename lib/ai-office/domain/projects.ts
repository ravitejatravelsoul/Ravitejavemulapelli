import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type ProjectStatus =
  | "DRAFT"
  | "PLANNING"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "PAUSED"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "FAILED"
  | "ARCHIVED";

export type AiMode = "SIMULATED" | "LIVE";

/** Which engine executes this project's (SIMULATED-authorized) work — orthogonal to `aiMode`, see migrations/003-add-project-provider.sql. */
export type ProjectProvider = "simulated" | "ollama";

/**
 * Controlled Claude LIVE pilot — which providers a project's roles may
 * ever be routed to, decided once per project, never silently changed.
 * `LOCAL_ONLY` (the default for every existing and future project,
 * preserving current behavior exactly) never invokes Claude regardless
 * of capability evidence. `HYBRID` lets the provider router send a
 * role to Claude only when local evidence says the role's capability
 * has no qualified local model, and only after the owner has approved
 * paid use for this specific project (see
 * app/office/actions/ai-policy.ts). `CLAUDE_ONLY` is supported for
 * completeness but is never the default and nothing in this codebase
 * selects it automatically.
 */
export type AiPolicyMode = "LOCAL_ONLY" | "HYBRID" | "CLAUDE_ONLY";

export interface ProjectRow {
  id: string;
  title: string;
  status: ProjectStatus;
  aiMode: AiMode;
  provider: ProjectProvider;
  aiPolicyMode: AiPolicyMode;
  monthlyBudgetCapUsd: number | null;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Free multi-model orchestration phase (migration 015) — only
   * meaningful when `provider === "ollama"`. When 1, agent-runner.ts
   * routes each task through the new capability-based multi-provider
   * free-model router (agents/free-model-router.ts) instead of going
   * straight to LocalModelRouter/OllamaAdapter. `0 | 1` (not `boolean`)
   * matching this codebase's existing convention for a raw SQLite
   * integer column (see e.g. `BenchmarkResultRow.timedOut`) — the write
   * path below accepts a real `boolean` and converts it.
   */
  freeModelOrchestration: 0 | 1;
}

export interface ProjectIdeaRow {
  id: string;
  projectId: string;
  rawText: string;
  submittedAt: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Creates a Project and its ProjectIdea together, atomically — per the
 * brief's explicit "creating a Project + ProjectIdea" transaction
 * example. Either both rows exist afterward or neither does.
 */
export function createProjectWithIdea(
  db: DatabaseSync,
  input: {
    title: string;
    rawIdeaText: string;
    ownerId: string;
    aiMode?: AiMode;
    provider?: ProjectProvider;
    aiPolicyMode?: AiPolicyMode;
    monthlyBudgetCapUsd?: number | null;
    /** Free multi-model orchestration phase — see `ProjectRow.freeModelOrchestration`'s docblock. Defaults to false (off) for every existing/new caller that doesn't explicitly opt in. */
    freeModelOrchestration?: boolean;
  },
): { project: ProjectRow; idea: ProjectIdeaRow } {
  const now = Date.now();
  const projectId = randomUUID();
  const ideaId = randomUUID();
  const aiMode = input.aiMode ?? "SIMULATED";
  const provider = input.provider ?? "simulated";
  const aiPolicyMode = input.aiPolicyMode ?? "LOCAL_ONLY";
  const monthlyBudgetCapUsd = input.monthlyBudgetCapUsd ?? null;
  const freeModelOrchestration = input.freeModelOrchestration ? 1 : 0;

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO projects (id, title, status, aiMode, provider, aiPolicyMode, monthlyBudgetCapUsd, ownerId, createdAt, updatedAt, freeModelOrchestration)
       VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(projectId, input.title, aiMode, provider, aiPolicyMode, monthlyBudgetCapUsd, input.ownerId, now, now, freeModelOrchestration);

    db.prepare(
      `INSERT INTO project_ideas (id, projectId, rawText, submittedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(ideaId, projectId, input.rawIdeaText, now, now, now);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    project: getProject(db, projectId) as unknown as ProjectRow,
    idea: getProjectIdea(db, projectId) as unknown as ProjectIdeaRow,
  };
}

export function getProject(db: DatabaseSync, id: string): ProjectRow | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as ProjectRow | undefined;
}

export function getProjectIdea(db: DatabaseSync, projectId: string): ProjectIdeaRow | undefined {
  return db.prepare("SELECT * FROM project_ideas WHERE projectId = ?").get(projectId) as
    | ProjectIdeaRow
    | undefined;
}

export function listProjects(db: DatabaseSync, filter?: { status?: ProjectStatus }): ProjectRow[] {
  if (filter?.status) {
    return db.prepare("SELECT * FROM projects WHERE status = ? ORDER BY createdAt DESC").all(filter.status) as unknown as ProjectRow[];
  }
  return db.prepare("SELECT * FROM projects ORDER BY createdAt DESC").all() as unknown as ProjectRow[];
}

export function updateProjectStatus(db: DatabaseSync, id: string, status: ProjectStatus): ProjectRow {
  db.prepare("UPDATE projects SET status = ?, updatedAt = ? WHERE id = ?").run(status, Date.now(), id);
  return getProject(db, id) as unknown as ProjectRow;
}
