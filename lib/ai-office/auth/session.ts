import "server-only";
import { cookies } from "next/headers";
import { signSessionToken, verifySessionToken, type OfficeSessionPayload } from "@/lib/ai-office/auth/token";

/**
 * Cookie-backed session lifecycle for the AI Office owner — Server
 * Components/Actions only (uses `next/headers`, which Next.js itself
 * refuses to bundle into a Client Component). Session payload is
 * deliberately minimal ({ userId }), matching
 * docs/ai-office/08-security-plan.md §2.
 */

export const OFFICE_SESSION_COOKIE = "office_session";
const SESSION_LIFETIME = "7d";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** True in production, so the `Secure` cookie attribute is set correctly for both plain-HTTP localhost and any future HTTPS deployment without a separate code path — see 08-security-plan.md §11. */
function isSecureEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Creates a signed session cookie for the owner. Returns false if OFFICE_SESSION_SECRET isn't configured, so the login action can surface a clear setup error instead of silently "succeeding" with no real session. */
export async function createOfficeSession(userId: string): Promise<boolean> {
  const token = await signSessionToken({ userId }, SESSION_LIFETIME);
  if (!token) return false;

  const cookieStore = await cookies();
  cookieStore.set(OFFICE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureEnvironment(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return true;
}

export async function destroyOfficeSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(OFFICE_SESSION_COOKIE);
}

/** Reads and verifies the session cookie for the current request. Not cached — see dal.ts's `verifySession()` for the memoized, per-render version everything else should call. */
export async function readOfficeSession(): Promise<OfficeSessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OFFICE_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
