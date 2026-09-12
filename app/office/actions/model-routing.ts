"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { setProjectModelPolicy, applyRecommendedRouting } from "@/lib/ai-office/domain/model-routing";

/**
 * Owner-only local model routing controls (local multi-model routing
 * follow-up, Part E/L) — every action here independently calls
 * `verifySession()`, exactly like every other `app/office/actions/**`
 * mutation. Never public, never exposes anything beyond what the owner
 * themselves chooses to configure.
 */

export interface ModelPolicyActionState {
  error?: string;
  success?: boolean;
}

const modeSchema = z.enum(["AUTO", "SINGLE_MODEL", "CUSTOM"]);

export async function setModelPolicyAction(
  projectId: string,
  _prevState: ModelPolicyActionState | undefined,
  formData: FormData,
): Promise<ModelPolicyActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof projectId !== "string" || projectId.length === 0) return { error: "Invalid project." };

  const modeResult = modeSchema.safeParse(formData.get("mode"));
  if (!modeResult.success) return { error: "Choose a valid model policy mode." };
  const mode = modeResult.data;

  const singleModelRaw = formData.get("singleModel");
  const singleModel = typeof singleModelRaw === "string" && singleModelRaw.trim().length > 0 ? singleModelRaw.trim() : null;
  if (mode === "SINGLE_MODEL" && !singleModel) {
    return { error: "Choose a model for SINGLE_MODEL mode." };
  }

  const customMapping: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("role:") || typeof value !== "string" || value.trim().length === 0) continue;
    customMapping[key.slice("role:".length)] = value.trim();
  }

  const db = getAppDatabase();
  setProjectModelPolicy(db, projectId, {
    mode,
    singleModel: mode === "SINGLE_MODEL" ? singleModel : null,
    customMapping: mode === "CUSTOM" && Object.keys(customMapping).length > 0 ? customMapping : null,
  });

  revalidatePath(`/office/projects/${projectId}`);
  return { success: true };
}

/** Never called automatically by anything — the sole, explicit owner gate that lets a benchmark-derived recommendation actually change what AUTO mode uses (Part L). */
export async function applyRecommendedRoutingAction(): Promise<{ error?: string; success?: boolean }> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  const db = getAppDatabase();
  applyRecommendedRouting(db);
  revalidatePath("/office/local-models");
  return { success: true };
}
