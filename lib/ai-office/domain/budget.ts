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

/**
 * Providers that never enter the LIVE financial ledger — `'simulated'`
 * (Phase 4) and `'ollama'` (local, free inference). Every LIVE-sum query
 * below excludes both; adding a third free provider later means changing
 * this one list, not re-auditing every query.
 */
const FREE_PROVIDERS = ["simulated", "ollama"] as const;
const FREE_PROVIDERS_SQL = FREE_PROVIDERS.map((p) => `'${p}'`).join(", ");

// ---- money handling ----------------------------------------------------

/**
 * A generous but finite ceiling on any single monetary amount this
 * system will accept — $1,000,000,000.00. Nothing this system does
 * (a simulated run, a future LIVE provider call, an owner-approved cap)
 * is remotely close to this; it exists purely to catch a malformed
 * input (a units bug — cents passed where dollars were expected, a
 * corrupted/absurd value) rather than silently accepting it.
 */
export const MAX_SUPPORTED_CENTS = 100_000_000_000;

export class InvalidMoneyError extends Error {}

/**
 * Converts a USD amount to integer cents, rejecting anything that isn't
 * a small, sane, non-negative, finite number — the one place every
 * money-accepting entry point (`authorizeBudget()`, reservation
 * reconciliation, budget cap updates) validates its input, so there is
 * exactly one rule to get right, not several ad-hoc checks.
 *
 * Rejects: `NaN`, `Infinity`/`-Infinity`, negative values, and anything
 * whose cent value would exceed `MAX_SUPPORTED_CENTS` or fall outside
 * `Number.isSafeInteger` once converted. **`0` is explicitly allowed**
 * — a $0 estimate/actual cost is a legitimate value (e.g. a free-tier
 * call), not an error. Rounds to the nearest cent
 * (`Math.round(usd * 100)`, e.g. `$0.005` rounds to `$0.01`) —
 * documented here since it's the one rounding rule the whole budget
 * system relies on.
 */
export function toCentsStrict(usd: number, fieldName = "amount"): number {
  if (typeof usd !== "number" || Number.isNaN(usd) || !Number.isFinite(usd)) {
    throw new InvalidMoneyError(`${fieldName} must be a finite number, got ${usd}.`);
  }
  if (usd < 0) {
    throw new InvalidMoneyError(`${fieldName} must not be negative, got ${usd}.`);
  }
  const cents = Math.round(usd * 100);
  if (!Number.isSafeInteger(cents) || cents > MAX_SUPPORTED_CENTS) {
    throw new InvalidMoneyError(`${fieldName} is outside the supported range, got ${usd}.`);
  }
  return cents;
}

export function centsToUsd(cents: number): number {
  return cents / 100;
}

/** Thrown for a token count that isn't a small, sane, non-negative integer — the same "reject before touching the database" posture as `InvalidMoneyError`, for a different kind of accounting number. */
export class InvalidTokenCountError extends Error {}

/**
 * Validates a token count (`ai_usage.inputTokens`/`outputTokens`):
 * must be a non-negative, finite, safe integer. Unlike money, token
 * counts have no fractional/rounding concern — they're rejected outright
 * rather than coerced if they aren't already an integer.
 */
