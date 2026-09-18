import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getProject } from "../domain/projects.ts";
import { getAgentRun, resolveProjectIdForAgentRun } from "../domain/tasks.ts";
import { recordEvent, recordAuditEntry } from "../domain/events.ts";
import {
  startOfCurrentMonthUtc,
  getOrCreateOfficeBudgetRecord,
  sumLiveAiUsageCostForOfficeInPeriod,
  sumLiveAiUsageCostForProjectInPeriod,
  sumReservedCostInPeriod,
  sumReservedCostForProjectInPeriod,
  countSimulatedRunsForOffice,
  sumSimulatedCostForOffice,
  countLocalRunsForOffice,
  sumLocalCostForOffice,
  countFreeApiRunsForOffice,
  sumFreeApiCostForOffice,
  createBudgetReservation,
  getBudgetReservation,
  reconcileBudgetReservation,
  releaseBudgetReservation,
  recordAiUsage,
  toCentsStrict,
  centsToUsd,
  toSafeNonNegativeInt,
  ReservationIdentityError,
  type BudgetRecordRow,
  type BudgetReservationRow,
  type AiUsageRow,
} from "../domain/budget.ts";

/** `SimulatedAdapter` work never enters this financial ledger at all — see the module docblock's "Simulated-provider policy" note. */
const SIMULATED_PROVIDER = "simulated";

/**
 * The authoritative Phase 6/7 budget gate — "authoritative" meaning:
 * this is the function any future LIVE provider call must pass through
 * before spending anything, per
 * docs/ai-office/09-budget-and-cost-controls.md §2. No live provider
 * exists yet — this module is exercised entirely through synthetic test
 * doubles (see `__tests__/budget-service.test.ts`), never a real network
 * call.
 *
 * **Atomicity — the actual point of this correction.** `authorizeBudget()`
 * wraps its entire read-check-reserve sequence in one `BEGIN
 * IMMEDIATE` ... `COMMIT` transaction. `BEGIN IMMEDIATE` acquires
 * SQLite's write lock *before* any statement inside the transaction
 * runs (unlike a deferred `BEGIN`, which only upgrades to a write lock
 * at the first write, after any reads have already taken a
 * now-possibly-stale snapshot) — so a second, fully independent
 * `DatabaseSync` connection attempting the same thing genuinely blocks
 * (via `PRAGMA busy_timeout`, set in `db/client.ts`'s `openDatabase()`)
 * until the first connection's transaction commits or rolls back, then
 * proceeds against the now-current, correct committed total. This is
 * true across two connections in the same process, two worker threads,
 * or two separate OS processes (the real Phase 5 multi-runner
 * architecture) identically — the guarantee comes from SQLite's own
 * locking, not from anything about Node's single-threadedness. Verified
 * empirically and by a genuine two-worker-thread test (not two
 * sequential calls on one connection, and not two calls on the same
 * connection) in `__tests__/budget-service.test.ts`'s "real concurrency"
 * suite.
 *
 * **Money** is validated and converted to integer cents at the door
 * (`toCentsStrict()`, `lib/ai-office/domain/budget.ts`) — every
 * money-accepting function here rejects `NaN`/`Infinity`/negative/absurd
 * input before any DB work happens, never silently coerces it.
 *
 * **Simulated usage is invisible to every number in this file** —
 * `provider = 'simulated'` rows are excluded at the SQL layer
 * (`lib/ai-office/domain/budget.ts`'s `sumLiveAiUsageCostFor*`), not
 * filtered here, so there is exactly one place that rule can ever be
 * wrong, not several.
 *
 * **Simulated-provider policy — this ledger never accepts `"simulated"`
 * at all, by construction.** `authorizeBudget()` refuses (throws) a
 * request whose `provider === "simulated"` outright, before ever
 * opening a transaction — `SimulatedAdapter` work already has its own,
 * separate, always-authorized path
 * (`lib/ai-office/agents/budget-gate.ts`'s `authorizeBudget({aiMode})`,
 * unchanged since Phase 4) and must never pass through this LIVE-only
 * gate. Because a `budget_reservations` row can therefore never be
 * created with `provider = 'simulated'` in the first place, it is
 * structurally impossible — not just checked-for — for a reconciled
 * reservation to ever produce a `"simulated"` `ai_usage` row through
 * this path. `reconcileReservationWithUsage()` still asserts this
 * defensively (a reservation's `provider` is authoritative and
 * caller-supplied provider values are never accepted at
 * reconciliation time either way — see below), in case a reservation
 * is ever created by some future code path that bypasses
 * `authorizeBudget()`.
 *
 * **Reservation identity is authoritative at reconciliation time.**
 * `reconcileReservationWithUsage()` takes only what genuinely becomes
 * known *after* a provider call completes — `reservationId`,
 * `agentRunId`, `actualCostUsd`, token counts — and derives `projectId`/
 * `provider` from the persisted reservation row itself, never from
 * caller input. It additionally verifies the given `agentRunId`
 * resolves (via `resolveProjectIdForAgentRun()`,
 * `lib/ai-office/domain/tasks.ts`) to the *same* project the reservation
 * was authorized for, rejecting (rolling back, creating nothing) any
 * mismatch. See the "Post-review correction" note in
 * docs/ai-office/11-implementation-phases.md's Phase 6 status for the
 * concrete mis-attribution risk this closes.
 */

