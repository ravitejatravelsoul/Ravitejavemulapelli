"use server";

import { verifySession } from "@/lib/ai-office/auth/dal";
import { isClaudeConfigured } from "@/lib/ai-office/providers/claude/claude-adapter";

export interface ClaudeHealth {
  configured: boolean;
}

/**
 * Owner-only Claude configuration status (controlled Claude LIVE pilot,
 * Part 20) — reports only whether a credential + pricing configuration
 * are present, never whether they're *valid*. Deliberately never makes a
 * real Anthropic API call: rendering this status must never itself cost
 * money. An unauthenticated caller gets an honest "not configured"
 * rather than any detail about this server's configuration.
 */
export async function checkClaudeHealthAction(): Promise<ClaudeHealth> {
  const session = await verifySession();
  if (!session) return { configured: false };
  return { configured: isClaudeConfigured() };
}
