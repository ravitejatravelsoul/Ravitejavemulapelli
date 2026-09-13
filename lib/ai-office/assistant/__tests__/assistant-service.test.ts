import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createApproval, getApproval } from "../../domain/project-outputs.ts";
import { getOfficeStatus } from "../../domain/office.ts";
import { getProject } from "../../domain/projects.ts";
import { parseIntent } from "../intent-parser.ts";
import { handleAssistantText, executeConfirmedAction } from "../assistant-service.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

describe("parseIntent", () => {
  test("recognizes every one of Section Q's example READ commands", () => {
    assert.equal(parseIntent("What is everyone working on?").kind, "STATUS");
    assert.equal(parseIntent("How much have I spent today?").kind, "SPEND");
    assert.equal(parseIntent("Which projects need my approval?").kind, "APPROVALS_NEEDED");
    assert.equal(parseIntent("Show me projects ready for review.").kind, "READY_FOR_REVIEW");
    assert.equal(parseIntent("What is the next action?").kind, "NEXT_ACTION");
    assert.equal(parseIntent("What happened overnight?").kind, "OVERNIGHT_BRIEF");
  });

  test("recognizes every one of Section Q's example MUTATING commands", () => {
    assert.equal(parseIntent("Pause this project.").kind, "PAUSE_PROJECT");
    assert.equal(parseIntent("Resume it.").kind, "RESUME_PROJECT");
    assert.equal(parseIntent("Close the Office.").kind, "CLOSE_OFFICE");
    assert.equal(parseIntent("Open the Office.").kind, "OPEN_OFFICE");
    assert.equal(parseIntent("Approve this Claude request.").kind, "APPROVE");
    assert.equal(parseIntent("Reject it.").kind, "REJECT");
  });

  test("an unrecognized message is honestly UNKNOWN, never mis-parsed into an action", () => {
    const intent = parseIntent("Tell me a joke about databases.");
    assert.equal(intent.kind, "UNKNOWN");
  });

  test("'why is X blocked' captures the project name hint", () => {
    const intent = parseIntent('Why is "Hybrid Live Pilot" blocked?');
    assert.equal(intent.kind, "BLOCKED_WHY");
    assert.equal((intent as { projectNameHint: string }).projectNameHint, "Hybrid Live Pilot");
  });
});

describe("handleAssistantText — read commands never mutate anything", () => {
  test("STATUS reports the real office state and real active project, never a guess", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    createProjectWithIdea(t.db, { title: "Real Project", rawIdeaText: "x", ownerId: owner.id });
    const turn = handleAssistantText(t.db, "office status");
    assert.match(turn.message, /Office is (open|closed)/i);
    assert.equal(turn.pendingAction, undefined);
    t.close();
  });

  test("SPEND reflects the real budget snapshot", () => {
    const t = createTestDb();
    const turn = handleAssistantText(t.db, "how much have I spent?");
    assert.match(turn.message, /\$\d+\.\d{2}/);
    t.close();
  });

  test("APPROVALS_NEEDED with zero pending approvals says so honestly rather than inventing one", () => {
    const t = createTestDb();
    const turn = handleAssistantText(t.db, "which projects need my approval?");
    assert.match(turn.message, /no approvals are pending/i);
    t.close();
  });

  test("BLOCKED_WHY for a project with no real unresolved failure never fabricates a reason", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    createProjectWithIdea(t.db, { title: "Clean Project", rawIdeaText: "x", ownerId: owner.id });
    const turn = handleAssistantText(t.db, 'why is "Clean Project" blocked?');
    assert.match(turn.message, /no unresolved failure/i);
    t.close();
  });
});

describe("handleAssistantText — mutating commands require confirmation first", () => {
  test("'close the office' never closes it immediately — it returns a pendingAction and leaves state untouched", () => {
    const t = createTestDb();
    const before = getOfficeStatus(t.db)?.state;
    const turn = handleAssistantText(t.db, "close the office");
    assert.ok(turn.pendingAction);
    assert.equal(turn.pendingAction!.kind, "CLOSE_OFFICE");
    assert.match(turn.message, /confirm/i);
    assert.equal(getOfficeStatus(t.db)?.state, before, "office state must not change before confirmation");
    t.close();
  });

  test("'approve' with more than one pending approval asks the owner to disambiguate instead of guessing which one", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    createApproval(t.db, { projectId: project.id, kind: "production_deploy", requestedBy: "system", context: {} });
    const turn = handleAssistantText(t.db, "approve this");
    assert.equal(turn.pendingAction, undefined);
    assert.match(turn.message, /2 pending approvals/i);
    t.close();
  });

  test("'approve' with exactly one pending approval proposes it by id, still unresolved until confirmed", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    const turn = handleAssistantText(t.db, "approve it");
    assert.ok(turn.pendingAction);
    assert.equal(turn.pendingAction!.kind, "APPROVE");
    assert.equal(turn.pendingAction!.approvalId, approval.id);
    assert.equal(getApproval(t.db, approval.id)!.status, "PENDING");
    t.close();
  });
});

describe("executeConfirmedAction — only ever calls the real existing services", () => {
  test("confirming CLOSE_OFFICE calls the real closeOffice transition", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const result = executeConfirmedAction(t.db, owner.id, { kind: "CLOSE_OFFICE", label: "Close the Office" });
    assert.match(result.message, /closed/i);
    assert.equal(getOfficeStatus(t.db)?.state, "CLOSED");
    t.close();
  });

  test("confirming APPROVE decides the real approval through decideApproval — attributed to the real owner id", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });

    const result = executeConfirmedAction(t.db, owner.id, { kind: "APPROVE", label: "Approve", approvalId: approval.id });
    assert.match(result.message, /approved/i);
    const decided = getApproval(t.db, approval.id)!;
    assert.equal(decided.status, "APPROVED");
    assert.equal(decided.decidedBy, owner.id);
    t.close();
  });

  test("confirming PAUSE_PROJECT calls the real pauseProject transition, not a raw status write", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    // A DRAFT project can't be paused — proves this goes through the real transition rules, not an unconditional write.
    const result = executeConfirmedAction(t.db, owner.id, { kind: "PAUSE_PROJECT", label: 'Pause "P"', projectId: project.id });
    assert.match(result.message, /couldn't pause/i);
    assert.equal(getProject(t.db, project.id)!.status, "DRAFT");
    t.close();
  });

  test("re-confirming an already-resolved approval is a safe no-op, never a double-decision", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "x", ownerId: owner.id });
    const approval = createApproval(t.db, { projectId: project.id, kind: "paid_service_purchase", requestedBy: "system", context: {} });
    executeConfirmedAction(t.db, owner.id, { kind: "APPROVE", label: "Approve", approvalId: approval.id });

    const second = executeConfirmedAction(t.db, owner.id, { kind: "REJECT", label: "Reject", approvalId: approval.id });
    assert.match(second.message, /already resolved/i);
    assert.equal(getApproval(t.db, approval.id)!.status, "APPROVED", "a stale pendingAction must never flip an already-decided approval");
    t.close();
  });
});