export type BudgetAuthorizationStatus =
  | "AUTHORIZED"
  | "WARNING"
  | "BLOCKED_MONTHLY_CAP"
  | "BLOCKED_PROJECT_CAP"
  | "APPROVAL_REQUIRED"
  | "TEMPORARILY_UNAVAILABLE";

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

function startOfNextMonthUtc(periodStart: number): number {
  const d = new Date(periodStart);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * `node:sqlite` surfaces a busy/locked database as a thrown error with
 * `errcode` 5 (`SQLITE_BUSY`) or 6 (`SQLITE_LOCKED`) — matched
 * defensively on both the code and the message text, since the exact
 * shape of a native-binding error isn't part of any documented,
 * guaranteed contract.
 */
function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { errcode?: number; message?: string };
  if (err.errcode === 5 || err.errcode === 6) return true;
  return typeof err.message === "string" && /database is locked|database table is locked/i.test(err.message);
}

/**
 * Begins an immediate (write-locking) transaction. Returns `true` if the
 * lock could not be acquired even after `PRAGMA busy_timeout` finished
 * waiting — a real, honest, non-infinite failure mode (never retried in
 * a loop here; `busy_timeout` itself is SQLite's own bounded wait, which
 * is the only "retry" this code relies on).
 */
function tryBeginImmediate(db: DatabaseSync): boolean {
  try {
    db.exec("BEGIN IMMEDIATE");
    return true;
  } catch (error) {
    if (isSqliteBusyError(error)) return false;
    throw error;
  }
}

function safeRollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // Nothing to roll back (BEGIN never succeeded) or the connection is
    // already closed — either way, there is nothing further to do.
  }
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
  // Validated *before* ever taking the write lock — an invalid estimate,
  // or a "simulated" provider (which must never enter this LIVE-only
  // ledger at all — see the module docblock), is a caller bug, not a
  // business decision, and should fail fast without touching the
  // database.
  if (input.provider === SIMULATED_PROVIDER) {
    throw new ReservationIdentityError(
      `authorizeBudget() refuses provider "${SIMULATED_PROVIDER}" — simulated work is always authorized through its own separate, free path and must never create a LIVE budget reservation.`,
    );
  }
  const estimatedCents = toCentsStrict(input.estimatedCostUsd, "estimatedCostUsd");

  const periodStart = startOfCurrentMonthUtc();
  const periodEnd = startOfNextMonthUtc(periodStart);

  if (!tryBeginImmediate(db)) {
    return {
      status: "TEMPORARILY_UNAVAILABLE",
      reason: "The budget ledger is busy handling another request. Try again shortly.",
      officeRemainingUsd: 0,
    };
  }

  let result: BudgetAuthorizationResult;
  try {
    const project = getProject(db, input.projectId);
    if (!project) {
      result = { status: "BLOCKED_PROJECT_CAP", reason: "Project not found.", officeRemainingUsd: 0 };
    } else {
      const blockingApproval = findBlockingApproval(db, input.projectId, input.taskId);
      const officeBudget = getOrCreateOfficeBudgetRecord(db, periodStart);
      const officeSpentCents = toCentsStrict(sumLiveAiUsageCostForOfficeInPeriod(db, periodStart, periodEnd), "officeSpent");
      const officeReservedCents = toCentsStrict(sumReservedCostInPeriod(db, periodStart, periodEnd), "officeReserved");
      const officeCommittedCents = officeSpentCents + officeReservedCents;
      const officeCapCents = toCentsStrict(officeBudget.capUsd, "officeCap");
      const officeRemainingUsd = centsToUsd(Math.max(0, officeCapCents - officeCommittedCents));

      let projectCapCents: number | undefined;
      let projectCommittedCents: number | undefined;
      let projectRemainingUsd: number | undefined;
      if (project.monthlyBudgetCapUsd != null) {
        const projectSpentCents = toCentsStrict(sumLiveAiUsageCostForProjectInPeriod(db, input.projectId, periodStart, periodEnd), "projectSpent");
        const projectReservedCents = toCentsStrict(sumReservedCostForProjectInPeriod(db, input.projectId, periodStart, periodEnd), "projectReserved");
        projectCommittedCents = projectSpentCents + projectReservedCents;
        projectCapCents = toCentsStrict(project.monthlyBudgetCapUsd, "projectCap");
        projectRemainingUsd = centsToUsd(Math.max(0, projectCapCents - projectCommittedCents));
      }

      if (blockingApproval) {
        result = {
          status: "APPROVAL_REQUIRED",
          reason: "This project has a pending owner approval that must be decided before any LIVE spend can proceed.",
          officeRemainingUsd,
          projectRemainingUsd,
        };
      } else if (projectCapCents !== undefined && projectCommittedCents !== undefined && projectCommittedCents + estimatedCents > projectCapCents) {
        // Project cap checked first — the more specific constraint; a
        // project deliberately given a tighter allowance should never
        // spend past it just because office-wide room remains.
        result = {
          status: "BLOCKED_PROJECT_CAP",
          reason: `This request ($${input.estimatedCostUsd.toFixed(2)}) would exceed the project's monthly cap of $${project.monthlyBudgetCapUsd!.toFixed(2)}.`,
          officeRemainingUsd,
          projectRemainingUsd,
        };
      } else if (officeCommittedCents + estimatedCents > officeCapCents) {
        result = {
          status: "BLOCKED_MONTHLY_CAP",
          reason: `This request ($${input.estimatedCostUsd.toFixed(2)}) would exceed the office's monthly cap of $${officeBudget.capUsd.toFixed(2)}.`,
          officeRemainingUsd,
          projectRemainingUsd,
        };
      } else {
        // No overage — reserve the estimate *inside this same
        // transaction*, so the lock is never released between "checked
        // OK" and "reserved." This is the actual fix: the old version
        // reserved after committing nothing, as a separate statement a
        // second connection could interleave in front of.
        const reservation = createBudgetReservation(db, {
          projectId: input.projectId,
          provider: input.provider,
          estimatedCostUsd: input.estimatedCostUsd,
          periodStart,
        });

        const warnThresholdCents = Math.ceil((officeCapCents * officeBudget.warnAtPercent) / 100);
        const isWarning = officeCommittedCents + estimatedCents >= warnThresholdCents;

        result = {
          status: isWarning ? "WARNING" : "AUTHORIZED",
          reservationId: reservation.id,
          officeRemainingUsd: centsToUsd(Math.max(0, officeCapCents - (officeCommittedCents + estimatedCents))),
          projectRemainingUsd:
            projectCapCents !== undefined && projectCommittedCents !== undefined
              ? centsToUsd(Math.max(0, projectCapCents - (projectCommittedCents + estimatedCents)))
              : undefined,
        };
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    safeRollback(db);
    throw error;
  }

  return result;
}

export interface ReconcileWithUsageInput {
  reservationId: string;
  /** The only way `projectId`/`provider` for the resulting `ai_usage` row are determined — never taken from caller input. See the module docblock's "Reservation identity is authoritative" note. */
  agentRunId: string;
  actualCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Real Anthropic prompt-cache token counts (token economics phase, Part 9) — omitted/undefined for a provider or call that never reported them; never guessed. */
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}

export interface ReconcileWithUsageResult {
  /** False if the reservation was already settled (RECONCILED/RELEASED) by an earlier call — a safe no-op, never a double-count. */
  applied: boolean;
  reservation: BudgetReservationRow;
  usage?: AiUsageRow;
  /** True if this reconciliation pushed committed office spend for the period over the cap — an already-incurred cost that cannot be blocked retroactively; see the module docblock and the "actual > estimate" test. */
  overCap: boolean;
}

/**
 * The single, atomic way a completed (future, Phase 7+) provider call's
 * real cost is ever recorded. **Source of truth split, stated
 * explicitly**: a `budget_reservations` row counts toward committed
 * spend only while `status = 'RESERVED'`; the moment it becomes
 * `RECONCILED`, its estimate stops counting and the real `ai_usage` row
 * this function inserts *in the same transaction* starts counting
 * instead — there is no code path, and therefore no possible crash
 * point, where the reservation has already flipped to `RECONCILED` but
 * the corresponding `ai_usage` row does not yet exist (the earlier
 * Phase 6 correction this builds on).
 *
 * **Identity validation happens before any mutation, in this order**
 * (all inside the same transaction, so any rejection rolls back
 * cleanly — the reservation stays `RESERVED`, no `ai_usage` row is
 * created, nothing is partially settled): (1) the reservation exists
 * and is `RESERVED` (otherwise this is the pre-existing idempotent
 * no-op path, `applied: false`); (2) `reservation.projectId` is not
 * null; (3) `reservation.provider` is not `"simulated"` (defense in
 * depth — `authorizeBudget()` already refuses to create such a
 * reservation at all); (4) the referenced project still exists; (5)
 * `agentRunId` refers to a real `agent_runs` row; (6) that row resolves
 * (`resolveProjectIdForAgentRun()`) to a project; (7) the resolved
 * project matches `reservation.projectId` exactly. Only once all seven
 * hold does `projectId`/`provider` get read from the reservation and
 * used for the `ai_usage` row — a caller can no longer supply, and
 * therefore can no longer mis-supply, either value.
 *
 * Idempotent: a reservation not currently `RESERVED` (already
 * reconciled or released by an earlier call) is a no-op —
 * `applied: false`, no second `ai_usage` row, no double count.
 *
 * If the actual cost pushes the office's committed total for the
 * period over its cap, `overCap` is `true` — this cost already
 * happened and cannot be un-spent, so nothing here tries to "block" it;
 * it's recorded in full, an event + audit entry is written so it's
 * visible to the owner, and the *next* `authorizeBudget()` call for
 * this office will correctly see the now-over-cap committed total and
 * refuse (even a $0 request, since `committed + 0 > cap` already holds)
 * until the owner raises the cap.
 */
export function reconcileReservationWithUsage(db: DatabaseSync, input: ReconcileWithUsageInput): ReconcileWithUsageResult {
  // Validated up front, before any DB work — malformed numeric input is
  // a caller bug, not a business outcome.
  toCentsStrict(input.actualCostUsd, "actualCostUsd");
  toSafeNonNegativeInt(input.inputTokens, "inputTokens");
  toSafeNonNegativeInt(input.outputTokens, "outputTokens");

  if (!tryBeginImmediate(db)) {
    throw new Error("reconcileReservationWithUsage: the budget ledger is busy handling another request. Try again shortly.");
  }

  let result: ReconcileWithUsageResult;
  try {
    const before = getBudgetReservation(db, input.reservationId);
    if (!before || before.status !== "RESERVED") {
      result = { applied: false, reservation: before as BudgetReservationRow, overCap: false };
    } else {
      if (!before.projectId) {
        throw new ReservationIdentityError(`Reservation ${input.reservationId} has no projectId and cannot be reconciled.`);
      }
      if (before.provider === SIMULATED_PROVIDER) {
        throw new ReservationIdentityError(
          `Reservation ${input.reservationId} is a "${SIMULATED_PROVIDER}"-provider reservation and must never be reconciled through this LIVE financial path.`,
        );
      }
      const project = getProject(db, before.projectId);
      if (!project) {
        throw new ReservationIdentityError(`Reservation ${input.reservationId} references project ${before.projectId}, which no longer exists.`);
      }
      const agentRun = getAgentRun(db, input.agentRunId);
      if (!agentRun) {
        throw new ReservationIdentityError(`AgentRun ${input.agentRunId} does not exist.`);
      }
      const resolvedProjectId = resolveProjectIdForAgentRun(db, input.agentRunId);
      if (!resolvedProjectId) {
        throw new ReservationIdentityError(`AgentRun ${input.agentRunId} does not resolve to a valid TaskAttempt/Task/Project chain.`);
      }
      if (resolvedProjectId !== before.projectId) {
        throw new ReservationIdentityError(
          `AgentRun ${input.agentRunId} belongs to project ${resolvedProjectId}, but reservation ${input.reservationId} was authorized for project ${before.projectId}.`,
        );
      }

      // Identity confirmed — the reservation, not the caller, is now
      // the source of truth for projectId/provider.
      const reservation = reconcileBudgetReservation(db, input.reservationId, input.actualCostUsd);
      const usage = recordAiUsage(db, {
        agentRunId: input.agentRunId,
        projectId: before.projectId,
        provider: before.provider,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: input.actualCostUsd,
        cacheCreationInputTokens: input.cacheCreationInputTokens,
        cacheReadInputTokens: input.cacheReadInputTokens,
      });

      const periodStart = startOfCurrentMonthUtc();
      const periodEnd = startOfNextMonthUtc(periodStart);
      const officeSpentCents = toCentsStrict(sumLiveAiUsageCostForOfficeInPeriod(db, periodStart, periodEnd), "officeSpent");
      const officeReservedCents = toCentsStrict(sumReservedCostInPeriod(db, periodStart, periodEnd), "officeReserved");
      const officeBudget = getOrCreateOfficeBudgetRecord(db, periodStart);
      const officeCapCents = toCentsStrict(officeBudget.capUsd, "officeCap");
      const overCap = officeSpentCents + officeReservedCents > officeCapCents;

      result = { applied: true, reservation, usage, overCap };
    }

    db.exec("COMMIT");
  } catch (error) {
    safeRollback(db);
    throw error;
  }

  if (result.overCap) {
    recordEvent(db, {
      projectId: result.reservation.projectId,
      type: "budget.overage_detected",
      payload: { reservationId: input.reservationId, actualCostUsd: input.actualCostUsd },
      actor: "system",
    });
    recordAuditEntry(db, { actor: "system", action: "budget.overage_detected", targetType: "budget_reservations", targetId: input.reservationId });
  }

  return result;
}

/** Releases a reservation whose call never incurred real cost (refused/failed before any provider usage occurred) — the held amount is freed without being recorded as spend. A single guarded UPDATE is already atomic on its own; no explicit transaction wrapper needed for one statement. */
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
  /** Ollama runs — always $0, tracked separately from both simulated and LIVE so the UI can show a distinct "LOCAL" figure rather than folding it into either. */
  localRuns: number;
  localCostUsd: number;
  /** Free multi-model orchestration phase — Groq/Gemini/OpenRouter combined; always $0, tracked separately from Ollama since it's free-over-the-network rather than free-and-fully-local. */
  freeApiRuns: number;
  freeApiCostUsd: number;
  status: "SAFE" | "WARNING" | "AT_CAP";
}

