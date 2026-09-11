import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
// Relative, extension-explicit imports within lib/ai-office/db/** —
// deliberate, not the project's usual "@/..." alias: these files must
// also run directly under plain `node --test` (see
// lib/ai-office/db/__tests__/**), and the "@/" path-alias mapping is a
// TypeScript/bundler-only concept that plain Node's ESM resolver does
// not understand. Next.js's bundler accepts this same relative form
// just as well, so this isn't a compromise for the real app either.
import { getDefaultDbPath } from "./paths.ts";
import { runMigrations } from "./migrate.ts";
import { seedAll } from "./seed.ts";

/**
 * `node:sqlite` (Node's built-in driver) — see
 * docs/ai-office/11-implementation-phases.md's Phase 3 status note for
 * the full driver decision write-up. `DatabaseSync` is synchronous by
 * design (matches `better-sqlite3`'s API shape, the alternative this
 * project chose not to add as a dependency) — every exported repository
 * function in `lib/ai-office/domain/**` is therefore synchronous too;
 * callers that need async (Server Actions, React Server Components) can
 * simply await a wrapping async function without the DB layer itself
 * needing to be async.
 */

/**
 * How long a connection waits for a write lock held by another
 * connection (a different process, worker thread, or Server Action
 * call) before giving up — SQLite's own bounded busy-wait, not an
 * application-level retry loop. 5s comfortably outlasts any real
 * transaction this codebase runs (every one is a handful of
 * synchronous statements, sub-millisecond in practice) while still
 * failing loudly, not hanging indefinitely, if a connection is ever
 * genuinely stuck. See `lib/ai-office/budget/budget-service.ts`'s
 * `authorizeBudget()` for the primary reason this matters — an atomic
 * `BEGIN IMMEDIATE` transaction only provides real cross-connection
 * safety if a losing connection waits for the winner instead of either
 * failing immediately or (worse) proceeding with a stale read.
 */
const BUSY_TIMEOUT_MS = 5000;

/** Opens a connection and applies pragmas — no migrations, no seeding. Tests use this directly against an isolated temp path; see lib/ai-office/db/test-helpers.ts. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  // busy_timeout is set *first*, deliberately — a brand-new connection
  // has no timeout configured yet, so if even this connection's own
  // setup pragmas race another connection's transaction (observed in
  // practice: `PRAGMA foreign_keys = ON` hitting SQLITE_BUSY under
  // genuine multi-connection contention in
  // `budget/__tests__/budget-service.test.ts`'s worker-thread test),
  // they need the same protection every later statement gets.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

let appDb: DatabaseSync | null = null;

/**
 * The one shared connection for real app code (Server Actions, Server
 * Components, Route Handlers under `/office/**` only — never imported by
 * public routes, see the "public portfolio must not depend on DB"
 * requirement in docs/ai-office/02-current-portfolio-assessment.md §12).
 * Lazily opens the database, runs any pending migrations, and seeds the
 * fixed catalog/default data on first access — so any AI Office server
 * code that touches the database transparently gets a ready, current
 * schema with no separate manual init step.
 */
export function getAppDatabase(): DatabaseSync {
  if (!appDb) {
    appDb = openDatabase(getDefaultDbPath());
    runMigrations(appDb);
    seedAll(appDb);
  }
  return appDb;
}
