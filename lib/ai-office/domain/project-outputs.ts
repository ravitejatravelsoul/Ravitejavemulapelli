import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * project_decisions + artifacts + test_results + failures + approvals —
 * the project "deliverable and review" tables, grouped in one file since
 * each is a small, independent, single-table repository. Persistence
 * only: no orchestration logic decides *when* an artifact/decision/
 * approval gets created — that's Phase 5+.
 */

export type DecisionType = "decision" | "assumption";
export type ArtifactType =
  | "requirements"
  | "architecture"
  | "ux-spec"
  | "code"
  | "test-report"
  | "security-report"
  | "review-notes"
  | "release-summary"
  | "research-notes";
export type TestResultStatus = "PASS" | "FAIL";
export type ApprovalKind =
  | "production_deploy"
  | "paid_service_purchase"
  | "budget_increase"
  | "destructive_db_action"
  | "repository_deletion"
  | "major_architecture_replacement"
  | "external_account_creation"
  | "secrets_access"
  | "production_credentials"
  | "irreversible_operation";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ProjectDecisionRow {
  id: string;
  projectId: string;
  type: DecisionType;
  summary: string;
  rationale: string | null;
  madeBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactRow {
  id: string;
  projectId: string;
  taskId: string | null;
  type: ArtifactType;
  content: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface TestResultRow {
  id: string;
  projectId: string;
  taskId: string;
  status: TestResultStatus;
  summary: string;
  details: string | null;
  durationMs: number | null;
  targetUrl: string | null;
  createdAt: number;
}

export interface FailureRow {
  id: string;
  projectId: string;
  taskId: string;
  agentRunId: string | null;
  reason: string;
  resolved: 0 | 1;
  /** Set only via markFailureSuperseded — a SEPARATE concept from `resolved` (see migration 014's docblock): the underlying platform defect that produced this failure has since been fixed, independent of whether this exact task was ever retried. The row itself is never edited otherwise or deleted. */
  supersededAt: number | null;
  supersededReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalRow {
  id: string;
  projectId: string | null;
  /** NULL = blocks the whole project (Phase 5's original idea-level behavior); set = blocks exactly this one task, leaving the rest of the project's tasks eligible. See eligibility.ts. */
  taskId: string | null;
  kind: ApprovalKind;
  status: ApprovalStatus;
  requestedBy: string;
  context: string; // JSON
  decidedAt: number | null;
  decidedBy: string | null;
  decisionNote: string | null;
  /** Set only when an APPROVED decision was later revoked — see `revokeApproval()` in approval-service.ts. `decidedAt`/`decidedBy`/`decisionNote` are never touched by a revocation; they always keep recording the original decision. */
  revokedAt: number | null;
  revokedBy: string | null;
  revocationNote: string | null;
  createdAt: number;
  updatedAt: number;
}

/** The status an owner should actually see — `ApprovalStatus` alone can't distinguish a revoked approval from an original owner rejection (both are stored as the same raw `'REJECTED'`, deliberately — see migration 010's docblock for why the schema itself was never widened with a real 'REVOKED' enum value). Every UI/report surface should read status through this, never `approval.status` directly, once an approval might have been revoked. */
export type EffectiveApprovalStatus = ApprovalStatus | "REVOKED";

export function getEffectiveApprovalStatus(approval: Pick<ApprovalRow, "status" | "revokedAt">): EffectiveApprovalStatus {
  return approval.status === "REJECTED" && approval.revokedAt != null ? "REVOKED" : approval.status;
}

// ---- project_decisions ------------------------------------------------

export function recordDecision(
  db: DatabaseSync,
  input: { projectId: string; type: DecisionType; summary: string; rationale?: string; madeBy: string },
): ProjectDecisionRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO project_decisions (id, projectId, type, summary, rationale, madeBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.type, input.summary, input.rationale ?? null, input.madeBy, now, now);
  return db.prepare("SELECT * FROM project_decisions WHERE id = ?").get(id) as unknown as ProjectDecisionRow;
}

export function listDecisionsForProject(db: DatabaseSync, projectId: string): ProjectDecisionRow[] {
  return db
    .prepare("SELECT * FROM project_decisions WHERE projectId = ? ORDER BY createdAt")
    .all(projectId) as unknown as ProjectDecisionRow[];
}

// ---- artifacts ----------------------------------------------------------

export function createArtifact(
  db: DatabaseSync,
  input: { projectId: string; taskId?: string; type: ArtifactType; content: string; version?: number },
): ArtifactRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO artifacts (id, projectId, taskId, type, content, version, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.taskId ?? null, input.type, input.content, input.version ?? 1, now, now);
  return getArtifact(db, id) as unknown as ArtifactRow;
}

export function getArtifact(db: DatabaseSync, id: string): ArtifactRow | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as unknown as ArtifactRow | undefined;
}

export function listArtifactsForProject(db: DatabaseSync, projectId: string): ArtifactRow[] {
  return db.prepare("SELECT * FROM artifacts WHERE projectId = ? ORDER BY createdAt").all(projectId) as unknown as ArtifactRow[];
}

// ---- test_results ---------------------------------------------------------

export function recordTestResult(
  db: DatabaseSync,
  input: {
    projectId: string;
    taskId: string;
    status: TestResultStatus;
    summary: string;
    details?: Record<string, unknown>;
    durationMs?: number;
    targetUrl?: string;
  },
): TestResultRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO test_results (id, projectId, taskId, status, summary, details, durationMs, targetUrl, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.taskId,
    input.status,
    input.summary,
    input.details ? JSON.stringify(input.details) : null,
    input.durationMs ?? null,
    input.targetUrl ?? null,
    now,
  );
  return db.prepare("SELECT * FROM test_results WHERE id = ?").get(id) as unknown as TestResultRow;
}

