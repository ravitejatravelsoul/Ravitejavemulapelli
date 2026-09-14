"use server";

import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOwner } from "@/lib/ai-office/domain/users";
import { handleAssistantText, executeConfirmedAction, type AssistantTurn, type PendingAction } from "@/lib/ai-office/assistant/assistant-service";

/**
 * The one entry point the Teja Assistant panel calls — owner-only
 * (`verifySession()`, exactly like every other mutation-capable Server
 * Action in this codebase), read commands answered immediately, mutating
 * commands requiring a separate confirmed call (Section S).
 */
export async function sendAssistantMessageAction(text: string): Promise<AssistantTurn> {
  const session = await verifySession();
  if (!session) return { message: "You must be signed in." };

  const db = getAppDatabase();
  return handleAssistantText(db, text);
}

export async function confirmAssistantActionAction(action: PendingAction): Promise<AssistantTurn> {
  const session = await verifySession();
  if (!session) return { message: "You must be signed in." };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { message: "Owner account not found." };

  return executeConfirmedAction(db, owner.id, action);
}
