import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Relative + extension-explicit — see the comment in client.ts.
import { openDatabase } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { seedAll } from "./seed.ts";

/**
 * Isolated temp-file database per test — never the developer's real
 * `.data/office.db`. A real file (not `:memory:`) is used deliberately:
 * a couple of Phase 3 requirements (DB survives reopen/reconnect) need
 * an actual file on disk to reopen.
 */
export interface TestDb {
  db: DatabaseSync;
  dir: string;
  close: () => void;
}

export function createTestDb(options: { seed?: boolean } = {}): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "ai-office-test-"));
  const path = join(dir, "test.db");
  const db = openDatabase(path);
  runMigrations(db);
  if (options.seed !== false) {
    seedAll(db);
  }

  return {
    db,
    dir,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Reopens the same on-disk test database at a fresh connection — for "survives reopen/reconnect" tests. */
export function reopenTestDb(dir: string): DatabaseSync {
  return openDatabase(join(dir, "test.db"));
}
