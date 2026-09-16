"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOwner } from "@/lib/ai-office/domain/users";
import { approveApproval, rejectApproval, revokeApproval } from "@/lib/ai-office/approvals/approval-service";
import { isAiOfficeOperationalModeEnabled, OPERATIONAL_MODE_DISABLED_MESSAGE } from "@/lib/ai-office/config/operational-mode";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";
import { decideRemoteApproval } from "@/app/office/actions/remote-approvals";

export interface ApprovalDecisionActionState {
  error?: string;
}

/**
 * Approve/Reject — no destructive action ever actually occurs here
 * (Phase 6 scope: these are persisted decisions + simulated-execution
 * gates only). Both independently verify the session and treat
 * `approvalId` from the browser as untrusted; `approveApproval`/
 * `rejectApproval` (lib/ai-office/approvals/approval-service.ts) already
 * enforce exact-scope semantics and idempotent double-decision safety —
 * this file is only the authenticated entry point into them.
 *
 * `projectId` is only required in Remote Mode (a remote project's state
 * lives in its own GitHub-backed bundle, so the write must be scoped to
 * it — see decideRemoteApproval/withRemoteProjectMutation); local mode
 * ignores it since the whole SQLite DB is already in scope.
 */
export async function approveApprovalAction(approvalId: string, projectId?: string | null, note?: string): Promise<ApprovalDecisionActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof approvalId !== "string" || approvalId.length === 0) return { error: "Invalid approval." };

  if (isRemoteExecutionMode()) {
    if (!projectId) return { error: "Missing project for remote approval." };
    const result = await decideRemoteApproval(projectId, approvalId, note, "approve");
    revalidatePath("/office");
    revalidatePath(`/office/projects/${projectId}`);
    return result;
  }

  if (!isAiOfficeOperationalModeEnabled()) return { error: OPERATIONAL_MODE_DISABLED_MESSAGE };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  const result = approveApproval(db, { approvalId, decidedByUserId: owner.id, note: note?.trim() || undefined });
  revalidatePath("/office");
  if (result.ok && result.approval.projectId) revalidatePath(`/office/projects/${result.approval.projectId}`);
  return result.ok ? {} : { error: result.reason };
}

export async function rejectApprovalAction(approvalId: string, projectId?: string | null, note?: string): Promise<ApprovalDecisionActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof approvalId !== "string" || approvalId.length === 0) return { error: "Invalid approval." };

  if (isRemoteExecutionMode()) {
    if (!projectId) return { error: "Missing project for remote approval." };
    const result = await decideRemoteApproval(projectId, approvalId, note, "reject");
    revalidatePath("/office");
    revalidatePath(`/office/projects/${projectId}`);
    return result;
  }

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  const result = rejectApproval(db, { approvalId, decidedByUserId: owner.id, note: note?.trim() || undefined });
  revalidatePath("/office");
  if (result.ok && result.approval.projectId) revalidatePath(`/office/projects/${result.approval.projectId}`);
  return result.ok ? {} : { error: result.reason };
}

/**
 * Revoke — undoes an APPROVED decision before the underlying paid action
 * has actually started (`revokeApproval` in approval-service.ts is the
 * one place that decides whether it's still safe to; this action is only
 * the authenticated entry point). Never a silent revert to PENDING — the
 * approval moves to a real, auditable revoked state, and the next time
 * this same work is encountered, the existing approval workflow asks the
 * owner again from scratch.
 *
 * Remote Mode does not yet have a revoke path (no remote decision has
 * ever been dispatched to GitHub Actions before this gate exists to
 * revoke it against) — disclosed as LOCAL ONLY rather than silently
 * failing or faking success.
 */
export async function revokeApprovalAction(approvalId: string, note?: string): Promise<ApprovalDecisionActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof approvalId !== "string" || approvalId.length === 0) return { error: "Invalid approval." };

  if (isRemoteExecutionMode()) {
    return { error: "Revoking an approval is only available in Local Mode." };
  }

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  const result = revokeApproval(db, { approvalId, revokedByUserId: owner.id, note: note?.trim() || undefined });
  revalidatePath("/office");
  if (result.ok && result.approval.projectId) revalidatePath(`/office/projects/${result.approval.projectId}`);
  return result.ok ? {} : { error: result.reason };
}
