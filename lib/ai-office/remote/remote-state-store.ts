import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAgentRoles } from "../db/seed.ts";
import { getOfficeStatus, setOfficeStatus, type OfficeState } from "../domain/office.ts";
import { getOrCreateOfficeBudgetRecord, updateOfficeBudgetCap, startOfCurrentMonthUtc } from "../domain/budget.ts";
import { dumpProjectBundle, restoreProjectBundle, type ProjectBundle } from "./project-bundle.ts";
import { GitHubClient, GitHubContentConflictError } from "./github-client.ts";

/**
 * The hydrate/flush boundary described in teja-ai-office-runtime's
 * README: everything on the "hydrate in, run the real unmodified
 * runOneCycle()/executeTask() against it, flush out" pattern lives here.
 * Nothing in lib/ai-office/domain/**, agent-runner.ts, or runner.ts is
 * aware this module exists — they just receive a normal `DatabaseSync`
 * handle, exactly as they do locally.
 */

/**
 * A fixed, stable synthetic owner id/email — never a real credential,
 * never randomly regenerated (unlike `createOwner()`'s local-mode
 * behavior), because `projects.ownerId` must resolve to the SAME row on
 * every hydration of the same project. Remote Mode is still single-owner
 * (this whole system remains "owner-only" per every security doc in this
 * codebase); this row exists purely to satisfy `projects.ownerId`'s
 * `REFERENCES users (id)` foreign key, never to authenticate anyone —
 * the real authentication boundary is unchanged
 * (lib/ai-office/auth/dal.ts's `verifySession()`).
 */
export const REMOTE_SYNTHETIC_OWNER_ID = "remote-owner";
const REMOTE_SYNTHETIC_OWNER_EMAIL = "remote-owner@teja-ai-office.local";

export interface OfficeRemoteState {
  state: OfficeState;
  changedAt: number | null;
  changedBy: string | null;
  reason: string | null;
  officeBudget: { capUsd: number; warnAtPercent: number };
  updatedAt: string;
}

export const DEFAULT_OFFICE_REMOTE_STATE: OfficeRemoteState = {
  state: "OPEN",
  changedAt: null,
  changedBy: null,
  reason: null,
  officeBudget: { capUsd: 30, warnAtPercent: 80 },
  updatedAt: new Date(0).toISOString(),
};

function seedSyntheticOwner(db: DatabaseSync): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, passwordHash, role, createdAt, updatedAt)
     VALUES (?, ?, 'unused-remote-mode-has-no-password-login-for-this-row', 'owner', ?, ?)`,
  ).run(REMOTE_SYNTHETIC_OWNER_ID, REMOTE_SYNTHETIC_OWNER_EMAIL, now, now);
}

/**
 * Builds a fresh ephemeral SQLite database (`:memory:` — this job's own
 * process only, never written to disk, never shared across jobs) and
 * restores it to look exactly like a real local `.data/office.db` would
 * for this one project: migrated, catalog-seeded, the office-wide
 * singleton/budget restored from `office`, and (if provided) the
 * project's own bundle restored on top. `bundle` is `null` only when
 * hydrating for a brand-new project that doesn't exist yet.
 */
export function hydrateEphemeralDb(office: OfficeRemoteState, bundle: ProjectBundle | null): DatabaseSync {
  const db = openDatabase(":memory:");
  runMigrations(db);
  seedAgentRoles(db);
  seedSyntheticOwner(db);

  setOfficeStatus(db, { state: office.state, changedBy: office.changedBy, reason: office.reason });

  const periodStart = startOfCurrentMonthUtc();
  getOrCreateOfficeBudgetRecord(db, periodStart);
  updateOfficeBudgetCap(db, periodStart, { capUsd: office.officeBudget.capUsd, warnAtPercent: office.officeBudget.warnAtPercent });

  if (bundle) restoreProjectBundle(db, bundle);

  return db;
}

/** The inverse of `hydrateEphemeralDb` for the project-scoped half — see `dumpProjectBundle`. */
export function flushProjectBundle(db: DatabaseSync, projectId: string): ProjectBundle {
  return dumpProjectBundle(db, projectId);
}

/** The inverse of `hydrateEphemeralDb` for the office-wide half. */
export function flushOfficeState(db: DatabaseSync): OfficeRemoteState {
  const status = getOfficeStatus(db);
  const periodStart = startOfCurrentMonthUtc();
  const budget = getOrCreateOfficeBudgetRecord(db, periodStart);
  return {
    state: status?.state ?? "OPEN",
    changedAt: status?.changedAt ?? null,
    changedBy: status?.changedBy ?? null,
    reason: status?.reason ?? null,
    officeBudget: { capUsd: budget.capUsd, warnAtPercent: budget.warnAtPercent },
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------
// GitHub-backed read/write of the JSON files described in the runtime
// repo's README, with optimistic concurrency and bounded retry.
// ---------------------------------------------------------------------

export interface RemoteRuntimeConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export function remoteClientFromEnv(): RemoteRuntimeConfig {
  const token = process.env.AI_OFFICE_REMOTE_GITHUB_TOKEN;
  const owner = process.env.AI_OFFICE_REMOTE_REPO_OWNER;
  const repo = process.env.AI_OFFICE_REMOTE_REPO_NAME;
  const branch = process.env.AI_OFFICE_REMOTE_REPO_BRANCH || "main";
  if (!token || !owner || !repo) {
    throw new Error(
      "Remote Mode is missing required configuration: AI_OFFICE_REMOTE_GITHUB_TOKEN, AI_OFFICE_REMOTE_REPO_OWNER, and AI_OFFICE_REMOTE_REPO_NAME must all be set.",
    );
  }
  return { token, owner, repo, branch };
}

function client(config: RemoteRuntimeConfig): GitHubClient {
  return new GitHubClient(config);
}

export async function readOfficeState(config: RemoteRuntimeConfig): Promise<{ state: OfficeRemoteState; sha: string | null }> {
  const file = await client(config).getFile("state/office.json");
  if (!file) return { state: DEFAULT_OFFICE_REMOTE_STATE, sha: null };
  return { state: JSON.parse(file.content) as OfficeRemoteState, sha: file.sha };
}

export async function writeOfficeState(config: RemoteRuntimeConfig, state: OfficeRemoteState, expectedSha: string | null): Promise<string> {
  const result = await client(config).putFile("state/office.json", JSON.stringify(state, null, 2) + "\n", {
    message: `chore(state): update office.json (${state.state})`,
    expectedSha: expectedSha ?? undefined,
  });
  return result.sha;
}

export async function readProjectBundle(config: RemoteRuntimeConfig, projectId: string): Promise<{ bundle: ProjectBundle | null; sha: string | null }> {
  const file = await client(config).getFile(`state/projects/${projectId}.json`);
  if (!file) return { bundle: null, sha: null };
  return { bundle: JSON.parse(file.content) as ProjectBundle, sha: file.sha };
}

export async function writeProjectBundle(config: RemoteRuntimeConfig, bundle: ProjectBundle, expectedSha: string | null): Promise<string> {
  const result = await client(config).putFile(`state/projects/${bundle.projectId}.json`, JSON.stringify(bundle, null, 2) + "\n", {
    message: `chore(state): update project ${bundle.projectId}`,
    expectedSha: expectedSha ?? undefined,
  });
  return result.sha;
}

export { GitHubContentConflictError };
