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

export interface ProjectRow {
  id: string;
  title: string;
  status: ProjectStatus;
  aiMode: AiMode;
  provider: ProjectProvider;
  monthlyBudgetCapUsd: number | null;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
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
  input: { title: string; rawIdeaText: string; ownerId: string; aiMode?: AiMode; provider?: ProjectProvider },
): { project: ProjectRow; idea: ProjectIdeaRow } {
  const now = Date.now();
  const projectId = randomUUID();
  const ideaId = randomUUID();
  const aiMode = input.aiMode ?? "SIMULATED";
  const provider = input.provider ?? "simulated";

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO projects (id, title, status, aiMode, provider, monthlyBudgetCapUsd, ownerId, createdAt, updatedAt)
       VALUES (?, ?, 'DRAFT', ?, ?, NULL, ?, ?, ?)`,
    ).run(projectId, input.title, aiMode, provider, input.ownerId, now, now);

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
