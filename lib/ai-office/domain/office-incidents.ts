import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * Office Engineer's own incident log (platform-hardening phase, Parts
 * 9-11) — persistence only, no detection/repair policy here. One row
 * per detected platform-health incident, independent of a project's own
 * task DAG (this agent is not a project role).
 */

export type OfficeIncidentStatus = "WATCHING" | "INVESTIGATING" | "REPAIRING" | "VERIFYING" | "ESCALATED" | "RESOLVED";

export interface OfficeIncidentRow {
  id: string;
  status: OfficeIncidentStatus;
  symptom: string;
  projectId: string | null;
  taskId: string | null;
  diagnosis: string | null;
  repairAction: string | null;
  repairProvider: string | null;
  repairCostUsd: number | null;
  retryResult: string | null;
  detectedAt: number;
  resolvedAt: number | null;
  updatedAt: number;
}

export function createIncident(
  db: DatabaseSync,
  input: { symptom: string; projectId?: string | null; taskId?: string | null; diagnosis?: string | null; status?: OfficeIncidentStatus },
): OfficeIncidentRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO office_incidents (id, status, symptom, projectId, taskId, diagnosis, repairAction, repairProvider, repairCostUsd, retryResult, detectedAt, resolvedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, ?)`,
  ).run(id, input.status ?? "WATCHING", input.symptom, input.projectId ?? null, input.taskId ?? null, input.diagnosis ?? null, now, now);
  return getIncident(db, id)!;
}

export function getIncident(db: DatabaseSync, id: string): OfficeIncidentRow | undefined {
  return db.prepare("SELECT * FROM office_incidents WHERE id = ?").get(id) as unknown as OfficeIncidentRow | undefined;
}

export function updateIncident(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<OfficeIncidentRow, "status" | "diagnosis" | "repairAction" | "repairProvider" | "repairCostUsd" | "retryResult" | "resolvedAt">>,
): OfficeIncidentRow {
  const current = getIncident(db, id);
  if (!current) throw new Error(`Office incident ${id} does not exist.`);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  db.prepare(
    `UPDATE office_incidents SET status = ?, diagnosis = ?, repairAction = ?, repairProvider = ?, repairCostUsd = ?, retryResult = ?, resolvedAt = ?, updatedAt = ?
     WHERE id = ?`,
  ).run(next.status, next.diagnosis, next.repairAction, next.repairProvider, next.repairCostUsd, next.retryResult, next.resolvedAt, next.updatedAt, id);
  return getIncident(db, id)!;
}

/** Open (not yet RESOLVED) incidents, most recently detected first. */
export function listOpenIncidents(db: DatabaseSync): OfficeIncidentRow[] {
  return db.prepare("SELECT * FROM office_incidents WHERE status != 'RESOLVED' ORDER BY detectedAt DESC").all() as unknown as OfficeIncidentRow[];
}

/** Full incident history, most recent first — capped so a long-lived office's UI never has to page through an unbounded table. */
export function listRecentIncidents(db: DatabaseSync, limit = 50): OfficeIncidentRow[] {
  return db.prepare("SELECT * FROM office_incidents ORDER BY detectedAt DESC LIMIT ?").all(limit) as unknown as OfficeIncidentRow[];
}

/** An incident already open for this exact (projectId, taskId, symptom) triple, if any — the detector's own de-duplication guard, so re-running health checks every runner cycle never spams duplicate incidents for a still-unresolved problem. */
export function findOpenIncidentFor(db: DatabaseSync, input: { projectId: string | null; taskId: string | null; symptom: string }): OfficeIncidentRow | undefined {
  return db
    .prepare(
      `SELECT * FROM office_incidents
       WHERE status != 'RESOLVED' AND symptom = ?
         AND ((projectId IS NULL AND ? IS NULL) OR projectId = ?)
         AND ((taskId IS NULL AND ? IS NULL) OR taskId = ?)
       ORDER BY detectedAt DESC LIMIT 1`,
    )
    .get(input.symptom, input.projectId, input.projectId, input.taskId, input.taskId) as unknown as OfficeIncidentRow | undefined;
}

/**
 * The most recent incident for this exact (projectId, taskId, symptom)
 * triple, REGARDLESS of status — unlike `findOpenIncidentFor`, this also
 * matches an ESCALATED or RESOLVED one. Used by callers that track ONE
 * incident lineage per task/symptom across its whole repair history
 * (Office Engineer's semantic-repair capability): a task that develops a
 * genuinely NEW problem after its prior incident reached a terminal
 * state should reopen and continue that SAME incident's history rather
 * than fragmenting into a fresh, disconnected row — see
 * semantic-repair-execution.ts's incident-reopening logic for why this
 * distinction matters (a real defect: an incident silently stayed
 * ESCALATED while a fresh PROPOSED repair plan sat active underneath it).
 */
export function findLatestIncidentFor(db: DatabaseSync, input: { projectId: string | null; taskId: string | null; symptom: string }): OfficeIncidentRow | undefined {
  return db
    .prepare(
      `SELECT * FROM office_incidents
       WHERE symptom = ?
         AND ((projectId IS NULL AND ? IS NULL) OR projectId = ?)
         AND ((taskId IS NULL AND ? IS NULL) OR taskId = ?)
       ORDER BY detectedAt DESC LIMIT 1`,
    )
    .get(input.symptom, input.projectId, input.projectId, input.taskId, input.taskId) as unknown as OfficeIncidentRow | undefined;
}