export function toSafeNonNegativeInt(value: number, fieldName = "value"): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new InvalidTokenCountError(`${fieldName} must be a finite number, got ${value}.`);
  }
  if (!Number.isInteger(value)) {
    throw new InvalidTokenCountError(`${fieldName} must be a whole number, got ${value}.`);
  }
  if (value < 0) {
    throw new InvalidTokenCountError(`${fieldName} must not be negative, got ${value}.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new InvalidTokenCountError(`${fieldName} is outside the safely representable range, got ${value}.`);
  }
  return value;
}

/**
 * Thrown when a budget reservation's persisted financial identity
 * (`projectId`, `provider`) cannot be safely tied to the execution being
 * reconciled against it — a cross-project `AgentRun`, a missing/broken
 * `AgentRun -> TaskAttempt -> Task -> Project` chain, a reservation with
 * no `projectId`, or an attempt to reconcile/authorize a `"simulated"`-
 * provider reservation through this LIVE-only financial path. Always
 * thrown *before* any mutation — see
 * `lib/ai-office/budget/budget-service.ts`'s `reconcileReservationWithUsage()`.
 */
export class ReservationIdentityError extends Error {}

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
  /** Real Anthropic prompt-cache token counts (token economics phase, Part 9) — NULL for every non-Claude row and for any Claude row from before caching was wired in. Never guessed/backfilled; see claude-adapter.ts's cache-usage handling. */
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
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
    /** Omitted (-> NULL) for every provider except Claude with real cache usage reported — never faked, never defaulted to 0 (0 would falsely claim "cache was checked and found empty"). */
    cacheCreationInputTokens?: number | null;
    cacheReadInputTokens?: number | null;
  },
): AiUsageRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO ai_usage (id, agentRunId, projectId, provider, inputTokens, outputTokens, costUsd, cacheCreationInputTokens, cacheReadInputTokens, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.agentRunId,
    input.projectId,
    input.provider,
    input.inputTokens,
    input.outputTokens,
    input.costUsd,
    input.cacheCreationInputTokens ?? null,
    input.cacheReadInputTokens ?? null,
    now,
  );
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

/** All-time (not period-scoped) simulated cost for one project — for the project detail view, which shows full history, not just the current billing month. */
export function sumSimulatedCostForProject(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(costUsd), 0) as total FROM ai_usage WHERE projectId = ? AND provider = 'simulated'")
    .get(projectId) as { total: number };
  return row.total;
}

/** All-time (not period-scoped) local (Ollama) cost for one project — always $0 by construction, tracked separately from simulated/LIVE for the same reason sumSimulatedCostForProject is: an honest number, not an assumed constant. */
export function sumLocalCostForProject(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(costUsd), 0) as total FROM ai_usage WHERE projectId = ? AND provider = 'ollama'")
    .get(projectId) as { total: number };
  return row.total;
}

/** All-time (not period-scoped) LIVE cost for one project — the number that must never be confused with `sumSimulatedCostForProject`/`sumLocalCostForProject`, per the "clearly distinguish simulated/local from LIVE" requirement. Excludes both free providers — see `FREE_PROVIDERS`. */
export function sumLiveCostForProject(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(costUsd), 0) as total FROM ai_usage WHERE projectId = ? AND provider NOT IN (${FREE_PROVIDERS_SQL})`)
    .get(projectId) as { total: number };
  return row.total;
}

/**
 * Start of the current UTC month, as a millisecond timestamp — the
 * `budget_records.periodStart` / `ai_usage` monthly-window boundary used
 * everywhere budget math happens. Moved here (out of `db/seed.ts`, which
 * now imports it) so `BudgetService` and the seed script share one
 * definition rather than two copies that could drift.
 */
export function startOfCurrentMonthUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

/**
 * LIVE-only spend — deliberately excludes `provider = 'simulated'` rows.
 * This is the one place "simulated usage must never count against the
 * LIVE budget" is enforced numerically; every other budget query in this
 * file reuses this filter rather than re-deriving it. `periodStart` is
 * inclusive; `ai_usage` has no explicit period end column, so "this
 * month" is `createdAt >= periodStart` intersected with `< nextPeriodStart`
 * (passed in by the caller, since "next month" is a calendar concern the
 * caller — `BudgetService` — already has to compute for `getOrCreate`).
 */
