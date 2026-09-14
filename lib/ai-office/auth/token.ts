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

/**
 * Minimum key material for HS256. 32 bytes (256 bits) matches HS256's
 * output/security strength — the same floor `openssl rand -base64 32`
 * (the generation command documented in .env.example) is sized for.
 * Deliberately a simple length check on the exact bytes used as key
 * material (`encoder.encode(secret)`), not an entropy estimate — no new
 * dependency required, and a short-but-"random-looking" secret is exactly
 * the case this needs to catch.
 */
const MIN_SESSION_SECRET_BYTES = 32;

export interface OfficeSessionPayload {
  userId: string;
}

/**
 * Fails closed for both a missing AND a too-short secret — never pads,
 * truncates, hashes, or otherwise transforms a weak value into something
 * "usable." A misconfigured secret means no session can be created or
 * verified, full stop; see docs/ai-office/08-security-plan.md §2.
 */
function getSecretKey(): Uint8Array | null {
  const secret = process.env.OFFICE_SESSION_SECRET;
  if (!secret) return null;
  const keyBytes = encoder.encode(secret);
  if (keyBytes.length < MIN_SESSION_SECRET_BYTES) return null;
  return keyBytes;
}

/** Returns null (rather than throwing) when OFFICE_SESSION_SECRET is unset or too weak, so a bad secret fails closed as "no session" instead of crashing route resolution or silently signing with weak key material. */
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
