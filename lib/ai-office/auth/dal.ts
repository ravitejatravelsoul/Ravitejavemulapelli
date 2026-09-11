import "server-only";
import { cache } from "react";
import { readOfficeSession } from "@/lib/ai-office/auth/session";

/**
 * Data Access Layer — the real authorization boundary for everything under
 * `/office/**`. `proxy.ts` only does an optimistic redirect; every Server
 * Component, Server Action, and Route Handler in the private workspace must
 * call `verifySession()` itself rather than trusting that a parent layout
 * already checked (App Router layouts don't re-run on client-side
 * navigation — see docs/ai-office/08-security-plan.md §2, §5).
 *
 * Wrapped in React's `cache()` so multiple calls during a single render
 * pass only decode the cookie once.
 */
export const verifySession = cache(async (): Promise<{ userId: string } | null> => {
  const session = await readOfficeSession();
  if (!session) return null;
  return { userId: session.userId };
});
