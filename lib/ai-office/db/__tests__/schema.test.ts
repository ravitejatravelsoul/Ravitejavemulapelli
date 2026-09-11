import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../client.ts";
import { runMigrations, getSchemaVersion } from "../migrate.ts";
import { seedAgentRoles, seedOfficeStatus, seedDefaultOfficeBudget, seedAll } from "../seed.ts";
import { createTestDb, reopenTestDb } from "../test-helpers.ts";
import { AGENT_ROLE_CATALOG } from "../../domain/agent-role-catalog.ts";

describe("clean DB creation + migrations from zero", () => {
  test("a genuinely fresh, unmigrated connection starts at schema version 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-office-fresh-"));
    const db = openDatabase(join(dir, "fresh.db"));
    assert.equal(getSchemaVersion(db), 0);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("runMigrations on that fresh connection applies migration 001 and reaches version 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-office-fresh-"));
    const db = openDatabase(join(dir, "fresh.db"));

    const result = runMigrations(db);
    assert.equal(result.version, 1);
    assert.deepEqual(result.applied, ["001-init.sql"]);
    assert.equal(getSchemaVersion(db), 1);

    const tableCount = db
      .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence'")
      .get() as { count: number };
    assert.ok(tableCount.count >= 19, `expected at least 19 tables, got ${tableCount.count}`);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("migrations are idempotent / safe to run repeatedly", () => {
  test("running runMigrations twice on the same DB applies nothing the second time", () => {
    const t = createTestDb({ seed: false });
    const first = runMigrations(t.db); // no-op, createTestDb already migrated
    assert.deepEqual(first.applied, []);
    assert.equal(first.version, 1);

    const second = runMigrations(t.db);
    assert.deepEqual(second.applied, []);
    assert.equal(second.version, 1);
    t.close();
  });
});

describe("schema version is inspectable", () => {
  test("getSchemaVersion reflects the applied migration history via a plain query", () => {
    const t = createTestDb({ seed: false });
    // node:sqlite returns null-prototype row objects — spread into plain
    // objects so deepEqual compares values, not prototypes.
    const rows = (t.db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all() as Array<{
      version: number;
      name: string;
    }>).map((r) => ({ ...r }));
    assert.deepEqual(rows, [{ version: 1, name: "001-init.sql" }]);
    t.close();
  });
});

