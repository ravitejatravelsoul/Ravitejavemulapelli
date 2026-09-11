import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getProject } from "../domain/projects.ts";
import {
  startOfCurrentMonthUtc,
  getOrCreateOfficeBudgetRecord,
  sumLiveAiUsageCostForOfficeInPeriod,
  sumLiveAiUsageCostForProjectInPeriod,
  sumReservedCostInPeriod,
  sumReservedCostForProjectInPeriod,
  countSimulatedRunsForOffice,
  sumSimulatedCostForOffice,
  createBudgetReservation,
  reconcileBudgetReservation,
  releaseBudgetReservation,
  type BudgetRecordRow,
} from "../domain/budget.ts";

/**
 * The authoritative Phase 6 budget gate — "authoritative" meaning: this
 * is the function any future LIVE provider call (Phase 7+) must pass
 * through before spending anything, per
 * docs/ai-office/09-budget-and-cost-controls.md §2 and the Phase 5/6
 * "single provider entry point" rule
 * (`lib/ai-office/agents/__tests__/import-boundary.test.ts`). No live
 * provider exists yet in Phase 6 — this module is exercised entirely
 * through synthetic test doubles (see `__tests__/budget-service.test.ts`),
 * never a real network call.
 *
 * **Simulated usage is invisible to every number in this file** —
 * `provider = 'simulated'` rows are excluded at the SQL layer
 * (`lib/ai-office/domain/budget.ts`'s `sumLiveAiUsageCostFor*`), not
 * filtered here, so there is exactly one place that rule can ever be
 * wrong, not several.
 *
 * **Money is handled in integer cents internally** — `costUsd`/`capUsd`
 * are stored as `REAL` (the existing, immutable schema), but every
 * comparison in `authorizeBudget()` converts to cents first
 * (`toCents()`) so cap/spend/reservation arithmetic never accumulates
 * floating-point drift across many small additions. Values are
 * converted back to dollars only for the result object callers see.
 */

export type BudgetAuthorizationStatus = "AUTHORIZED" | "WARNING" | "BLOCKED_MONTHLY_CAP" | "BLOCKED_PROJECT_CAP" | "APPROVAL_REQUIRED";

export interface AuthorizeBudgetInput {
  projectId: string;
  taskId?: string;
  provider: string;
  estimatedCostUsd: number;
}

export interface BudgetAuthorizationResult {
  status: BudgetAuthorizationStatus;
  reason?: string;
  /** Set only when status is AUTHORIZED or WARNING — a `budget_reservations` row was created and must later be reconciled or released. */
  reservationId?: string;
  officeRemainingUsd: number;
  projectRemainingUsd?: number;
}

function toCents(usd: number): number {
  return Math.round(usd * 100);
}
function toUsd(cents: number): number {
  return cents / 100;
}

