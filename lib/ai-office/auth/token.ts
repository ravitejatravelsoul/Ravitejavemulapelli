import "server-only";
import { SignJWT, jwtVerify } from "jose";

/**
 * Pure JWT sign/verify helpers — no Next.js cookie APIs here so this module
 * can be imported both from Server Components/Actions (via session.ts) and
 * from `proxy.ts`, which reads cookies off the request object instead of
 * `next/headers`. Keeping the jose calls in one place means both call sites
 * verify the exact same way. See docs/ai-office/08-security-plan.md §2.
 */

const encoder = new TextEncoder();

export interface OfficeSessionPayload {
  userId: string;
}

function getSecretKey(): Uint8Array | null {
  const secret = process.env.OFFICE_SESSION_SECRET;
  if (!secret) return null;
  return encoder.encode(secret);
}

/** Returns null (rather than throwing) when OFFICE_SESSION_SECRET is unset, so a missing secret fails closed as "no session" instead of crashing route resolution. */
export async function signSessionToken(
  payload: OfficeSessionPayload,
  expiresIn: string,
): Promise<string | null> {
  const key = getSecretKey();
  if (!key) return null;

  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifySessionToken(token: string): Promise<OfficeSessionPayload | null> {
  const key = getSecretKey();
  if (!key) return null;

  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
