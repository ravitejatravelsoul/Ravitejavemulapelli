import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * users repository. Single-owner table — in practice always at most one
 * row (see docs/ai-office/06-data-model.md §2). The initial owner row is
 * normally created by `lib/ai-office/db/seed.ts`'s env-driven seed, not
 * through this file's `createOwner` — that export exists for tests and
 * for a possible future admin flow, not a public signup path (there is
 * none).
 */

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  role: "owner";
  createdAt: number;
  updatedAt: number;
}

export type PublicUser = Omit<UserRow, "passwordHash">;

/** Strips passwordHash — use this (never the raw row) anywhere a user record might reach a client-visible response. Lists fields explicitly, rather than destructuring the hash away, so it's obvious at a glance exactly what's public-safe. */
export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/**
 * Includes `passwordHash` — for credential verification only
 * (lib/ai-office/auth/credentials.ts). Never pass this row's result
 * directly into any response, log line, or event/audit payload.
 */
export function getUserByEmail(db: DatabaseSync, email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
}

export function getOwner(db: DatabaseSync): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE role = 'owner' LIMIT 1").get() as UserRow | undefined;
}

export function createOwner(db: DatabaseSync, input: { email: string; passwordHash: string }): UserRow {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, passwordHash, role, createdAt, updatedAt)
     VALUES (?, ?, ?, 'owner', ?, ?)`,
  ).run(id, input.email.trim().toLowerCase(), input.passwordHash, now, now);

  return getUserByEmail(db, input.email) as UserRow;
}
