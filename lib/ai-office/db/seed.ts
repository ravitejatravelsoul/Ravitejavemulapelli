import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
// Relative + extension-explicit — see the comment in client.ts.
import { AGENT_ROLE_CATALOG } from "../domain/agent-role-catalog.ts";
import { startOfCurrentMonthUtc } from "../domain/budget.ts";

/**
 * Deterministic, idempotent seed data — safe to call on every
 * `getAppDatabase()` access (see client.ts). Every statement here uses
 * `INSERT OR IGNORE` keyed by a stable identity (a fixed PK, or a UNIQUE
 * constraint), so re-running never creates duplicates and never
 * overwrites data the owner or a later phase may have changed.
 */

/** Matches docs/ai-office/04-agent-architecture.md §1's catalog exactly — see lib/ai-office/domain/agent-role-catalog.ts for the source list and id-slug mapping. */
export function seedAgentRoles(db: DatabaseSync): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO agent_roles
      (id, name, responsibilities, allowedInputs, allowedOutputs, permittedActions, maxRetries, escalatesTo, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  for (const role of AGENT_ROLE_CATALOG) {
    insert.run(
      role.id,
      role.name,
      JSON.stringify(role.responsibilities),
      JSON.stringify(role.allowedInputs),
      JSON.stringify(role.allowedOutputs),
      JSON.stringify(role.permittedActions),
      role.maxRetries,
      role.escalatesTo,
      now,
      now,
    );
  }
}

/** office_status is a true singleton — INSERT OR IGNORE against the fixed 'singleton' PK means only the very first call ever creates the row. */
export function seedOfficeStatus(db: DatabaseSync): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO office_status (id, state, changedAt, changedBy, reason, createdAt, updatedAt)
     VALUES ('singleton', 'OPEN', ?, NULL, NULL, ?, ?)`,
  ).run(now, now, now);
}

/** Seeds the $30/month office-level cap for the current billing period. Per docs/ai-office/09-budget-and-cost-controls.md §1 — storage only, no enforcement (that's Phase 6). */
export function seedDefaultOfficeBudget(db: DatabaseSync): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO budget_records (id, scope, scopeId, periodStart, capUsd, warnAtPercent, createdAt, updatedAt)
     VALUES (?, 'office', 'office', ?, 30, 80, ?, ?)`,
  ).run(randomUUID(), startOfCurrentMonthUtc(), now, now);
}

/**
 * One-time owner seed from `.env.local`, per
 * docs/ai-office/08-security-plan.md §1's "env-driven seed script"
 * option. Only runs when both env vars are configured AND the `users`
 * table is still empty — never overwrites an existing owner row, so a
 * later password change (whenever that gets a real UI) isn't silently
 * clobbered by whatever happens to still be in `.env.local`. If the env
 * vars are absent, this is a no-op and login remains impossible until
 * they're set — the same fail-closed behavior Phase 1/2 already had.
 */
export function seedOwnerFromEnv(db: DatabaseSync): void {
  const email = process.env.OFFICE_OWNER_EMAIL;
  const passwordHash = process.env.OFFICE_OWNER_PASSWORD_HASH;
  if (!email || !passwordHash) return;

  const existing = db.prepare("SELECT id FROM users LIMIT 1").get();
  if (existing) return;

  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, email, passwordHash, role, createdAt, updatedAt)
     VALUES (?, ?, ?, 'owner', ?, ?)`,
  ).run(randomUUID(), email.trim().toLowerCase(), passwordHash, now, now);
}

export function seedAll(db: DatabaseSync): void {
  db.exec("BEGIN");
  try {
    seedOwnerFromEnv(db);
    seedAgentRoles(db);
    seedOfficeStatus(db);
    seedDefaultOfficeBudget(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
