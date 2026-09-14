import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea, getProject, updateProjectStatus } from "../../domain/projects.ts";
import { listEventsForProject } from "../../domain/events.ts";
import { evaluateProjectTransition, pauseProject, resumeProject } from "../project-transitions.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  return { owner, project };
}

describe("evaluateProjectTransition — the central policy", () => {
  test("PAUSE is allowed only from IN_PROGRESS", () => {
    assert.equal(evaluateProjectTransition("IN_PROGRESS", "PAUSE").allowed, true);
    for (const status of ["DRAFT", "PLANNING", "BLOCKED", "PAUSED", "READY_FOR_REVIEW", "APPROVED", "FAILED", "ARCHIVED"] as const) {
      assert.equal(evaluateProjectTransition(status, "PAUSE").allowed, false, `PAUSE from ${status} must be rejected`);
    }
  });

  test("RESUME is allowed only from PAUSED", () => {
    assert.equal(evaluateProjectTransition("PAUSED", "RESUME").allowed, true);
    for (const status of ["DRAFT", "PLANNING", "IN_PROGRESS", "BLOCKED", "READY_FOR_REVIEW", "APPROVED", "FAILED", "ARCHIVED"] as const) {
      assert.equal(evaluateProjectTransition(status, "RESUME").allowed, false, `RESUME from ${status} must be rejected`);
    }
  });

  test("READY_FOR_REVIEW cannot become PAUSED", () => {
    const result = evaluateProjectTransition("READY_FOR_REVIEW", "PAUSE");
    assert.equal(result.allowed, false);
    assert.match(result.reason!, /ready for review/);
  });

  test("BLOCKED is not silently resumed — the reason names the actual block", () => {
    const result = evaluateProjectTransition("BLOCKED", "RESUME");
    assert.equal(result.allowed, false);
    assert.match(result.reason!, /blocked/i);
    assert.match(result.reason!, /pending approval|escalated task/);
  });
});

describe("pauseProject / resumeProject", () => {
  test("pausing an IN_PROGRESS project persists PAUSED and records event + audit entry", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "IN_PROGRESS");

    const result = pauseProject(t.db, project.id, owner.id);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.project.status, "PAUSED");
    assert.equal(getProject(t.db, project.id)?.status, "PAUSED");

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "project.paused"));

    t.close();
  });

  test("resuming a PAUSED project restores IN_PROGRESS and records event + audit entry", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "IN_PROGRESS");
    pauseProject(t.db, project.id, owner.id);

    const result = resumeProject(t.db, project.id, owner.id);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.project.status, "IN_PROGRESS");

    const events = listEventsForProject(t.db, project.id);
    assert.ok(events.some((e) => e.type === "project.resumed"));

    t.close();
  });

  test("pausing a READY_FOR_REVIEW project is rejected and nothing changes", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "READY_FOR_REVIEW");

    const result = pauseProject(t.db, project.id, owner.id);
    assert.equal(result.ok, false);
    assert.equal(getProject(t.db, project.id)?.status, "READY_FOR_REVIEW");
    assert.equal(listEventsForProject(t.db, project.id).some((e) => e.type === "project.paused"), false);

    t.close();
  });

  test("resuming a BLOCKED project is rejected — resume must never paper over an unresolved block", () => {
    const t = createTestDb();
    const { owner, project } = setupProject(t);
    updateProjectStatus(t.db, project.id, "BLOCKED");

    const result = resumeProject(t.db, project.id, owner.id);
    assert.equal(result.ok, false);
    assert.equal(getProject(t.db, project.id)?.status, "BLOCKED");

    t.close();
  });

  test("pausing a nonexistent project returns a clean failure, not a throw", () => {
    const t = createTestDb();
    const result = pauseProject(t.db, "does-not-exist", "owner-id");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not found/i);
    t.close();
  });
});
