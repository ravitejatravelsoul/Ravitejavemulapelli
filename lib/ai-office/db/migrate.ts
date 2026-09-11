import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// Relative + extension-explicit — see the comment in client.ts.
import { getMigrationsDir } from "./paths.ts";

/**
 * Simple, deterministic, hand-written SQL migrations — no ORM/migration
 * framework, per docs/ai-office/06-data-model.md §6 ("a single-file
 * SQLite schema for one user does not need a heavyweight migration
 * tool"). Files are named `NNN-description.sql`; the leading number is
 * the version. Applied version history lives in `schema_migrations`
 * inside the same database it's tracking, so the schema version is
 * always inspectable with a plain `SELECT`.
 */

interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

const MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    appliedAt INTEGER NOT NULL
  )
`;

function discoverMigrations(): MigrationFile[] {
  const dir = getMigrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  return files
    .map((file) => {
      const match = /^(\d+)-(.+)\.sql$/.exec(file);
      if (!match) {
        throw new Error(`Migration file "${file}" does not match the required "NNN-description.sql" naming pattern.`);
      }
      return { version: Number(match[1]), name: file, path: join(dir, file) };
    })
    .sort((a, b) => a.version - b.version);
}

/** The highest applied migration version, or 0 for a brand-new database. */
export function getSchemaVersion(db: DatabaseSync): number {
  db.exec(MIGRATIONS_TABLE_SQL);
  const row = db.prepare("SELECT MAX(version) as maxVersion FROM schema_migrations").get() as
    | { maxVersion: number | null }
    | undefined;
  return row?.maxVersion ?? 0;
}

/**
 * Applies every migration with a version greater than the database's
 * current schema version, in order, each inside its own transaction.
 * Safe to call repeatedly — already-applied migrations are skipped
 * entirely, never re-run. If a migration's SQL throws, its transaction
 * rolls back and the error propagates: the migration is NOT recorded as
 * applied, so a failed run never "pretends" success and a retry after
 * fixing the problem will attempt that same migration again.
 */
export function runMigrations(db: DatabaseSync): { applied: string[]; version: number } {
  const currentVersion = getSchemaVersion(db);
  const migrations = discoverMigrations();
  const pending = migrations.filter((m) => m.version > currentVersion);

  const applied: string[] = [];
  for (const migration of pending) {
    const sql = readFileSync(migration.path, "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        Date.now(),
      );
      db.exec("COMMIT");
      applied.push(migration.name);
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration "${migration.name}" failed and was rolled back: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  return { applied, version: getSchemaVersion(db) };
}
