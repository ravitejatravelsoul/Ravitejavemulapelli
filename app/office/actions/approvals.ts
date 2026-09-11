"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOwner } from "@/lib/ai-office/domain/users";
import { approveApproval, rejectApproval } from "@/lib/ai-office/approvals/approval-service";

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
 */
export async function approveApprovalAction(approvalId: string, note?: string): Promise<ApprovalDecisionActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof approvalId !== "string" || approvalId.length === 0) return { error: "Invalid approval." };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  const result = approveApproval(db, { approvalId, decidedByUserId: owner.id, note: note?.trim() || undefined });
  revalidatePath("/office");
  return result.ok ? {} : { error: result.reason };
}

export async function rejectApprovalAction(approvalId: string, note?: string): Promise<ApprovalDecisionActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof approvalId !== "string" || approvalId.length === 0) return { error: "Invalid approval." };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  const result = rejectApproval(db, { approvalId, decidedByUserId: owner.id, note: note?.trim() || undefined });
  revalidatePath("/office");
  return result.ok ? {} : { error: result.reason };
}
