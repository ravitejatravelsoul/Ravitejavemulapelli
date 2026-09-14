import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * Persistence for Office Engineer's semantic-repair capability — see
 * migration 013's docblock for why this is a standalone table rather
 * than an extension of office_incidents. No detection/classification/
 * repair policy here, same separation as office-incidents.ts.
 */

export type SemanticRepairClassification = "IMPLEMENTATION_WRONG" | "ARCHITECTURE_STALE" | "BOTH_INCONSISTENT" | "OWNER_CLARIFICATION_REQUIRED";
export type SemanticRepairStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "REPAIRING" | "APPLIED" | "VERIFIED" | "ESCALATED";

export interface RepairPlan {
  classification: SemanticRepairClassification;
  rootCause: string;
  authoritativeContract: string;
  affectedFiles: string[];
  requiredChanges: string[];
  mustPreserve: string[];
  verification: string[];
}

export interface SemanticRepairPlanRow {
  id: string;
  incidentId: string;
  projectId: string;
  taskId: string;
  roleId: string;
  failureSignature: string;
  classification: SemanticRepairClassification;
  rootCause: string;
  authoritativeContract: string;
  affectedFiles: string[];
  requiredChanges: string[];
  mustPreserve: string[];
  verification: string[];
  status: SemanticRepairStatus;
  estimatedRepairCostUsd: number | null;
  actualRepairCostUsd: number | null;
  repairProvider: string | null;
  repairResult: string | null;
  architectureApprovalId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface SemanticRepairPlanDbRow {
  id: string;
  incidentId: string;
  projectId: string;
  taskId: string;
  roleId: string;
  failureSignature: string;
  classification: SemanticRepairClassification;
  rootCause: string;
  authoritativeContract: string;
  affectedFiles: string;
  requiredChanges: string;
  mustPreserve: string;
  verification: string;
  status: SemanticRepairStatus;
  estimatedRepairCostUsd: number | null;
  actualRepairCostUsd: number | null;
  repairProvider: string | null;
  repairResult: string | null;
  architectureApprovalId: string | null;
  createdAt: number;
  updatedAt: number;
}

function fromDbRow(row: SemanticRepairPlanDbRow): SemanticRepairPlanRow {
  return {
    ...row,
    affectedFiles: JSON.parse(row.affectedFiles),
    requiredChanges: JSON.parse(row.requiredChanges),
    mustPreserve: JSON.parse(row.mustPreserve),
    verification: JSON.parse(row.verification),
  };
}

export function createSemanticRepairPlan(
  db: DatabaseSync,
  input: {
    incidentId: string;
    projectId: string;
    taskId: string;
    roleId: string;
    failureSignature: string;
    plan: RepairPlan;
    estimatedRepairCostUsd?: number | null;
    architectureApprovalId?: string | null;
  },
): SemanticRepairPlanRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO semantic_repair_plans
       (id, incidentId, projectId, taskId, roleId, failureSignature, classification, rootCause, authoritativeContract,
        affectedFiles, requiredChanges, mustPreserve, verification, status, estimatedRepairCostUsd, actualRepairCostUsd,
        repairProvider, repairResult, architectureApprovalId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, NULL, NULL, NULL, ?, ?, ?)`,
  ).run(
    id,
    input.incidentId,
    input.projectId,
    input.taskId,
    input.roleId,
    input.failureSignature,
    input.plan.classification,
    input.plan.rootCause,
    input.plan.authoritativeContract,
    JSON.stringify(input.plan.affectedFiles),
    JSON.stringify(input.plan.requiredChanges),
    JSON.stringify(input.plan.mustPreserve),
    JSON.stringify(input.plan.verification),
    input.estimatedRepairCostUsd ?? null,
    input.architectureApprovalId ?? null,
    now,
    now,
  );
  return getSemanticRepairPlan(db, id)!;
}

export function getSemanticRepairPlan(db: DatabaseSync, id: string): SemanticRepairPlanRow | undefined {
  const row = db.prepare("SELECT * FROM semantic_repair_plans WHERE id = ?").get(id) as unknown as SemanticRepairPlanDbRow | undefined;
  return row ? fromDbRow(row) : undefined;
}

export function updateSemanticRepairPlan(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<SemanticRepairPlanRow, "status" | "estimatedRepairCostUsd" | "actualRepairCostUsd" | "repairProvider" | "repairResult" | "architectureApprovalId">>,
): SemanticRepairPlanRow {
  const current = getSemanticRepairPlan(db, id);
  if (!current) throw new Error(`Semantic repair plan ${id} does not exist.`);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  db.prepare(
    `UPDATE semantic_repair_plans
       SET status = ?, estimatedRepairCostUsd = ?, actualRepairCostUsd = ?, repairProvider = ?, repairResult = ?, architectureApprovalId = ?, updatedAt = ?
     WHERE id = ?`,
  ).run(next.status, next.estimatedRepairCostUsd, next.actualRepairCostUsd, next.repairProvider, next.repairResult, next.architectureApprovalId, next.updatedAt, id);
  return getSemanticRepairPlan(db, id)!;
}

/** Every plan ever created for this task, most recent first — used to find a prior plan for the SAME failure signature (dedup/bounded-retry) and to render a task's full repair history in the UI. */
export function listSemanticRepairPlansForTask(db: DatabaseSync, taskId: string): SemanticRepairPlanRow[] {
  const rows = db.prepare("SELECT * FROM semantic_repair_plans WHERE taskId = ? ORDER BY createdAt DESC").all(taskId) as unknown as SemanticRepairPlanDbRow[];
  return rows.map(fromDbRow);
}

/** The most recent plan for this exact (taskId, failureSignature) pair, if any — the dedup guard: a repeat of a signature that already has a plan must never spawn a second, independent repair cycle. */
export function findLatestPlanForSignature(db: DatabaseSync, taskId: string, failureSignature: string): SemanticRepairPlanRow | undefined {
  const row = db
    .prepare("SELECT * FROM semantic_repair_plans WHERE taskId = ? AND failureSignature = ? ORDER BY createdAt DESC LIMIT 1")
    .get(taskId, failureSignature) as unknown as SemanticRepairPlanDbRow | undefined;
  return row ? fromDbRow(row) : undefined;
}

export function listRecentSemanticRepairPlans(db: DatabaseSync, limit = 50): SemanticRepairPlanRow[] {
  const rows = db.prepare("SELECT * FROM semantic_repair_plans ORDER BY createdAt DESC LIMIT ?").all(limit) as unknown as SemanticRepairPlanDbRow[];
  return rows.map(fromDbRow);
}
