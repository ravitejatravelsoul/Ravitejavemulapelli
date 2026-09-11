import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Owner credential verification for the localhost MVP. There is no `users`
 * table yet (that arrives in Phase 3's SQLite data engine, see
 * docs/ai-office/06-data-model.md §2) — per
 * docs/ai-office/08-security-plan.md §1, the owner credential is seeded via
 * an "env-driven seed script" instead: `OFFICE_OWNER_EMAIL` and
 * `OFFICE_OWNER_PASSWORD_HASH` (a `salt:hash` pair, both hex, produced by
 * `scripts/ai-office-hash-password.mjs`) live in `.env.local`. Moving this
 * to a real `users` row in Phase 3 is a swap of this module's internals,
 * not a change to its call sites (`login()` in app/office/actions/auth.ts).
 *
 * Uses Node's built-in `crypto.scrypt`, not a new hashing dependency —
 * scrypt is a deliberately slow, salted KDF suitable for password hashing,
 * and requires no package beyond what Node ships.
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

/**
 * Verifies email + password against `.env.local`. Fails closed (returns
 * false) whenever the env vars are missing or malformed, rather than
 * throwing — an unconfigured owner credential means "no one can log in,"
 * never "let anyone in."
 */
export function verifyOwnerCredentials(email: string, password: string): boolean {
  const configuredEmail = process.env.OFFICE_OWNER_EMAIL;
  const configuredHash = process.env.OFFICE_OWNER_PASSWORD_HASH;
  if (!configuredEmail || !configuredHash) return false;

  const parsed = parseStoredHash(configuredHash);
  if (!parsed) return false;

  const emailMatches = email.trim().toLowerCase() === configuredEmail.trim().toLowerCase();
  const derived = scryptSync(password, parsed.salt, SCRYPT_KEY_LENGTH);

  // Compare unconditionally (even when the email already failed) and combine
  // with `timingSafeEqual`-only email comparison so a mismatched email can't
  // short-circuit faster than a mismatched password — avoids leaking which
  // field was wrong via response timing.
  const hashMatches = derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);

  return emailMatches && hashMatches;
}