/** Read-only snapshot for the dashboard's Budget panel — no side effects, safe to call on every page render. Not wrapped in a write transaction (nothing is written), so it never blocks or is blocked by `authorizeBudget()`'s lock — WAL readers see the last-committed snapshot regardless of an in-flight writer. */
export function getBudgetSnapshot(db: DatabaseSync): BudgetSnapshot {
  const periodStart = startOfCurrentMonthUtc();
  const periodEnd = startOfNextMonthUtc(periodStart);
  const record: BudgetRecordRow = getOrCreateOfficeBudgetRecord(db, periodStart);

  const liveSpendUsd = sumLiveAiUsageCostForOfficeInPeriod(db, periodStart, periodEnd);
  const reservedUsd = sumReservedCostInPeriod(db, periodStart, periodEnd);
  const committedCents = toCentsStrict(liveSpendUsd, "liveSpend") + toCentsStrict(reservedUsd, "reserved");
  const capCents = toCentsStrict(record.capUsd, "cap");
  const remainingUsd = centsToUsd(Math.max(0, capCents - committedCents));
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
    localRuns: countLocalRunsForOffice(db),
    localCostUsd: sumLocalCostForOffice(db),
    freeApiRuns: countFreeApiRunsForOffice(db),
    freeApiCostUsd: sumFreeApiCostForOffice(db),
    status,
  };
}