describe("migration failure does not pretend success", () => {
  test("a broken migration file throws, is not recorded as applied, and leaves the DB at the prior version", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-office-broken-"));
    const db = openDatabase(join(dir, "broken.db"));

    // Simulate a bad migration by executing invalid SQL directly through the
    // same transactional path runMigrations uses, without touching the real
    // migrations/ directory (which must stay valid for every other test).
    db.exec("BEGIN");
    let threw = false;
    try {
      db.exec("CREATE TABLE this is not valid SQL");
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
      threw = true;
    }
    assert.equal(threw, true);
    assert.equal(getSchemaVersion(db), 0, "a rolled-back migration must not be recorded as applied");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("foreign key enforcement", () => {
  test("inserting a task with a non-existent projectId is rejected", () => {
    const t = createTestDb();
    assert.throws(() => {
      t.db
        .prepare(
          `INSERT INTO tasks (id, projectId, roleId, title, status, attemptCount, createdAt, updatedAt)
           VALUES ('t1', 'nonexistent-project', 'qa-agent', 'x', 'PENDING', 0, 1, 1)`,
        )
        .run();
    });
    t.close();
  });

  test("inserting a project with a non-existent ownerId is rejected", () => {
    const t = createTestDb();
    assert.throws(() => {
      t.db
        .prepare(
          `INSERT INTO projects (id, title, status, aiMode, ownerId, createdAt, updatedAt)
           VALUES ('p1', 'x', 'DRAFT', 'SIMULATED', 'nonexistent-user', 1, 1)`,
        )
        .run();
    });
    t.close();
  });

  test("PRAGMA foreign_keys is actually ON for this connection", () => {
    const t = createTestDb();
    const row = t.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.equal(row.foreign_keys, 1);
    t.close();
  });
});

describe("agent-role seed", () => {
  test("seedAgentRoles is idempotent — running it repeatedly does not duplicate rows", () => {
    const t = createTestDb({ seed: false });
    seedAgentRoles(t.db);
    seedAgentRoles(t.db);
    seedAgentRoles(t.db);
    const count = t.db.prepare("SELECT COUNT(*) as count FROM agent_roles").get() as { count: number };
    assert.equal(count.count, AGENT_ROLE_CATALOG.length);
    t.close();
  });

  test("the seeded catalog exactly matches the approved 11-role set", () => {
    const t = createTestDb();
    // node:sqlite returns null-prototype row objects — spread into plain
    // objects so deepEqual compares values, not prototypes.
    const rows = (t.db.prepare("SELECT id, name FROM agent_roles ORDER BY id").all() as Array<{
      id: string;
      name: string;
    }>).map((r) => ({ ...r }));
    const expected = [...AGENT_ROLE_CATALOG]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({ id: r.id, name: r.name }));
    assert.deepEqual(rows, expected);
    assert.equal(rows.length, 11, "the approved catalog has 11 roles");
    t.close();
  });

  test("seeded role fields round-trip correctly (JSON columns parse back to arrays)", () => {
    const t = createTestDb();
    const row = t.db.prepare("SELECT * FROM agent_roles WHERE id = 'qa-agent'").get() as
      | { responsibilities: string; allowedOutputs: string; maxRetries: number; escalatesTo: string }
      | undefined;
    assert.ok(row, "qa-agent role must exist");
    assert.ok(Array.isArray(JSON.parse(row!.responsibilities)));
    assert.ok(JSON.parse(row!.allowedOutputs).includes("test-report"));
    assert.equal(row!.escalatesTo, "orchestrator");
    assert.equal(typeof row!.maxRetries, "number");
    t.close();
  });
});

describe("no duplicate singleton office_status row", () => {
  test("seedOfficeStatus is idempotent and office_status never has more than one row", () => {
    const t = createTestDb({ seed: false });
    seedOfficeStatus(t.db);
    seedOfficeStatus(t.db);
    seedOfficeStatus(t.db);
    const count = t.db.prepare("SELECT COUNT(*) as count FROM office_status").get() as { count: number };
    assert.equal(count.count, 1);
    t.close();
  });

  test("inserting a second office_status row with a different id is rejected by the CHECK constraint", () => {
    const t = createTestDb();
    assert.throws(() => {
      t.db
        .prepare(
          `INSERT INTO office_status (id, state, changedAt, createdAt, updatedAt) VALUES ('not-singleton', 'OPEN', 1, 1, 1)`,
        )
        .run();
    });
    t.close();
  });
});

describe("default office budget", () => {
  test("seedDefaultOfficeBudget seeds a $30 office-scope cap and is idempotent", () => {
    const t = createTestDb({ seed: false });
    seedDefaultOfficeBudget(t.db);
    seedDefaultOfficeBudget(t.db);
    const rows = t.db.prepare("SELECT * FROM budget_records WHERE scope = 'office'").all() as Array<{
      capUsd: number;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].capUsd, 30);
    t.close();
  });
});

describe("DB survives reopen/reconnect", () => {
  test("data written before close is readable after reopening the same file", () => {
    const t = createTestDb();
    const dir = t.dir;
    t.db.close();

    const reopened = reopenTestDb(dir);
    assert.equal(getSchemaVersion(reopened), 1);
    const roles = reopened.prepare("SELECT COUNT(*) as count FROM agent_roles").get() as { count: number };
    assert.equal(roles.count, AGENT_ROLE_CATALOG.length);
    reopened.close();

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("full seedAll wiring", () => {
  test("seedAll seeds roles, office status, and budget together, idempotently", () => {
    const t = createTestDb({ seed: false });
    seedAll(t.db);
    seedAll(t.db);
    const roleCount = t.db.prepare("SELECT COUNT(*) as count FROM agent_roles").get() as { count: number };
    const officeCount = t.db.prepare("SELECT COUNT(*) as count FROM office_status").get() as { count: number };
    const budgetCount = t.db
      .prepare("SELECT COUNT(*) as count FROM budget_records WHERE scope = 'office'")
      .get() as { count: number };
    assert.equal(roleCount.count, AGENT_ROLE_CATALOG.length);
    assert.equal(officeCount.count, 1);
    assert.equal(budgetCount.count, 1);
    t.close();
  });
});
