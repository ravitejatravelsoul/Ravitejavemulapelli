import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * workspaces + workspace_files + runner_heartbeats repositories —
 * persistence only, mirroring every other domain/*.ts file's shape
 * (see domain/office.ts, domain/tasks.ts). No filesystem access here —
 * that's lib/ai-office/workspace/workspace-service.ts's job. This file
 * only tracks metadata: whether a project has ever started real
 * development, what delivery state it's in, which files exist and who
 * last touched them, and runner liveness.
 */

export type DeliveryState = "NOT_STARTED" | "BUILDING" | "VERIFYING" | "VERIFIED" | "FAILED";

export interface WorkspaceRow {
  id: string;
  projectId: string;
  deliveryState: DeliveryState;
  createdAt: number;
  updatedAt: number;
}

export function getWorkspace(db: DatabaseSync, projectId: string): WorkspaceRow | undefined {
  return db.prepare("SELECT * FROM workspaces WHERE projectId = ?").get(projectId) as WorkspaceRow | undefined;
}

/** Idempotent — creates the workspace row only if one doesn't already exist yet (real workspace directory creation happens lazily on first file write, in workspace-service.ts; this just ensures the DB knows the project has one). */
export function getOrCreateWorkspace(db: DatabaseSync, projectId: string): WorkspaceRow {
  const existing = getWorkspace(db, projectId);
  if (existing) return existing;

  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO workspaces (id, projectId, deliveryState, createdAt, updatedAt)
     VALUES (?, ?, 'NOT_STARTED', ?, ?)
     ON CONFLICT (projectId) DO NOTHING`,
  ).run(id, projectId, now, now);

  return getWorkspace(db, projectId) as WorkspaceRow;
}

export function setDeliveryState(db: DatabaseSync, projectId: string, deliveryState: DeliveryState): WorkspaceRow {
  getOrCreateWorkspace(db, projectId);
  db.prepare("UPDATE workspaces SET deliveryState = ?, updatedAt = ? WHERE projectId = ?").run(deliveryState, Date.now(), projectId);
  return getWorkspace(db, projectId) as WorkspaceRow;
}

export interface WorkspaceFileRow {
  id: string;
  projectId: string;
  path: string;
  sizeBytes: number;
  lastModifiedByRoleId: string | null;
  lastModifiedByTaskId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Upserts one file's metadata row — called once per applied write, never for reads. Deletes call `deleteWorkspaceFileRecord` instead. */
export function upsertWorkspaceFileRecord(
  db: DatabaseSync,
  input: { projectId: string; path: string; sizeBytes: number; roleId: string | null; taskId: string | null },
): WorkspaceFileRow {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO workspace_files (id, projectId, path, sizeBytes, lastModifiedByRoleId, lastModifiedByTaskId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (projectId, path) DO UPDATE SET
       sizeBytes = excluded.sizeBytes,
       lastModifiedByRoleId = excluded.lastModifiedByRoleId,
       lastModifiedByTaskId = excluded.lastModifiedByTaskId,
       updatedAt = excluded.updatedAt`,
  ).run(id, input.projectId, input.path, input.sizeBytes, input.roleId, input.taskId, now, now);

  return db.prepare("SELECT * FROM workspace_files WHERE projectId = ? AND path = ?").get(input.projectId, input.path) as unknown as WorkspaceFileRow;
}

export function deleteWorkspaceFileRecord(db: DatabaseSync, projectId: string, path: string): void {
  db.prepare("DELETE FROM workspace_files WHERE projectId = ? AND path = ?").run(projectId, path);
}

export function listWorkspaceFileRecords(db: DatabaseSync, projectId: string): WorkspaceFileRow[] {
  return db.prepare("SELECT * FROM workspace_files WHERE projectId = ? ORDER BY path").all(projectId) as unknown as WorkspaceFileRow[];
}

export function sumWorkspaceFileSizes(db: DatabaseSync, projectId: string): number {
  const row = db.prepare("SELECT COALESCE(SUM(sizeBytes), 0) as total FROM workspace_files WHERE projectId = ?").get(projectId) as { total: number };
  return row.total;
}

// ---- runner heartbeat -----------------------------------------------

export type RunnerHeartbeatStatus = "IDLE" | "WORKING";

export interface RunnerHeartbeatRow {
  runnerId: string;
  startedAt: number;
  lastSeenAt: number;
  status: RunnerHeartbeatStatus;
}

/** Upserted every poll tick by the standalone runner (lib/ai-office/runner/start.ts) — the one real liveness signal the dashboard can trust. */
export function upsertRunnerHeartbeat(
  db: DatabaseSync,
  input: { runnerId: string; status: RunnerHeartbeatStatus; now?: number },
): RunnerHeartbeatRow {
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO runner_heartbeats (runnerId, startedAt, lastSeenAt, status)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (runnerId) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, status = excluded.status`,
  ).run(input.runnerId, now, now, input.status);

  return db.prepare("SELECT * FROM runner_heartbeats WHERE runnerId = ?").get(input.runnerId) as unknown as RunnerHeartbeatRow;
}

/** The most recently seen heartbeat across every runner process that has ever reported in — a dashboard only needs "is *a* runner alive right now," not per-process detail. */
export function getMostRecentRunnerHeartbeat(db: DatabaseSync): RunnerHeartbeatRow | undefined {
  return db.prepare("SELECT * FROM runner_heartbeats ORDER BY lastSeenAt DESC LIMIT 1").get() as unknown as RunnerHeartbeatRow | undefined;
}
