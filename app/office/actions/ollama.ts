"use server";

import { verifySession } from "@/lib/ai-office/auth/dal";
import { checkOllamaHealth, type OllamaHealth } from "@/lib/ai-office/providers/ollama/health";

/**
 * Owner-only Ollama health check — called from the New Project form when
 * "Ollama Local" is selected. Read-only, never polled on an interval;
 * an unauthenticated caller gets an honest "offline" rather than any
 * detail about this server's local configuration.
 */
export async function checkOllamaHealthAction(): Promise<OllamaHealth> {
  const session = await verifySession();
  if (!session) return { online: false, models: [] };
  return checkOllamaHealth();
}