export function sumLiveAiUsageCostForOfficeInPeriod(db: DatabaseSync, periodStart: number, periodEndExclusive: number): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(costUsd), 0) as total FROM ai_usage WHERE provider NOT IN (${FREE_PROVIDERS_SQL}) AND createdAt >= ? AND createdAt < ?`)
    .get(periodStart, periodEndExclusive) as { total: number };
  return row.total;
}

export function sumLiveAiUsageCostForProjectInPeriod(
  db: DatabaseSync,
  projectId: string,
  periodStart: number,
  periodEndExclusive: number,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(costUsd), 0) as total FROM ai_usage WHERE provider NOT IN (${FREE_PROVIDERS_SQL}) AND projectId = ? AND createdAt >= ? AND createdAt < ?`,
    )
    .get(projectId, periodStart, periodEndExclusive) as { total: number };
  return row.total;
}

export function countSimulatedRunsForOffice(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM ai_usage WHERE provider = 'simulated'").get() as { count: number };
  return row.count;
}

export function countLocalRunsForOffice(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM ai_usage WHERE provider = 'ollama'").get() as { count: number };
  return row.count;
}

/**
 * Computed from actual `ai_usage` rows, not hardcoded to 0 — `SimulatedAdapter`
 * is *designed* to always cost $0, but the dashboard should surface the
 * real recorded number rather than assume its own precondition holds;
 * a future bug that somehow records a nonzero simulated cost should be
 * visible here, not silently hidden behind an assumed constant.
 */
export function sumSimulatedCostForOffice(db: DatabaseSync): number {
  const row = db.prepare("SELECT COALESCE(SUM(costUsd), 0) as total FROM ai_usage WHERE provider = 'simulated'").get() as { total: number };
  return row.total;
}

/** Same honesty rationale as `sumSimulatedCostForOffice` — OllamaAdapter is designed to always report $0, but this reads the real recorded total rather than assuming it. */
export function sumLocalCostForOffice(db: DatabaseSync): number {
  const row = db.prepare("SELECT COALESCE(SUM(costUsd), 0) as total FROM ai_usage WHERE provider = 'ollama'").get() as { total: number };
  return row.total;
}

/**
 * Reads the office budget record for the current period if one exists,
 * or creates it by copying the cap/warning threshold forward from the
 * most recent office record (so an owner's cap change persists across a
 * month rollover instead of silently reverting to the seeded $30
 * default). Falls back to the seeded default only if no office record
 * exists at all yet (should never happen post-seed, but defensive).
 */
export function getOrCreateOfficeBudgetRecord(db: DatabaseSync, periodStart: number): BudgetRecordRow {
  const existing = getOfficeBudgetRecord(db, periodStart);
  if (existing) return existing;

  const latest = getLatestOfficeBudgetRecord(db);
  const capUsd = latest?.capUsd ?? 30;
  const warnAtPercent = latest?.warnAtPercent ?? 80;

  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO budget_records (id, scope, scopeId, periodStart, capUsd, warnAtPercent, createdAt, updatedAt)
     VALUES (?, 'office', 'office', ?, ?, ?, ?, ?)`,
  ).run(id, periodStart, capUsd, warnAtPercent, now, now);
  return getOfficeBudgetRecord(db, periodStart) as unknown as BudgetRecordRow;
}

/**
 * Updates the office cap/warning threshold for a specific period —
 * called only after an owner-approved budget-increase decision (see
 * `lib/ai-office/approvals/approval-service.ts`), never as a direct,
 * unaudited mutation. Rolling `getOrCreateOfficeBudgetRecord`'s
 * carry-forward means a change made this month is what a future month's
 * `getOrCreateOfficeBudgetRecord` call will pick up automatically.
 */
export function updateOfficeBudgetCap(db: DatabaseSync, periodStart: number, input: { capUsd?: number; warnAtPercent?: number }): BudgetRecordRow {
  // Validated the same way any other money value is — a cap is exactly
  // as capable of being NaN/negative/absurd as an estimate is if it
  // ever comes from unchecked input.
  if (input.capUsd !== undefined) toCentsStrict(input.capUsd, "capUsd");
  if (input.warnAtPercent !== undefined) {
    if (!Number.isInteger(input.warnAtPercent) || input.warnAtPercent < 0 || input.warnAtPercent > 100) {
      throw new InvalidMoneyError(`warnAtPercent must be an integer between 0 and 100, got ${input.warnAtPercent}.`);
    }
  }

  const record = getOrCreateOfficeBudgetRecord(db, periodStart);
  db.prepare("UPDATE budget_records SET capUsd = ?, warnAtPercent = ?, updatedAt = ? WHERE id = ?").run(
    input.capUsd ?? record.capUsd,
    input.warnAtPercent ?? record.warnAtPercent,
    Date.now(),
    record.id,
  );
  return getOfficeBudgetRecord(db, periodStart) as unknown as BudgetRecordRow;
}

// ---- budget_reservations — concurrency-safe LIVE budget accounting -----

export type BudgetReservationStatus = "RESERVED" | "RECONCILED" | "RELEASED";

export interface BudgetReservationRow {
  id: string;
  projectId: string | null;
  provider: string;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  status: BudgetReservationStatus;
  periodStart: number;
  createdAt: number;
  updatedAt: number;
}

export function createBudgetReservation(
  db: DatabaseSync,
  input: { projectId: string | null; provider: string; estimatedCostUsd: number; periodStart: number },
): BudgetReservationRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO budget_reservations (id, projectId, provider, estimatedCostUsd, actualCostUsd, status, periodStart, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, 'RESERVED', ?, ?, ?)`,
  ).run(id, input.projectId, input.provider, input.estimatedCostUsd, input.periodStart, now, now);
  return getBudgetReservation(db, id) as unknown as BudgetReservationRow;
}

