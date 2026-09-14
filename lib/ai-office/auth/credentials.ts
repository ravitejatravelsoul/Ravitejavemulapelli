import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getUserByEmail } from "@/lib/ai-office/domain/users";

/**
 * Owner credential verification, now backed by the real `users` table
 * (Phase 3's SQLite data engine — see docs/ai-office/06-data-model.md
 * §2). Phase 1/2 read `OFFICE_OWNER_EMAIL`/`OFFICE_OWNER_PASSWORD_HASH`
 * directly from `.env.local` on every login attempt; those same two
 * env vars are now only a **one-time seed source** for the `users` row
 * (see lib/ai-office/db/seed.ts's `seedOwnerFromEnv` — it never
 * overwrites an existing row), exactly the "env-driven seed script"
 * option docs/ai-office/08-security-plan.md §1 names. This file's
 * exported function signature is unchanged, so
 * app/office/actions/auth.ts (its only caller) needed no changes.
 *
 * Uses Node's built-in `crypto.scrypt`, not a new hashing dependency —
 * scrypt is a deliberately slow, salted KDF suitable for password hashing,
 * and requires no package beyond what Node ships. `passwordHash` never
 * leaves this module or `lib/ai-office/domain/users.ts`'s
 * credential-only `getUserByEmail` — nothing here logs it, and the
 * public-facing `toPublicUser()` helper in that file strips it before
 * any user row could ever reach a client-visible response.
 */

const SCRYPT_KEY_LENGTH = 64;

export function hashOwnerPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `${salt}:${derived.toString("hex")}`;
}

function parseStoredHash(stored: string): { salt: string; hash: Buffer } | null {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return null;
  try {
    return { salt, hash: Buffer.from(hashHex, "hex") };
  } catch {
    return null;
  }
}

// Fixed dummy salt used only when no user row is found, purely so a
// scrypt computation always runs — otherwise a nonexistent email would
// return measurably faster than a wrong password for a real one,
// leaking which case occurred via response timing (the same property
// the Phase 1/2 env-backed version guarded against explicitly).
const DUMMY_SALT = "0".repeat(32);

/**
 * Verifies email + password against the `users` table. Fails closed
 * (returns false) whenever no matching user exists, the stored hash is
 * malformed, or the database itself is unreachable — never throws, so a
 * misconfigured/missing database means "no one can log in," the same
 * fail-closed guarantee Phase 1/2 had for a missing `.env.local`, never
 * a crashed login page that could leak a stack trace.
 */
export function verifyOwnerCredentials(email: string, password: string): boolean {
  let storedHash: string | undefined;
  try {
    const db = getAppDatabase();
    storedHash = getUserByEmail(db, email)?.passwordHash;
  } catch {
    storedHash = undefined;
  }

  const parsed = storedHash ? parseStoredHash(storedHash) : null;
  const salt = parsed?.salt ?? DUMMY_SALT;
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);

  if (!parsed) return false;
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}
