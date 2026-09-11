import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * budget_records + ai_usage repositories — storage/query only. No spend
 * enforcement here (`BudgetService.authorize()` is Phase 6, see
 * docs/ai-office/09-budget-and-cost-controls.md §2). The office-level
 * $30/month default row is seeded by lib/ai-office/db/seed.ts; this file
 * is for reading it back and for future per-project budget rows.
 */

export type BudgetScope = "office" | "project";

export interface BudgetRecordRow {
  id: string;
  scope: BudgetScope;
  scopeId: string; // 'office' sentinel for scope='office' — see the migration's comment
  periodStart: number;
  capUsd: number;
  warnAtPercent: number;
  createdAt: number;
  updatedAt: number;
}

export interface AiUsageRow {
  id: string;
  agentRunId: string;
  projectId: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: number;
}

export function getOfficeBudgetRecord(db: DatabaseSync, periodStart: number): BudgetRecordRow | undefined {
  return db
    .prepare("SELECT * FROM budget_records WHERE scope = 'office' AND scopeId = 'office' AND periodStart = ?")
    .get(periodStart) as unknown as BudgetRecordRow | undefined;
}

export function getLatestOfficeBudgetRecord(db: DatabaseSync): BudgetRecordRow | undefined {
  return db
    .prepare("SELECT * FROM budget_records WHERE scope = 'office' ORDER BY periodStart DESC LIMIT 1")
    .get() as unknown as BudgetRecordRow | undefined;
}

export function createProjectBudgetRecord(
  db: DatabaseSync,
  input: { projectId: string; periodStart: number; capUsd: number; warnAtPercent?: number },
): BudgetRecordRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO budget_records (id, scope, scopeId, periodStart, capUsd, warnAtPercent, createdAt, updatedAt)
     VALUES (?, 'project', ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.periodStart, input.capUsd, input.warnAtPercent ?? 80, now, now);
  return db.prepare("SELECT * FROM budget_records WHERE id = ?").get(id) as unknown as BudgetRecordRow;
}

export function recordAiUsage(
  db: DatabaseSync,
  input: {
    agentRunId: string;
    projectId: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  },
): AiUsageRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO ai_usage (id, agentRunId, projectId, provider, inputTokens, outputTokens, costUsd, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.agentRunId, input.projectId, input.provider, input.inputTokens, input.outputTokens, input.costUsd, now);
  return db.prepare("SELECT * FROM ai_usage WHERE id = ?").get(id) as unknown as AiUsageRow;
}

export function listAiUsageForProject(db: DatabaseSync, projectId: string): AiUsageRow[] {
  return db.prepare("SELECT * FROM ai_usage WHERE projectId = ? ORDER BY createdAt").all(projectId) as unknown as AiUsageRow[];
}

export function sumAiUsageCostForProject(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(costUsd), 0) as total FROM ai_usage WHERE projectId = ?")
    .get(projectId) as { total: number };
  return row.total;
}
