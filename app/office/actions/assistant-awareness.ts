"use server";

import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getAssistantAwareness, type AssistantAwareness } from "@/lib/ai-office/assistant/assistant-data";

export async function getAssistantAwarenessAction(): Promise<AssistantAwareness | null> {
  const session = await verifySession();
  if (!session) return null;
  return getAssistantAwareness(getAppDatabase());
}
