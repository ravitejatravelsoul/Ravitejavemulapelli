import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { cache } from "react";
import { isRemoteExecutionMode } from "./remote/execution-mode.ts";

/**
 * The single mode-aware data-provider boundary every Office UI page
 * uses instead of calling `getAppDatabase()` directly. Local mode:
 * returns the existing persistent local DB, unmodified. Remote mode:
 * hydrates every remote project's bundle into one shared ephemeral DB
 * (lib/ai-office/remote/remote-dashboard-store.ts — the same mechanism
 * already proven in production) and returns that. Every existing
 * domain/dashboard function (`getOfficeOverview`, `getProjectDetail`,
 * `getProjectSummaries`, ...) takes a plain `DatabaseSync` and needs no
 * change at all — this is the whole fix: one shared UI, one shared data
 * shape, only the source of the handle differs.
 *
 * `cache()` (React's per-request memoization, same pattern
 * `verifySession()` already uses) so multiple components in one render
 * share one hydration — remote mode's GitHub reads happen once per
 * request, not once per component.
 *
 * Dynamic `import()`s only, both branches — this module itself must stay
 * safe to import even when NEITHER mode is configured (the
 * limited-production shell never calls this, but importing it must never
 * risk touching `node:sqlite` — same discipline as
 * app/office/(protected)/layout.tsx's own docblock explains at length).
 */
export const getOfficeDb = cache(async (): Promise<DatabaseSync> => {
  if (isRemoteExecutionMode()) {
    const { hydrateAllRemoteProjects } = await import("./remote/remote-dashboard-store.ts");
    const { db } = await hydrateAllRemoteProjects();
    return db;
  }
  const { getAppDatabase } = await import("./db/client.ts");
  return getAppDatabase();
});
