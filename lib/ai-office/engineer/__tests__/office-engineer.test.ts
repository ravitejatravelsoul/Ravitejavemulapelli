import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { createTask, getTask } from "../../domain/tasks.ts";
import { executeTask } from "../../agents/agent-runner.ts";
import { listOpenIncidents, listRecentIncidents } from "../../domain/office-incidents.ts";
import { runOfficeEngineerCycle, computeOfficeHealthStatus } from "../office-engineer.ts";
import type { AIProviderAdapter, AgentTaskResult } from "../../providers/types.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  return { owner, project };
}

function lowerMaxRetries(t: ReturnType<typeof createTestDb>, roleId: string, maxRetries: number) {
  t.db.prepare("UPDATE agent_roles SET maxRetries = ? WHERE id = ?").run(maxRetries, roleId);
}

/** A minimal test-double adapter that always fails with a real, `isOperationalFailureReason`-matching reason (a transient timeout/connection-style failure) — never a fixture scenario string, since SimulatedAdapter has no built-in "operational" failure fixture (real operational failures come from a real adapter's own network/timeout handling, not from scripted test fixtures). */
function operationalFailureAdapter(): AIProviderAdapter {
  return {
    name: "simulated",
    async runAgentTask(): Promise<AgentTaskResult> {
      return {
        status: "FAILED",
        output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason: "Operational: simulated transient timeout." } },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        raw: {},
      };
    },
    estimateCost() {
      return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
    },
  };
}

describe("computeOfficeHealthStatus", () => {
  test("HEALTHY when there are no open incidents", () => {
    const t = createTestDb();
    assert.equal(computeOfficeHealthStatus(t.db), "HEALTHY");
    t.close();
  });
});

describe("runOfficeEngineerCycle", () => {
  test("auto-repairs a task blocked purely by operational (transient) failures — a real, safe retry, never a bypass of any gate", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    lowerMaxRetries(t, "solution-architect", 1);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Plan it" });

    // "Operational:" failures are transient (adapter timeout/malformed
    // JSON/connection error) — exactly the class this agent is allowed
    // to auto-retry, matching isOperationalFailureReason's own pattern.
    const first = await executeTask(t.db, task.id, { provider: operationalFailureAdapter() });
    assert.equal(first.outcome, "retried");
    const second = await executeTask(t.db, task.id, { provider: operationalFailureAdapter() });
    assert.equal(second.outcome, "escalated");
    assert.equal(getTask(t.db, task.id)?.status, "BLOCKED");

    const result = runOfficeEngineerCycle(t.db, "test-engineer");
    assert.equal(result.incidentsCreated, 1);
    assert.equal(result.repaired, 1);
    assert.equal(result.escalated, 0);
    assert.equal(getTask(t.db, task.id)?.status, "PENDING", "the auto-repair must actually retry the task, not just record an incident");

    const incidents = listRecentIncidents(t.db);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].status, "RESOLVED");
    assert.equal(computeOfficeHealthStatus(t.db), "HEALTHY");

    t.close();
  });

  test("never auto-repairs a task blocked by a real content/logic (semantic) failure — escalates for owner attention instead", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    lowerMaxRetries(t, "solution-architect", 1);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Plan it" });

    // The plain "failure" scenario produces a real (non-operational)
    // failure reason.
    await executeTask(t.db, task.id, { scenario: "failure" });
    await executeTask(t.db, task.id, { scenario: "failure" });
    assert.equal(getTask(t.db, task.id)?.status, "BLOCKED");

    const result = runOfficeEngineerCycle(t.db, "test-engineer");
    assert.equal(result.incidentsCreated, 1);
    assert.equal(result.repaired, 0);
    assert.equal(result.escalated, 1);
    assert.equal(getTask(t.db, task.id)?.status, "BLOCKED", "a semantic failure must never be auto-retried");

    const incidents = listOpenIncidents(t.db);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].status, "ESCALATED");
    assert.equal(computeOfficeHealthStatus(t.db), "ESCALATED");

    t.close();
  });

  test("is idempotent — running it again for the same still-open incident never creates a duplicate", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    lowerMaxRetries(t, "solution-architect", 1);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Plan it" });
    await executeTask(t.db, task.id, { scenario: "failure" });
    await executeTask(t.db, task.id, { scenario: "failure" });

    runOfficeEngineerCycle(t.db, "test-engineer");
    const secondRun = runOfficeEngineerCycle(t.db, "test-engineer");
    assert.equal(secondRun.incidentsCreated, 0, "an already-open incident for the same unresolved problem must not be duplicated");
    assert.equal(listRecentIncidents(t.db).length, 1);

    t.close();
  });

  test("does nothing when there are no BLOCKED projects — the common, healthy case costs nothing", () => {
    const t = createTestDb();
    setupProject(t);
    const result = runOfficeEngineerCycle(t.db, "test-engineer");
    assert.deepEqual(result, { incidentsCreated: 0, repaired: 0, escalated: 0 });
    assert.equal(computeOfficeHealthStatus(t.db), "HEALTHY");
    t.close();
  });

  test("restores the project to IN_PROGRESS once its only blocked task is auto-repaired", async () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    lowerMaxRetries(t, "solution-architect", 1);
    const task = createTask(t.db, { projectId: project.id, roleId: "solution-architect", title: "Plan it" });
    await executeTask(t.db, task.id, { provider: operationalFailureAdapter() });
    await executeTask(t.db, task.id, { provider: operationalFailureAdapter() });
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    runOfficeEngineerCycle(t.db, "test-engineer");
    assert.equal(getProject(t.db, project.id)?.status, "IN_PROGRESS");

    t.close();
  });
});
