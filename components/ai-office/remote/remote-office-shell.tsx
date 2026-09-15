import { hydrateAllRemoteProjects } from "@/lib/ai-office/remote/remote-dashboard-store";
import { getOfficeOverview, getProjectSummaries, getRecentActivity, getBudgetView } from "@/lib/ai-office/dashboard/dashboard-data";
import { getProjectDetail, type ProjectDetail } from "@/lib/ai-office/dashboard/project-detail-data";
import { RemoteOfficeShellClient } from "./remote-office-shell-client";

/**
 * The entire Remote Mode authenticated experience — analogous to
 * app/office/(protected)/page.tsx (local mode's dashboard), but reading
 * from GitHub-committed state instead of `getAppDatabase()`, and
 * deliberately self-contained rather than composed from Next.js nested
 * child routes: `layout.tsx` renders *only* this component (never
 * `children`) when Remote Mode is enabled, so visiting any URL under
 * `/office/**` — including ones whose own page.tsx still has local-only
 * top-level imports (agents/analytics/communications/engineer/
 * local-models/settings/workspaces — none of them ported to Remote Mode
 * yet, a disclosed V1 scope limit, not an oversight) — can never reach
 * that code.
 *
 * Fetches every remote project's full detail upfront (see
 * remote-office-shell-client.tsx's docblock for why: layouts don't
 * receive `searchParams` in this Next.js version) and hands it all to a
 * client component that does the actual `?project=` view switch.
 *
 * `toPlainData` (a `JSON.parse(JSON.stringify(...))` round-trip) is
 * required before any of this crosses into the Client Component below —
 * caught by a real render, not inferred: `node:sqlite`'s `.all()`/
 * `.get()` result rows are not plain-prototype objects, and React's
 * Server-to-Client Component boundary explicitly rejects anything that
 * isn't ("Classes or null prototypes are not supported"). The existing
 * local dashboard (app/office/(protected)/page.tsx) never hit this
 * because its consumers of this same data
 * (OverviewCards/ProjectList/BudgetPanel/ActivityFeed) are all Server
 * Components themselves — nothing there ever crosses a client boundary.
 * This file's `RemoteOfficeShellClient` is the first place in this
 * codebase raw SQLite-derived data does, because it needs
 * `useSearchParams()` (a client-only hook — see that file's docblock).
 * A plain JSON round-trip is safe here specifically because every value
 * in play is already JSON-serializable data (numbers, strings, plain
 * nested objects/arrays) — never a class instance with real behavior to
 * preserve, never a Date (this schema stores epoch-ms numbers, not Date
 * objects), never the `signOut` Server Action itself (kept out of this
 * round-trip on purpose — Server Actions crossing this same boundary is
 * an explicitly supported, different case).
 */
function toPlainData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function RemoteOfficeShell({ email, signOut }: { email: string; signOut: () => void }) {
  const { db, projectIds } = await hydrateAllRemoteProjects();

  const overview = getOfficeOverview(db);
  const projects = getProjectSummaries(db);
  const activity = getRecentActivity(db, 20);
  const budget = getBudgetView(db);

  const details: Record<string, ProjectDetail> = {};
  for (const id of projectIds) {
    const detail = getProjectDetail(db, id);
    if (detail) details[id] = detail;
  }

  return (
    <RemoteOfficeShellClient
      email={email}
      signOut={signOut}
      overview={toPlainData(overview)}
      projects={toPlainData(projects)}
      details={toPlainData(details)}
      activity={toPlainData(activity)}
      budget={toPlainData(budget)}
    />
  );
}
