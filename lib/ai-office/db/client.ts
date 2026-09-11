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

/** Opens a connection and applies pragmas — no migrations, no seeding. Tests use this directly against an isolated temp path; see lib/ai-office/db/test-helpers.ts. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
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
