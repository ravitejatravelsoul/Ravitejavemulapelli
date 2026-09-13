import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getHonestStatusLabel, isUnverifiedCompletionClaim, getPreviewStatusLabel, NO_DELIVERABLE_LABEL, isStalledWithNoDeliverable } from "../delivery-status.ts";

describe("getHonestStatusLabel", () => {
  test("non-completion statuses always pass through unchanged, regardless of workspace/deliveryState", () => {
    for (const status of ["DRAFT", "PLANNING", "IN_PROGRESS", "BLOCKED", "PAUSED", "FAILED", "ARCHIVED"] as const) {
      assert.equal(getHonestStatusLabel(status, false, null), status.replace(/_/g, " "));
      assert.equal(getHonestStatusLabel(status, true, "VERIFIED"), status.replace(/_/g, " "));
    }
  });

  test("READY_FOR_REVIEW with no workspace at all is never shown unqualified", () => {
    assert.equal(getHonestStatusLabel("READY_FOR_REVIEW", false, null), NO_DELIVERABLE_LABEL);
  });

  test("APPROVED with no workspace at all is never shown unqualified", () => {
    assert.equal(getHonestStatusLabel("APPROVED", false, null), NO_DELIVERABLE_LABEL);
  });

  test("a workspace that exists but is not yet VERIFIED is still shown honestly, not as READY FOR REVIEW", () => {
    for (const state of ["NOT_STARTED", "BUILDING", "VERIFYING", "FAILED"] as const) {
      assert.equal(getHonestStatusLabel("READY_FOR_REVIEW", true, state), NO_DELIVERABLE_LABEL);
    }
  });

  test("a VERIFIED real deliverable maps READY_FOR_REVIEW to an unambiguous owner-facing COMPLETED label (Part 14) and leaves APPROVED as-is", () => {
    assert.equal(getHonestStatusLabel("READY_FOR_REVIEW", true, "VERIFIED"), "COMPLETED");
    assert.equal(getHonestStatusLabel("APPROVED", true, "VERIFIED"), "APPROVED");
  });
});

describe("isUnverifiedCompletionClaim", () => {
  test("false for any non-completion status", () => {
    assert.equal(isUnverifiedCompletionClaim("IN_PROGRESS", false, null), false);
  });

  test("true for a completion status with no workspace or an unverified one", () => {
    assert.equal(isUnverifiedCompletionClaim("READY_FOR_REVIEW", false, null), true);
    assert.equal(isUnverifiedCompletionClaim("READY_FOR_REVIEW", true, "BUILDING"), true);
  });

  test("false for a completion status with a VERIFIED workspace", () => {
    assert.equal(isUnverifiedCompletionClaim("READY_FOR_REVIEW", true, "VERIFIED"), false);
  });
});

describe("getPreviewStatusLabel", () => {
  test("NOT RUNNABLE when there is no workspace, or the workspace is untouched", () => {
    assert.equal(getPreviewStatusLabel(false, null, false), "NOT RUNNABLE");
    assert.equal(getPreviewStatusLabel(true, "NOT_STARTED", false), "NOT RUNNABLE");
  });

  test("BUILD FAILED when the real deliverable's last verification failed", () => {
    assert.equal(getPreviewStatusLabel(true, "FAILED", true), "BUILD FAILED");
  });

  test("VERIFYING while a build/verification is in progress", () => {
    assert.equal(getPreviewStatusLabel(true, "BUILDING", false), "VERIFYING");
    assert.equal(getPreviewStatusLabel(true, "VERIFYING", false), "VERIFYING");
  });

  test("PREVIEW READY only when VERIFIED and an index.html actually exists", () => {
    assert.equal(getPreviewStatusLabel(true, "VERIFIED", true), "PREVIEW READY");
    assert.equal(getPreviewStatusLabel(true, "VERIFIED", false), "NOT RUNNABLE", "VERIFIED with no index.html is not runnable, never claimed ready");
  });
});

describe("isStalledWithNoDeliverable (local multi-model routing follow-up, Part 7)", () => {
  test("true: every task DONE, IN_PROGRESS, but no workspace ever existed — the exact real acceptance-run failure mode", () => {
    assert.equal(isStalledWithNoDeliverable({ status: "IN_PROGRESS", allTasksDone: true, hasWorkspace: false, deliveryState: null }), true);
  });

  test("true: every task DONE, IN_PROGRESS, workspace exists but the last build FAILED", () => {
    assert.equal(isStalledWithNoDeliverable({ status: "IN_PROGRESS", allTasksDone: true, hasWorkspace: true, deliveryState: "FAILED" }), true);
  });

  test("false: not every task is DONE yet — still legitimately working", () => {
    assert.equal(isStalledWithNoDeliverable({ status: "IN_PROGRESS", allTasksDone: false, hasWorkspace: false, deliveryState: null }), false);
  });

  test("false: project status is not IN_PROGRESS (e.g. already BLOCKED, PAUSED, or a real terminal state)", () => {
    for (const status of ["BLOCKED", "PAUSED", "READY_FOR_REVIEW", "DRAFT"] as const) {
      assert.equal(isStalledWithNoDeliverable({ status, allTasksDone: true, hasWorkspace: false, deliveryState: null }), false);
    }
  });

  test("false: every task DONE, IN_PROGRESS, but the deliverable is actually VERIFIED, BUILDING, or VERIFYING — not actually stuck", () => {
    for (const state of ["VERIFIED", "BUILDING", "VERIFYING"] as const) {
      assert.equal(isStalledWithNoDeliverable({ status: "IN_PROGRESS", allTasksDone: true, hasWorkspace: true, deliveryState: state }), false);
    }
  });
});
