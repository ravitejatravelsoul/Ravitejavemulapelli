import { getAppDatabase } from "@/lib/ai-office/db/client";
import {
  getOfficeOverview,
  getProjectSummaries,
  getRecentActivity,
  getPendingApprovalsView,
  getRunnerActivityView,
  getBudgetView,
} from "@/lib/ai-office/dashboard/dashboard-data";
import { CommandBar } from "@/components/ai-office/dashboard/command-bar";
import { OverviewCards } from "@/components/ai-office/dashboard/overview-cards";
import { ProjectList } from "@/components/ai-office/dashboard/project-list";
import { ActivityFeed } from "@/components/ai-office/dashboard/activity-feed";
import { ApprovalsPanel } from "@/components/ai-office/dashboard/approvals-panel";
import { BudgetPanel } from "@/components/ai-office/dashboard/budget-panel";

/**
 * The real owner dashboard — "Teja's private digital engineering
 * headquarters." Every value here comes straight from SQLite via the
 * read-only aggregation layer (`lib/ai-office/dashboard/dashboard-data.ts`);
 * nothing is faked, and an empty office (zero projects) renders
 * intentional empty states rather than looking broken. This is a
 * Server Component — no client-side data fetching, no polling; it's
 * fresh on every navigation/revalidation the mutation actions trigger.
 */
export default async function OfficeHomePage() {
  const db = getAppDatabase();

  const overview = getOfficeOverview(db);
  const projects = getProjectSummaries(db);
  const activity = getRecentActivity(db, 30);
  const approvals = getPendingApprovalsView(db);
  const runnerActivity = getRunnerActivityView(db);
  const budget = getBudgetView(db);

  return (
    <div className="flex flex-col gap-6">
      <CommandBar officeState={overview.officeState} runnerActivity={runnerActivity} />
      <OverviewCards overview={overview} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">Projects</h2>
          <ProjectList projects={projects} />
        </div>
        <div className="flex flex-col gap-6">
          <ApprovalsPanel approvals={approvals} />
          <BudgetPanel budget={budget} />
        </div>
      </div>

      <ActivityFeed entries={activity} />
    </div>
  );
}
