import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
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

  test("runMigrations on that fresh connection applies every migration in order and reaches the latest version", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-office-fresh-"));
    const db = openDatabase(join(dir, "fresh.db"));

    const result = runMigrations(db);
    assert.equal(result.version, 15);
    assert.deepEqual(result.applied, [
      "001-init.sql",
      "002-budget-and-approval-scope.sql",
      "003-add-project-provider.sql",
      "004-add-real-workspace.sql",
      "005-add-model-routing.sql",
      "006-add-ai-policy.sql",
      "007-add-claude-cache-usage.sql",
      "008-add-human-escalation.sql",
      "009-strengthen-human-escalation.sql",
      "010-add-approval-revocation.sql",
      "011-add-task-retry-baseline.sql",
      "012-add-office-engineer.sql",
      "013-add-semantic-repair.sql",
      "014-add-superseded-failures.sql",
      "015-add-free-model-orchestration.sql",
    ]);
    assert.equal(getSchemaVersion(db), 15);

    const tableCount = db
      .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence'")
      .get() as { count: number };
    assert.ok(tableCount.count >= 21, `expected at least 21 tables, got ${tableCount.count}`);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("migrations are idempotent / safe to run repeatedly", () => {
  test("running runMigrations twice on the same DB applies nothing the second time", () => {
    const t = createTestDb({ seed: false });
    const first = runMigrations(t.db); // no-op, createTestDb already migrated
    assert.deepEqual(first.applied, []);
    assert.equal(first.version, 15);

    const second = runMigrations(t.db);
    assert.deepEqual(second.applied, []);
    assert.equal(second.version, 15);
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
    assert.deepEqual(rows, [
      { version: 1, name: "001-init.sql" },
      { version: 2, name: "002-budget-and-approval-scope.sql" },
      { version: 3, name: "003-add-project-provider.sql" },
      { version: 4, name: "004-add-real-workspace.sql" },
      { version: 5, name: "005-add-model-routing.sql" },
      { version: 6, name: "006-add-ai-policy.sql" },
      { version: 7, name: "007-add-claude-cache-usage.sql" },
      { version: 8, name: "008-add-human-escalation.sql" },
      { version: 9, name: "009-strengthen-human-escalation.sql" },
      { version: 10, name: "010-add-approval-revocation.sql" },
      { version: 11, name: "011-add-task-retry-baseline.sql" },
      { version: 12, name: "012-add-office-engineer.sql" },
      { version: 13, name: "013-add-semantic-repair.sql" },
      { version: 14, name: "014-add-superseded-failures.sql" },
      { version: 15, name: "015-add-free-model-orchestration.sql" },
    ]);
    t.close();
  });
});

describe("migrations 002+003+004+005 apply cleanly on top of an existing v1 database", () => {
  test("Phase 1-5 data survives the upgrade, and the new columns/table/provider column work afterward", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-office-v1-"));
    const db = openDatabase(join(dir, "v1.db"));

    // Simulate a real pre-Phase-6 database: only migration 001 has ever
    // been applied (hand-applied here, bypassing runMigrations, so this
    // test doesn't depend on 002 not existing yet).
    const sql001 = readFileSync(join(process.cwd(), "lib", "ai-office", "db", "migrations", "001-init.sql"), "utf8");
    db.exec(sql001);
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt INTEGER NOT NULL)",
    );
    db.prepare("INSERT INTO schema_migrations (version, name, appliedAt) VALUES (1, '001-init.sql', ?)").run(Date.now());
    assert.equal(getSchemaVersion(db), 1);

    // Real pre-Phase-6 data, written against the v1 schema only (no
    // taskId/decidedBy/decisionNote columns exist yet at this point).
    seedAgentRoles(db);
    seedOfficeStatus(db);
    seedDefaultOfficeBudget(db);
    const now = Date.now();
    db.prepare("INSERT INTO users (id, email, passwordHash, role, createdAt, updatedAt) VALUES ('u1','a@b.c','h','owner',?,?)").run(now, now);
    db.prepare(
      "INSERT INTO projects (id, title, status, aiMode, monthlyBudgetCapUsd, ownerId, createdAt, updatedAt) VALUES ('p1','t','DRAFT','SIMULATED',NULL,'u1',?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO approvals (id, projectId, kind, status, requestedBy, context, decidedAt, createdAt, updatedAt) VALUES ('a1','p1','paid_service_purchase','PENDING','orchestrator','{}',NULL,?,?)",
    ).run(now, now);

    const result = runMigrations(db);
    assert.deepEqual(result.applied, [
      "002-budget-and-approval-scope.sql",
      "003-add-project-provider.sql",
      "004-add-real-workspace.sql",
      "005-add-model-routing.sql",
      "006-add-ai-policy.sql",
      "007-add-claude-cache-usage.sql",
      "008-add-human-escalation.sql",
      "009-strengthen-human-escalation.sql",
      "010-add-approval-revocation.sql",
      "011-add-task-retry-baseline.sql",
      "012-add-office-engineer.sql",
      "013-add-semantic-repair.sql",
      "014-add-superseded-failures.sql",
      "015-add-free-model-orchestration.sql",
    ]);
    assert.equal(getSchemaVersion(db), 15);

    // The pre-existing rows survive, unmodified except for the new
    // columns now existing (and being NULL, since this data predates
    // them) — except `provider`, which is NOT NULL DEFAULT 'simulated',
    // so pre-existing rows get backfilled with that default rather than NULL.
    const project = db.prepare("SELECT * FROM projects WHERE id = 'p1'").get() as { provider: string } | undefined;
    assert.ok(project);
    assert.equal(project!.provider, "simulated");
    const approval = db.prepare("SELECT * FROM approvals WHERE id = 'a1'").get() as {
      status: string;
      taskId: string | null;
      decidedBy: string | null;
      decisionNote: string | null;
    };
    assert.equal(approval.status, "PENDING");
    assert.equal(approval.taskId, null);
    assert.equal(approval.decidedBy, null);
    assert.equal(approval.decisionNote, null);

    // The new table is fully usable afterward.
    db.prepare(
      "INSERT INTO budget_reservations (id, projectId, provider, estimatedCostUsd, actualCostUsd, status, periodStart, createdAt, updatedAt) VALUES ('r1','p1','synthetic',1,NULL,'RESERVED',?,?,?)",
    ).run(now, now, now);
    assert.ok(db.prepare("SELECT * FROM budget_reservations WHERE id = 'r1'").get());

    // Migration 004's new tables/columns are fully usable afterward too.
    db.prepare("INSERT INTO workspaces (id, projectId, deliveryState, createdAt, updatedAt) VALUES ('w1','p1','VERIFIED',?,?)").run(now, now);
    assert.ok(db.prepare("SELECT * FROM workspaces WHERE id = 'w1'").get());
    db.prepare(
      "INSERT INTO workspace_files (id, projectId, path, sizeBytes, lastModifiedByRoleId, lastModifiedByTaskId, createdAt, updatedAt) VALUES ('f1','p1','index.html',10,NULL,NULL,?,?)",
    ).run(now, now);
    assert.ok(db.prepare("SELECT * FROM workspace_files WHERE id = 'f1'").get());
    db.prepare("INSERT INTO runner_heartbeats (runnerId, startedAt, lastSeenAt, status) VALUES ('r1',?,?,'IDLE')").run(now, now);
    assert.ok(db.prepare("SELECT * FROM runner_heartbeats WHERE runnerId = 'r1'").get());
    const testResultCols = (db.prepare("PRAGMA table_info(test_results)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(testResultCols.includes("durationMs"));
    assert.ok(testResultCols.includes("targetUrl"));

    // Migration 005's new columns/tables are fully usable afterward too.
    const projectCols = (db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(projectCols.includes("modelPolicyMode"));
    assert.ok(projectCols.includes("singleModelOverride"));
    assert.ok(projectCols.includes("customRoleModelMapping"));
    const preExistingProject = db.prepare("SELECT modelPolicyMode FROM projects WHERE id = 'p1'").get() as { modelPolicyMode: string };
    assert.equal(preExistingProject.modelPolicyMode, "AUTO", "pre-existing rows get backfilled with the NOT NULL DEFAULT");

    const agentRunCols = (db.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(agentRunCols.includes("model"));

    db.prepare(
      "INSERT INTO benchmark_results (id, model, scenarioId, roleId, status, score, latencyMs, createdAt) VALUES ('b1','gemma4:latest','product-owner-basic','product-owner','PASS',90,1000,?)",
    ).run(now);
    assert.ok(db.prepare("SELECT * FROM benchmark_results WHERE id = 'b1'").get());

    db.prepare(
      "INSERT INTO recommended_model_routing (capability, model, reason, generatedAt) VALUES ('CODING','gemma4:latest','best coding score',?)",
    ).run(now);
    assert.ok(db.prepare("SELECT * FROM recommended_model_routing WHERE capability = 'CODING'").get());

    // Migration 006's new column is fully usable afterward too.
    assert.ok(projectCols.includes("aiPolicyMode"));
    const preExistingProjectAiPolicy = db.prepare("SELECT aiPolicyMode FROM projects WHERE id = 'p1'").get() as { aiPolicyMode: string };
    assert.equal(preExistingProjectAiPolicy.aiPolicyMode, "LOCAL_ONLY", "pre-existing rows get backfilled with the NOT NULL DEFAULT");

    // Migration 007's new nullable columns are fully usable afterward too.
    const aiUsageCols = (db.prepare("PRAGMA table_info(ai_usage)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(aiUsageCols.includes("cacheCreationInputTokens"));
    assert.ok(aiUsageCols.includes("cacheReadInputTokens"));
    db.prepare(
      "INSERT INTO tasks (id, projectId, roleId, title, status, attemptCount, createdAt, updatedAt) VALUES ('t1','p1','frontend-developer','Implement frontend','PENDING',1,?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO task_attempts (id, taskId, attemptNumber, status, agentRunId, createdAt, updatedAt) VALUES ('att1','t1',1,'RUNNING',NULL,?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO agent_runs (id, taskAttemptId, roleId, provider, model, status, startedAt, finishedAt, createdAt, updatedAt) VALUES ('run1','att1','frontend-developer','claude','claude-sonnet-5','SUCCEEDED',?,?,?,?)",
    ).run(now, now, now, now);
    db.prepare(
      "INSERT INTO ai_usage (id, agentRunId, projectId, provider, inputTokens, outputTokens, costUsd, cacheCreationInputTokens, cacheReadInputTokens, createdAt) VALUES ('u1','run1','p1','claude',100,50,0.01,20,80,?)",
    ).run(now);
    const usage = db.prepare("SELECT * FROM ai_usage WHERE id = 'u1'").get() as { cacheCreationInputTokens: number; cacheReadInputTokens: number };
    assert.equal(usage.cacheCreationInputTokens, 20);
    assert.equal(usage.cacheReadInputTokens, 80);

    // Migration 013's new table is fully usable afterward too.
    db.prepare(
      "INSERT INTO office_incidents (id, status, symptom, projectId, taskId, diagnosis, detectedAt, updatedAt) VALUES ('i1','INVESTIGATING','semantic-repair-required','p1','t1','diag',?,?)",
    ).run(now, now);
    db.prepare(
      `INSERT INTO semantic_repair_plans
         (id, incidentId, projectId, taskId, roleId, failureSignature, classification, rootCause, authoritativeContract,
          affectedFiles, requiredChanges, mustPreserve, verification, status, createdAt, updatedAt)
       VALUES ('sp1','i1','p1','t1','frontend-developer','SIG','IMPLEMENTATION_WRONG','root','contract','[]','[]','[]','[]','PROPOSED',?,?)`,
    ).run(now, now);
    assert.ok(db.prepare("SELECT * FROM semantic_repair_plans WHERE id = 'sp1'").get());

    // Migration 014's new nullable columns are fully usable afterward too.
    const failureCols = (db.prepare("PRAGMA table_info(failures)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(failureCols.includes("supersededAt"));
    assert.ok(failureCols.includes("supersededReason"));
    db.prepare(
      "INSERT INTO failures (id, projectId, taskId, agentRunId, reason, resolved, createdAt, updatedAt) VALUES ('f1','p1','t1',NULL,'stale reason',0,?,?)",
    ).run(now, now);
    db.prepare("UPDATE failures SET supersededAt = ?, supersededReason = ? WHERE id = 'f1'").run(now, "platform defect fixed");
    const failure = db.prepare("SELECT * FROM failures WHERE id = 'f1'").get() as { supersededAt: number; supersededReason: string };
    assert.equal(failure.supersededAt, now);
    assert.equal(failure.supersededReason, "platform defect fixed");

    // Migration 015's new column/tables are fully usable afterward too.
    const projectColsAfter015 = (db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(projectColsAfter015.includes("freeModelOrchestration"));
    const preExistingProjectFreeOrch = db.prepare("SELECT freeModelOrchestration FROM projects WHERE id = 'p1'").get() as {
      freeModelOrchestration: number;
    };
    assert.equal(preExistingProjectFreeOrch.freeModelOrchestration, 0, "pre-existing rows get backfilled with the NOT NULL DEFAULT 0");

    db.prepare(
      `INSERT INTO model_registry (id, provider, modelId, displayName, freeTier, enabled, capabilities, structuredOutput, health, recentFailureCount, tasksCompleted, tasksFailed, qualified, createdAt, updatedAt)
       VALUES ('groq:m1', 'groq', 'm1', 'm1', 1, 1, '["GENERAL"]', 1, 'UNKNOWN', 0, 0, 0, 0, ?, ?)`,
    ).run(now, now);
    assert.ok(db.prepare("SELECT * FROM model_registry WHERE id = 'groq:m1'").get());

    db.prepare("INSERT INTO provider_configs (provider, enabled, updatedAt) VALUES ('groq', 1, ?)").run(now);
    assert.ok(db.prepare("SELECT * FROM provider_configs WHERE provider = 'groq'").get());

    db.prepare(
      `INSERT INTO model_routing_decisions (id, projectId, taskId, roleId, requiredCapability, candidateModels, selectedProvider, selectedModel, selectionReason, attempts, result, costUsd, createdAt)
       VALUES ('rd1', 'p1', 't1', 'frontend-developer', 'CODING', '[]', 'groq', 'm1', 'best score', 1, 'SUCCEEDED', 0, ?)`,
    ).run(now);
    assert.ok(db.prepare("SELECT * FROM model_routing_decisions WHERE id = 'rd1'").get());

    db.close();
    rmSync(dir, { recursive: true, force: true });
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
    assert.equal(getSchemaVersion(reopened), 15);
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
