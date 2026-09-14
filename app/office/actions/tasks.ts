"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOwner } from "@/lib/ai-office/domain/users";
import { getTask } from "@/lib/ai-office/domain/tasks";
import { retryEscalatedTask } from "@/lib/ai-office/control/task-transitions";
import { isAiOfficeOperationalModeEnabled, OPERATIONAL_MODE_DISABLED_MESSAGE } from "@/lib/ai-office/config/operational-mode";

export interface TaskActionState {
  error?: string;
}

/**
 * Retry — the authenticated entry point for `retryEscalatedTask`
 * (lib/ai-office/control/task-transitions.ts). Only ever meaningful for a
 * task that's actually BLOCKED (escalated past its retry ceiling); the
 * service function itself re-validates this rather than trusting the UI
 * only showed the button when it should have.
 */
export async function retryTaskAction(taskId: string, note?: string): Promise<TaskActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (!isAiOfficeOperationalModeEnabled()) return { error: OPERATIONAL_MODE_DISABLED_MESSAGE };
  if (typeof taskId !== "string" || taskId.length === 0) return { error: "Invalid task." };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  const task = getTask(db, taskId);
  const result = retryEscalatedTask(db, taskId, owner.id, note?.trim() || undefined);
  revalidatePath("/office");
  if (task) revalidatePath(`/office/projects/${task.projectId}`);
  return result.ok ? {} : { error: result.reason };
}
