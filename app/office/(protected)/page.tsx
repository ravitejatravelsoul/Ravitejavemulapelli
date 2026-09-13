import Link from "next/link";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import {
  getOfficeOverview,
  getProjectSummaries,
  getRecentActivity,
  getPendingApprovalsView,
  getRunnerActivityView,
  getBudgetView,
} from "@/lib/ai-office/dashboard/dashboard-data";
import { getOfficeFloorView, getAgentDetail } from "@/lib/ai-office/dashboard/office-floor-data";
import { getProjectDetail } from "@/lib/ai-office/dashboard/project-detail-data";
import { listAgentRoles } from "@/lib/ai-office/domain/agent-roles";
import { OfficeTopBar } from "@/components/ai-office/office-floor/office-top-bar";
import { OfficeFloor } from "@/components/ai-office/office-floor/office-floor";
import { AgentsList } from "@/components/ai-office/office-floor/agents-list";
import { SideCommandPanel } from "@/components/ai-office/office-floor/side-command-panel";
import { OverviewCards } from "@/components/ai-office/dashboard/overview-cards";
import { ProjectList } from "@/components/ai-office/dashboard/project-list";
import { ActivityFeed } from "@/components/ai-office/dashboard/activity-feed";
import { ApprovalsPanel } from "@/components/ai-office/dashboard/approvals-panel";
import { BudgetPanel } from "@/components/ai-office/dashboard/budget-panel";
import { TaskFlow } from "@/components/ai-office/dashboard/task-flow";
import { GlassCard } from "@/components/common/glass-card";
import { AutoRefresh } from "@/components/ai-office/auto-refresh";

/**
 * "Teja's AI Engineering Headquarters" — the living office floor is the
 * primary view; every widget the old admin-style dashboard had
 * (overview stats, project list, activity, approvals, budget, task flow)
 * still exists unchanged, just relocated into the collapsible side panel
 * instead of stacked on the main canvas. Every visual state on the floor
 * comes straight from `getOfficeFloorView()` — a read-only projection of
 * the same SQLite data the rest of this dashboard already reads.
 */
export default async function OfficeHomePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project: selectedProjectId } = await searchParams;
  const db = getAppDatabase();

  const overview = getOfficeOverview(db);
  const runnerActivity = getRunnerActivityView(db);
  const budget = getBudgetView(db);
  const floor = getOfficeFloorView(db, selectedProjectId);

  const roles = listAgentRoles(db);
  const agentDetails = Object.fromEntries(roles.map((role) => [role.id, getAgentDetail(db, role.id, floor.selectedProject?.id)!]));

  const projects = getProjectSummaries(db);
  const activity = getRecentActivity(db, 30);
  const approvals = getPendingApprovalsView(db);
  const projectTasks = floor.selectedProject ? getProjectDetail(db, floor.selectedProject.id)?.tasks ?? [] : [];

  const sections = {
    projects: (
      <div className="flex flex-col gap-4">
        <OverviewCards overview={overview} />
        <ProjectList projects={projects} />
      </div>
    ),
    agents: <AgentsList floor={floor} />,
    tasks: floor.selectedProject ? (
      <TaskFlow tasks={projectTasks} />
    ) : (
      <p className="text-sm text-muted-foreground">No project selected yet.</p>
    ),
    activity: <ActivityFeed entries={activity} />,
    approvals: <ApprovalsPanel approvals={approvals} />,
    budget: <BudgetPanel budget={budget} />,
    settings: (
      <GlassCard className="p-4 text-sm text-muted-foreground">
        <p>
          Office-wide settings (AI provider selection, budget cap) live here. Nothing configurable yet beyond what Open/Close and the
          budget panel already control.
        </p>
        <Link href="/office/local-models" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          Local Models — benchmark and route installed Ollama models →
        </Link>
      </GlassCard>
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      {overview.activeProjects > 0 && <AutoRefresh />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <OfficeTopBar officeState={overview.officeState} runnerActivity={runnerActivity} floor={floor} liveCostUsd={budget.liveSpendUsd} liveCapUsd={budget.capUsd} />
        </div>
        <SideCommandPanel sections={sections} />
      </div>

      <div className="hidden lg:block">
        <OfficeFloor floor={floor} agentDetails={agentDetails} officeState={overview.officeState} />
      </div>
      <div className="lg:hidden">
        <AgentsList floor={floor} />
      </div>
    </div>
  );
}