function startOfNextMonthUtc(periodStart: number): number {
  const d = new Date(periodStart);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * A PENDING approval already scoped to this project (or this exact task,
 * if one is given) takes priority over cap math entirely — the request
 * isn't refused because of money, it's refused because the owner hasn't
 * decided yet. Exact-scope, same rule as `eligibility.ts`: a
 * project-wide (`taskId IS NULL`) approval blocks everything in the
 * project; a task-scoped one blocks only that task.
 */
function findBlockingApproval(db: DatabaseSync, projectId: string, taskId?: string): { id: string } | undefined {
  return db
    .prepare(
      `SELECT id FROM approvals WHERE projectId = ? AND status = 'PENDING' AND (taskId IS NULL OR taskId = ?) LIMIT 1`,
    )
    .get(projectId, taskId ?? null) as { id: string } | undefined;
}

export function authorizeBudget(db: DatabaseSync, input: AuthorizeBudgetInput): BudgetAuthorizationResult {
  const periodStart = startOfCurrentMonthUtc();
  const periodEnd = startOfNextMonthUtc(periodStart);

  const project = getProject(db, input.projectId);
  if (!project) {
    return { status: "BLOCKED_PROJECT_CAP", reason: "Project not found.", officeRemainingUsd: 0 };
  }

  const blockingApproval = findBlockingApproval(db, input.projectId, input.taskId);
  const officeBudget = getOrCreateOfficeBudgetRecord(db, periodStart);
  const officeSpentCents = toCents(sumLiveAiUsageCostForOfficeInPeriod(db, periodStart, periodEnd));
  const officeReservedCents = toCents(sumReservedCostInPeriod(db, periodStart, periodEnd));
  const officeCommittedCents = officeSpentCents + officeReservedCents;
  const officeCapCents = toCents(officeBudget.capUsd);
  const estimatedCents = toCents(input.estimatedCostUsd);
  const officeRemainingUsd = toUsd(Math.max(0, officeCapCents - officeCommittedCents));

  let projectCapCents: number | undefined;
  let projectCommittedCents: number | undefined;
  let projectRemainingUsd: number | undefined;
  if (project.monthlyBudgetCapUsd != null) {
    const projectSpentCents = toCents(sumLiveAiUsageCostForProjectInPeriod(db, input.projectId, periodStart, periodEnd));
    const projectReservedCents = toCents(sumReservedCostForProjectInPeriod(db, input.projectId, periodStart, periodEnd));
    projectCommittedCents = projectSpentCents + projectReservedCents;
    projectCapCents = toCents(project.monthlyBudgetCapUsd);
    projectRemainingUsd = toUsd(Math.max(0, projectCapCents - projectCommittedCents));
  }

  if (blockingApproval) {
    return {
      status: "APPROVAL_REQUIRED",
      reason: "This project has a pending owner approval that must be decided before any LIVE spend can proceed.",
      officeRemainingUsd,
      projectRemainingUsd,
    };
  }

  // Project cap checked first — it's the more specific constraint; a
  // project deliberately given a tighter allowance should never be
  // allowed to spend past it just because office-wide room remains.
  if (projectCapCents !== undefined && projectCommittedCents !== undefined && projectCommittedCents + estimatedCents > projectCapCents) {
    return {
      status: "BLOCKED_PROJECT_CAP",
      reason: `This request (${input.estimatedCostUsd.toFixed(2)}) would exceed the project's monthly cap of $${project.monthlyBudgetCapUsd!.toFixed(2)}.`,
      officeRemainingUsd,
      projectRemainingUsd,
    };
  }

  if (officeCommittedCents + estimatedCents > officeCapCents) {
    return {
      status: "BLOCKED_MONTHLY_CAP",
      reason: `This request ($${input.estimatedCostUsd.toFixed(2)}) would exceed the office's monthly cap of $${officeBudget.capUsd.toFixed(2)}.`,
      officeRemainingUsd,
      projectRemainingUsd,
    };
  }

  // No overage — reserve the estimate atomically with this decision (a
  // single synchronous INSERT; see the module docblock on why Node's
  // single-threaded, fully-synchronous execution here already makes
  // this race-safe without an explicit transaction wrapper) so the next
  // concurrent authorization call sees this amount as committed even
  // before any real usage is recorded.
  const reservation = createBudgetReservation(db, {
    projectId: input.projectId,
    provider: input.provider,
    estimatedCostUsd: input.estimatedCostUsd,
    periodStart,
  });

  const warnThresholdCents = Math.ceil((officeCapCents * officeBudget.warnAtPercent) / 100);
  const isWarning = officeCommittedCents + estimatedCents >= warnThresholdCents;

  return {
    status: isWarning ? "WARNING" : "AUTHORIZED",
    reservationId: reservation.id,
    officeRemainingUsd: toUsd(Math.max(0, officeCapCents - (officeCommittedCents + estimatedCents))),
    projectRemainingUsd:
      projectCapCents !== undefined && projectCommittedCents !== undefined
        ? toUsd(Math.max(0, projectCapCents - (projectCommittedCents + estimatedCents)))
        : undefined,
  };
}

/** Reconciles a reservation against the real cost once a (future, Phase 7+) provider call actually completes. */
export function reconcileReservation(db: DatabaseSync, reservationId: string, actualCostUsd: number) {
  return reconcileBudgetReservation(db, reservationId, actualCostUsd);
}

/** Releases a reservation whose call never incurred real cost (refused/failed before any provider usage occurred) — the held amount is freed without being recorded as spend. */
export function releaseReservation(db: DatabaseSync, reservationId: string) {
  return releaseBudgetReservation(db, reservationId);
}

export interface BudgetSnapshot {
  periodStart: number;
  capUsd: number;
  warnAtPercent: number;
  liveSpendUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  simulatedRuns: number;
  simulatedCostUsd: number;
  status: "SAFE" | "WARNING" | "AT_CAP";
}

/** Read-only snapshot for the dashboard's Budget panel — no side effects, safe to call on every page render. */
export function getBudgetSnapshot(db: DatabaseSync): BudgetSnapshot {
  const periodStart = startOfCurrentMonthUtc();
  const periodEnd = startOfNextMonthUtc(periodStart);
  const record: BudgetRecordRow = getOrCreateOfficeBudgetRecord(db, periodStart);

  const liveSpendUsd = sumLiveAiUsageCostForOfficeInPeriod(db, periodStart, periodEnd);
  const reservedUsd = sumReservedCostInPeriod(db, periodStart, periodEnd);
  const committedCents = toCents(liveSpendUsd) + toCents(reservedUsd);
  const capCents = toCents(record.capUsd);
  const remainingUsd = toUsd(Math.max(0, capCents - committedCents));
  const warnThresholdCents = Math.ceil((capCents * record.warnAtPercent) / 100);

  const status: BudgetSnapshot["status"] = committedCents >= capCents ? "AT_CAP" : committedCents >= warnThresholdCents ? "WARNING" : "SAFE";

  return {
    periodStart,
    capUsd: record.capUsd,
    warnAtPercent: record.warnAtPercent,
    liveSpendUsd,
    reservedUsd,
    remainingUsd,
    simulatedRuns: countSimulatedRunsForOffice(db),
    simulatedCostUsd: sumSimulatedCostForOffice(db),
    status,
  };
}
