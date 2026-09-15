import "server-only";
import type { DatabaseSync } from "node:sqlite";

/**
 * The exact set of tables that belong to one project's durable Remote
 * Mode bundle — see lib/ai-office/db/migrations/*.sql for the ground
 * truth schema this list is kept in sync with. Deliberately explicit,
 * not auto-detected from a "has a projectId column" heuristic: several
 * tables reach a project only transitively (task_attempts/agent_runs via
 * taskId/taskAttemptId, never a direct projectId column), and a wrong
 * guess there would silently drop real state. Hand-verified once against
 * the real CREATE TABLE statements; add a new project-scoped table here
 * explicitly when a new migration introduces one.
 *
 * Deliberately EXCLUDED, with a specific reason each:
 *   - users, office_status, agent_roles: office-wide/global, not
 *     per-project — see remote-state-store.ts (users gets one fixed
 *     synthetic owner row seeded fresh per hydration; office_status and
 *     the office-scope budget_records row live in state/office.json, not
 *     a project bundle; agent_roles is a deterministic seeded catalog).
 *   - budget_records (scope='office' rows): office-wide, see above —
 *     only scope='project' rows belong in a project bundle.
 *   - runner_heartbeats: a LOCAL always-on-supervisor concept with no
 *     Remote Mode equivalent (each GitHub Actions job IS its own
 *     bounded, ephemeral "runner" — there is nothing to heartbeat
 *     between jobs).
 *   - recommended_model_routing, benchmark_results: Ollama/local-model
 *     routing only — Remote Mode never has local models available (see
 *     execution-mode.ts's docblock and the "Ollama remains LOCAL ONLY"
 *     requirement), so these are structurally never populated remotely.
 *   - escalations, escalation_response_attempts, owner_notification_policy:
 *     the Twilio phone/SMS escalation feature — out of scope for this
 *     phase of Remote Mode; a real, disclosed gap, not an oversight. A
 *     project that never triggers a human escalation is unaffected.
 *   - audit_log: a global (non-project-scoped) log with no projectId
 *     column at all; not required for task resumability, so not
 *     round-tripped through a project bundle for V1.
 */
export const PROJECT_SCOPED_TABLES = [
  "projects",
  "project_ideas",
  "tasks",
  "task_dependencies",
  "task_attempts",
  "agent_runs",
  "messages_events",
  "project_decisions",
  "artifacts",
  "approvals",
  "ai_usage",
  "test_results",
  "failures",
  "project_memory_cache",
  "workspaces",
  "workspace_files",
  "office_incidents",
  "semantic_repair_plans",
] as const;

export type ProjectScopedTable = (typeof PROJECT_SCOPED_TABLES)[number];

/** One row, as returned by `node:sqlite`'s `.all()` — column name -> value. */
export type SqliteRow = Record<string, string | number | bigint | Buffer | null>;

export interface ProjectBundle {
  projectId: string;
  schemaVersion: number;
  updatedAt: string;
  tables: Partial<Record<ProjectScopedTable, SqliteRow[]>>;
  /** Project-scope budget_records rows only (see the exclusion note above) — kept alongside `tables` rather than inside it since it's a filtered subset of a table that ALSO has office-scope rows elsewhere. */
  projectBudgetRecords: SqliteRow[];
}

/**
 * NOTE on task leasing: there is deliberately no separate lease
 * structure here. `tasks.leaseOwnerId`/`leaseExpiresAt` — the SAME
 * columns `claimTask()`/`releaseLease()`/`findStaleLeasedTasks()`
 * (lib/ai-office/domain/tasks.ts) already use for the local runner's
 * atomic `UPDATE ... WHERE status='PENDING' AND (leaseExpiresAt IS NULL
 * OR leaseExpiresAt < now)` compare-and-swap — are already part of the
 * `tasks` table, already round-tripped by `dumpProjectBundle`/
 * `restoreProjectBundle` below. A worker's `leaseOwnerId` is set to its
 * GitHub Actions run id (see remote-worker.ts), so the exact same
 * stale-lease recovery the local runner already does works unmodified
 * for Remote Mode. This git-level optimistic-concurrency write (the blob
 * `sha` check in remote-state-store.ts) and that SQL-level lease are two
 * complementary layers, not duplicates of each other: the SHA check
 * protects the whole bundle write; the lease protects one task claim
 * within it.
 */

function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

/**
 * Reads every row of every project-scoped table out of `db` — safe to
 * call unconditionally: since each Remote Mode ephemeral database holds
 * exactly one project's data (plus seeded catalogs/singletons — see
 * remote-state-store.ts), no `WHERE projectId = ?` filter is needed;
 * every row present IS this project's.
 */
export function dumpProjectBundle(db: DatabaseSync, projectId: string): ProjectBundle {
  const tables: Partial<Record<ProjectScopedTable, SqliteRow[]>> = {};
  for (const table of PROJECT_SCOPED_TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all() as SqliteRow[];
  }
  const projectBudgetRecords = db.prepare("SELECT * FROM budget_records WHERE scope = 'project' AND scopeId = ?").all(projectId) as SqliteRow[];

  return {
    projectId,
    schemaVersion: getSchemaVersion(db),
    updatedAt: new Date().toISOString(),
    tables,
    projectBudgetRecords,
  };
}

/** Inserts every row from `bundle` into `db` (already migrated + seeded — see remote-state-store.ts). */
export function restoreProjectBundle(db: DatabaseSync, bundle: ProjectBundle): void {
  for (const table of PROJECT_SCOPED_TABLES) {
    const rows = bundle.tables[table];
    if (!rows || rows.length === 0) continue;
    insertRows(db, table, rows);
  }
  if (bundle.projectBudgetRecords.length > 0) {
    insertRows(db, "budget_records", bundle.projectBudgetRecords);
  }
}

function insertRows(db: DatabaseSync, table: string, rows: SqliteRow[]): void {
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => "?").join(", ");
    const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`);
    stmt.run(...columns.map((c) => row[c]));
  }
}