export function listTestResultsForTask(db: DatabaseSync, taskId: string): TestResultRow[] {
  return db.prepare("SELECT * FROM test_results WHERE taskId = ? ORDER BY createdAt").all(taskId) as unknown as TestResultRow[];
}

// ---- failures -------------------------------------------------------------

export function recordFailure(
  db: DatabaseSync,
  input: { projectId: string; taskId: string; agentRunId?: string; reason: string },
): FailureRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO failures (id, projectId, taskId, agentRunId, reason, resolved, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, input.projectId, input.taskId, input.agentRunId ?? null, input.reason, now, now);
  return db.prepare("SELECT * FROM failures WHERE id = ?").get(id) as unknown as FailureRow;
}

export function resolveFailure(db: DatabaseSync, id: string): FailureRow {
  db.prepare("UPDATE failures SET resolved = 1, updatedAt = ? WHERE id = ?").run(Date.now(), id);
  return db.prepare("SELECT * FROM failures WHERE id = ?").get(id) as unknown as FailureRow;
}

/**
 * Marks a failure as superseded — a SEPARATE concept from `resolveFailure`
 * (see migration 014's docblock): the PLATFORM defect that produced this
 * failure has since been fixed, independent of whether this exact task
 * was ever retried. The row's `reason`/`resolved`/every other field is
 * left completely untouched — full history preserved, never deleted or
 * rewritten, only annotated. Safe to call more than once (idempotent).
 */
export function markFailureSuperseded(db: DatabaseSync, id: string, reason: string): FailureRow {
  db.prepare("UPDATE failures SET supersededAt = ?, supersededReason = ?, updatedAt = ? WHERE id = ? AND supersededAt IS NULL").run(
    Date.now(),
    reason,
    Date.now(),
    id,
  );
  return db.prepare("SELECT * FROM failures WHERE id = ?").get(id) as unknown as FailureRow;
}

export function listUnresolvedFailures(db: DatabaseSync, projectId: string): FailureRow[] {
  return db
    .prepare("SELECT * FROM failures WHERE projectId = ? AND resolved = 0 ORDER BY createdAt")
    .all(projectId) as unknown as FailureRow[];
}

/** Full failure history for one task — resolved and unresolved — oldest first. Living AI Office UI transformation, Part 11: the Agent Room's Progress tab needs a real retry timeline, not just what's currently blocking. */
export function listFailuresForTask(db: DatabaseSync, taskId: string): FailureRow[] {
  return db.prepare("SELECT * FROM failures WHERE taskId = ? ORDER BY createdAt").all(taskId) as unknown as FailureRow[];
}

// ---- approvals --------------------------------------------------------------

export function createApproval(
  db: DatabaseSync,
  input: { projectId?: string; taskId?: string; kind: ApprovalKind; requestedBy: string; context: Record<string, unknown> },
): ApprovalRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO approvals (id, projectId, taskId, kind, status, requestedBy, context, decidedAt, decidedBy, decisionNote, revokedAt, revokedBy, revocationNote, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'PENDING', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(id, input.projectId ?? null, input.taskId ?? null, input.kind, input.requestedBy, JSON.stringify(input.context), now, now);
  return getApproval(db, id) as unknown as ApprovalRow;
}

export function getApproval(db: DatabaseSync, id: string): ApprovalRow | undefined {
  return db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as unknown as ApprovalRow | undefined;
}

/**
 * Decides a PENDING approval. The `WHERE status = 'PENDING'` guard makes
 * this idempotent-safe against a double-decision race: a second call
 * against an already-decided row updates zero rows and simply returns
 * the (unchanged) row as it already stood — callers that need to know
 * whether *this* call was the one that actually decided it should check
 * the returned row's `status`/`decidedBy` against what they expected,
 * not assume success from the call not throwing.
 */
export function decideApproval(
  db: DatabaseSync,
  id: string,
  decision: "APPROVED" | "REJECTED",
  options: { decidedBy?: string; note?: string } = {},
): ApprovalRow {
  db.prepare(
    "UPDATE approvals SET status = ?, decidedAt = ?, decidedBy = ?, decisionNote = ?, updatedAt = ? WHERE id = ? AND status = 'PENDING'",
  ).run(decision, Date.now(), options.decidedBy ?? null, options.note ?? null, Date.now(), id);
  return getApproval(db, id) as unknown as ApprovalRow;
}

export function listPendingApprovals(db: DatabaseSync): ApprovalRow[] {
  return db.prepare("SELECT * FROM approvals WHERE status = 'PENDING' ORDER BY createdAt").all() as unknown as ApprovalRow[];
}

export function listPendingApprovalsForProject(db: DatabaseSync, projectId: string): ApprovalRow[] {
  return db
    .prepare("SELECT * FROM approvals WHERE status = 'PENDING' AND projectId = ? ORDER BY createdAt")
    .all(projectId) as unknown as ApprovalRow[];
}

export function listApprovalsForProject(db: DatabaseSync, projectId: string): ApprovalRow[] {
  return db.prepare("SELECT * FROM approvals WHERE projectId = ? ORDER BY createdAt DESC").all(projectId) as unknown as ApprovalRow[];
}
