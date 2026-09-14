import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
// Relative, extension-explicit — not the usual "@/..." alias — so this
// module can run directly under plain `node --test` (see credentials.test.ts),
// matching the same precedent already established in lib/ai-office/db/client.ts.
import { getAppDatabase } from "../db/client.ts";
import { getUserByEmail } from "../domain/users.ts";

/**
 * Owner credential verification, backed by the real `users` table
 * (Phase 3's SQLite data engine — see docs/ai-office/06-data-model.md
 * §2) for local/non-production use. `OFFICE_OWNER_EMAIL`/
 * `OFFICE_OWNER_PASSWORD_HASH` are also a **one-time seed source** for
 * the `users` row in that environment (see lib/ai-office/db/seed.ts's
 * `seedOwnerFromEnv` — it never overwrites an existing row), exactly the
 * "env-driven seed script" option docs/ai-office/08-security-plan.md §1
 * names.
 *
 * In production (`NODE_ENV === "production"`), verification instead
 * reads `OFFICE_OWNER_EMAIL`/`OFFICE_OWNER_PASSWORD_HASH` directly and
 * never touches SQLite at all. Vercel's serverless filesystem is not
 * durable/shared across instances, so a `users` row seeded on one
 * cold-started instance is not guaranteed to exist on the instance that
 * serves a later login request — this production path sidesteps that
 * entirely by treating the two env vars as the source of truth on every
 * request, not just as a one-time seed. `app/office/actions/auth.ts`
 * (this module's only caller) needed no changes — the exported function
 * signature is unchanged.
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

// Fixed dummy salt used only when no stored hash is available (no
// matching user row locally, or missing/malformed env config in
// production), purely so a scrypt computation always runs — otherwise a
// nonexistent email/missing config would return measurably faster than a
// wrong password for a real one, leaking which case occurred via
// response timing.
const DUMMY_SALT = "0".repeat(32);

/**
 * Core scrypt-derive + timing-safe-compare step, shared by both the
 * local (SQLite-backed) and production (env-backed) verification paths
 * so the actual cryptographic check exists in exactly one place. Always
 * runs a real `scryptSync` call — using `DUMMY_SALT` when `storedHash`
 * is absent or malformed — so "no stored hash" and "wrong password"
 * take the same amount of time.
 */
function verifyPasswordAgainstStoredHash(password: string, storedHash: string | undefined): boolean {
  const parsed = storedHash ? parseStoredHash(storedHash) : null;
  const salt = parsed?.salt ?? DUMMY_SALT;
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);

  if (!parsed) return false;
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

/**
 * Production verification path: reads `OFFICE_OWNER_EMAIL`/
 * `OFFICE_OWNER_PASSWORD_HASH` directly on every call and never touches
 * SQLite. Fails closed if either env var is absent or the hash is
 * malformed. The password check always runs (even on an email
 * mismatch or missing/malformed config) so email mismatch, missing
 * config, and wrong password are not distinguishable by timing.
 */
function verifyOwnerCredentialsFromEnv(email: string, password: string): boolean {
  const configuredEmail = process.env.OFFICE_OWNER_EMAIL;
  const configuredHash = process.env.OFFICE_OWNER_PASSWORD_HASH;

  const emailMatches =
    typeof configuredEmail === "string" && configuredEmail.trim().toLowerCase() === email.trim().toLowerCase();

  const passwordMatches = verifyPasswordAgainstStoredHash(password, configuredHash);

  return emailMatches && passwordMatches;
}

/**
 * Verifies email + password. In production (`NODE_ENV === "production"`),
 * checks directly against `OFFICE_OWNER_EMAIL`/`OFFICE_OWNER_PASSWORD_HASH`
 * — see the module docblock above for why. Everywhere else, verifies
 * against the `users` table, unchanged from before: fails closed
 * (returns false) whenever no matching user exists, the stored hash is
 * malformed, or the database itself is unreachable — never throws, so a
 * misconfigured/missing database means "no one can log in," never a
 * crashed login page that could leak a stack trace.
 */
export function verifyOwnerCredentials(email: string, password: string): boolean {
  if (process.env.NODE_ENV === "production") {
    return verifyOwnerCredentialsFromEnv(email, password);
  }

  let storedHash: string | undefined;
  try {
    const db = getAppDatabase();
    storedHash = getUserByEmail(db, email)?.passwordHash;
  } catch {
    storedHash = undefined;
  }

  return verifyPasswordAgainstStoredHash(password, storedHash);
}
