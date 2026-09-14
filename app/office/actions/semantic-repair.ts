"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOwner } from "@/lib/ai-office/domain/users";
import { approveSemanticRepairPlan, rejectSemanticRepairPlan, executeApprovedSemanticRepair } from "@/lib/ai-office/engineer/semantic-repair-execution";

export interface SemanticRepairActionState {
  error?: string;
}

/**
 * Authenticated entry points into Office Engineer's semantic-repair
 * capability — same pattern as app/office/actions/approvals.ts. Every
 * real gate (Claude approval, LIVE budget, context budget) still lives
 * inside `executeApprovedSemanticRepair`/`executeTask`; this file is only
 * the session-verified doorway into them, never a shortcut past them.
 */
export async function approveSemanticRepairAction(planId: string): Promise<SemanticRepairActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof planId !== "string" || planId.length === 0) return { error: "Invalid plan." };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  try {
    approveSemanticRepairPlan(db, planId, owner.id);
    revalidatePath("/office/engineer");
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function rejectSemanticRepairAction(planId: string, note?: string): Promise<SemanticRepairActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof planId !== "string" || planId.length === 0) return { error: "Invalid plan." };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  try {
    rejectSemanticRepairPlan(db, planId, owner.id, note);
    revalidatePath("/office/engineer");
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Runs the one bounded repair call. This is a real paid action once
 * Claude is configured/approved for the project — the owner should have
 * already seen the estimated cost (shown on the plan before this is
 * ever clickable) before choosing to run it.
 */
export async function executeSemanticRepairAction(planId: string): Promise<SemanticRepairActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof planId !== "string" || planId.length === 0) return { error: "Invalid plan." };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  const result = await executeApprovedSemanticRepair(db, planId, owner.id);
  revalidatePath("/office/engineer");
  return result.status === "repaired" ? {} : { error: result.reason };
}
