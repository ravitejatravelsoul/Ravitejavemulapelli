import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAgentRoles } from "../db/seed.ts";
import { setOfficeStatus } from "../domain/office.ts";
import { getOrCreateOfficeBudgetRecord, updateOfficeBudgetCap, startOfCurrentMonthUtc } from "../domain/budget.ts";
import { restoreProjectBundle, type ProjectBundle } from "./project-bundle.ts";
import { readOfficeState, readProjectBundle, remoteClientFromEnv, seedSyntheticOwner, type RemoteRuntimeConfig } from "./remote-state-store.ts";
import { GitHubClient } from "./github-client.ts";

/**
 * Read-only multi-project hydration for the Remote Mode dashboard —
 * deliberately different from remote-worker.ts's single-project
 * hydration (which exists to execute one bounded task step). Here,
 * every remote project's bundle is restored into ONE shared ephemeral
 * database, so `lib/ai-office/dashboard/dashboard-data.ts`'s existing
 * office-wide functions (`getOfficeOverview`, `getProjectSummaries`,
 * `getRecentActivity`, `getPendingApprovalsView`, `getBudgetView`) work
 * completely unmodified — they were written to aggregate across every
 * project in one local `.data/office.db`, and a read-only ephemeral DB
 * containing every remote project's rows (unique IDs, no collision risk
 * across projects) is exactly that shape. This is a read path only —
 * never flushed back; the worker (remote-worker.ts) is the only writer.
 *
 * Realistic scale note: this is a single-owner tool, not a multi-tenant
 * one — hydrating every remote project's full bundle on every dashboard
 * view is the right tradeoff for a handful of projects. If that count
 * ever grows large, `projects-index.json` alone (already read
 * independently, see below) is enough for a lightweight list view
 * without hydrating everything — worth revisiting then, not before.
 */

export interface ProjectIndexEntry {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

export async function readProjectsIndex(config: RemoteRuntimeConfig): Promise<ProjectIndexEntry[]> {
  const gh = new GitHubClient(config);
  const file = await gh.getFile("state/projects-index.json");
  if (!file) return [];
  const parsed = JSON.parse(file.content) as { projects: ProjectIndexEntry[] };
  return parsed.projects;
}

export interface RemoteDashboardHydration {
  db: DatabaseSync;
  projectIds: string[];
}

/** Hydrates every remote project's bundle into one shared, read-only ephemeral database. Safe to call on every dashboard render — a few Contents API reads, no writes. */
export async function hydrateAllRemoteProjects(config?: RemoteRuntimeConfig): Promise<RemoteDashboardHydration> {
  const remoteConfig = config ?? remoteClientFromEnv();
  const [{ state: office }, index] = await Promise.all([readOfficeState(remoteConfig), readProjectsIndex(remoteConfig)]);

  const db = openDatabase(":memory:");
  runMigrations(db);
  seedAgentRoles(db);
  seedSyntheticOwner(db);

  setOfficeStatus(db, { state: office.state, changedBy: office.changedBy, reason: office.reason });
  const periodStart = startOfCurrentMonthUtc();
  getOrCreateOfficeBudgetRecord(db, periodStart);
  updateOfficeBudgetCap(db, periodStart, { capUsd: office.officeBudget.capUsd, warnAtPercent: office.officeBudget.warnAtPercent });

  const bundles = await Promise.all(index.map((entry) => readProjectBundle(remoteConfig, entry.id)));
  for (const { bundle } of bundles) {
    if (bundle) restoreProjectBundle(db, bundle);
  }

  return { db, projectIds: index.map((e) => e.id) };
}

export type { ProjectBundle };