export function getBudgetReservation(db: DatabaseSync, id: string): BudgetReservationRow | undefined {
  return db.prepare("SELECT * FROM budget_reservations WHERE id = ?").get(id) as unknown as BudgetReservationRow | undefined;
}

/** The amount currently held against the cap by not-yet-reconciled reservations — the number that, added to actual LIVE spend, must never exceed the cap. */
export function sumReservedCostInPeriod(db: DatabaseSync, periodStart: number, periodEndExclusive: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(estimatedCostUsd), 0) as total FROM budget_reservations WHERE status = 'RESERVED' AND periodStart >= ? AND periodStart < ?",
    )
    .get(periodStart, periodEndExclusive) as { total: number };
  return row.total;
}

export function sumReservedCostForProjectInPeriod(db: DatabaseSync, projectId: string, periodStart: number, periodEndExclusive: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(estimatedCostUsd), 0) as total FROM budget_reservations WHERE status = 'RESERVED' AND projectId = ? AND periodStart >= ? AND periodStart < ?",
    )
    .get(projectId, periodStart, periodEndExclusive) as { total: number };
  return row.total;
}

/**
 * Reconciles a reservation against the real cost a completed provider
 * call actually incurred — moves it out of "reserved" (no longer counted
 * by `sumReservedCostInPeriod`) and records the real number for history.
 * Only valid from `RESERVED`; a no-op (returns the row unchanged) if
 * already reconciled/released, so a duplicate reconciliation attempt
 * can never double-count or overwrite a settled record.
 */
export function reconcileBudgetReservation(db: DatabaseSync, id: string, actualCostUsd: number): BudgetReservationRow {
  db.prepare("UPDATE budget_reservations SET status = 'RECONCILED', actualCostUsd = ?, updatedAt = ? WHERE id = ? AND status = 'RESERVED'").run(
    actualCostUsd,
    Date.now(),
    id,
  );
  return getBudgetReservation(db, id) as unknown as BudgetReservationRow;
}

/** Releases a reservation whose call never actually incurred cost (refused/failed before any provider usage occurred) — frees the held amount without recording it as spend. Only valid from `RESERVED`, same idempotency guard as reconcile. */
export function releaseBudgetReservation(db: DatabaseSync, id: string): BudgetReservationRow {
  db.prepare("UPDATE budget_reservations SET status = 'RELEASED', updatedAt = ? WHERE id = ? AND status = 'RESERVED'").run(Date.now(), id);
  return getBudgetReservation(db, id) as unknown as BudgetReservationRow;
}
