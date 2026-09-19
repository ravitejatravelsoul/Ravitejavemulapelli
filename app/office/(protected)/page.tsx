import { OfficeCommandTable } from "@/components/ai-office/office-floor/office-cinematic";
import { getOfficeInteractionView } from "@/lib/ai-office/dashboard/office-interaction-data";
import { OfficeDestinations, OfficeTransitionFeed } from "@/components/ai-office/office-floor/office-interactions";
import Link from "next/link";
import { getOfficeDb } from "@/lib/ai-office/office-db";
import { readOfficeWorkspaceFile } from "@/lib/ai-office/office-workspace-read";
import {
  getOfficeOverview,
  getProjectSummaries,
  getRecentActivity,
  getPendingApprovalsView,
  getRunnerActivityView,
  getBudgetView,
} from "@/lib/ai-office/dashboard/dashboard-data";
import { getOfficeFloorView, getAgentDetail } from "@/lib/ai-office/dashboard/office-floor-data";
import { getProjectDetail, getRecentHandoff } from "@/lib/ai-office/dashboard/project-detail-data";
import { getRolePerformance, deriveNextSteps } from "@/lib/ai-office/dashboard/agent-workspace-data";
import { getRoleSpecialization } from "@/lib/ai-office/agents/role-specializations";
import { listAgentRoles } from "@/lib/ai-office/domain/agent-roles";
import { highlightFileContent } from "@/lib/ai-office/workspace/code-highlight";
import { OfficeTopBar } from "@/components/ai-office/office-floor/office-top-bar";
import { computeOfficeHealthStatus } from "@/lib/ai-office/engineer/office-engineer";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";
import { OfficeFloor } from "@/components/ai-office/office-floor/office-floor";
import { OfficeProjectStrip } from "@/components/ai-office/office-floor/office-project-strip";
import { AgentsList } from "@/components/ai-office/office-floor/agents-list";
import { AgentWorkspace } from "@/components/ai-office/office-floor/agent-workspace";
import { SideCommandPanel } from "@/components/ai-office/office-floor/side-command-panel";
import { OverviewCards } from "@/components/ai-office/dashboard/overview-cards";
import { ProjectList } from "@/components/ai-office/dashboard/project-list";
import { ActivityFeed } from "@/components/ai-office/dashboard/activity-feed";
import { ApprovalsPanel } from "@/components/ai-office/dashboard/approvals-panel";
import { BudgetPanel } from "@/components/ai-office/dashboard/budget-panel";
import { TaskFlow } from "@/components/ai-office/dashboard/task-flow";
import { GlassCard } from "@/components/common/glass-card";
import { AutoRefresh } from "@/components/ai-office/auto-refresh";
import type { WorkspaceFileEntry } from "@/components/ai-office/workspace/file-browser";

/**
 * "Teja's AI Engineering Headquarters" — the living office floor is the
 * primary view; every widget the old admin-style dashboard had
 * (overview stats, project list, activity, approvals, budget, task flow)
 * still exists unchanged, just relocated into the collapsible side panel
 * instead of stacked on the main canvas. Every visual state on the floor
 * comes straight from `getOfficeFloorView()` — a read-only projection of
 * the same SQLite data the rest of this dashboard already reads.
 *
 * `?agent=<roleId>` (Section 24 of the Agent Workspace phase) drives the
 * expanded Agent Workspace mounted once below — a direct link or a
 * refresh both preserve the open workspace, and browser back/forward
 * closes/reopens it naturally.
 */
export default async function OfficeHomePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; officeDebug?: string; agent?: string }>;
}) {
  const { project: selectedProjectId, officeDebug, agent: selectedRoleId } = await searchParams;
  const db = await getOfficeDb();

  const overview = getOfficeOverview(db);
  const runnerActivity = getRunnerActivityView(db);
  const budget = getBudgetView(db);
  const floor = getOfficeFloorView(db, selectedProjectId);
  floor.interaction = getOfficeInteractionView(db, floor);

  const roles = listAgentRoles(db);

  const projects = getProjectSummaries(db);
  const activity = getRecentActivity(db, 30);
  const approvals = getPendingApprovalsView(db);
  const projectDetail = floor.selectedProject ? getProjectDetail(db, floor.selectedProject.id) : null;
  const projectTasks = projectDetail?.tasks ?? [];

  const recentHandoff = projectDetail ? getRecentHandoff(floor.agents, projectDetail.collaboration) : null;

  const debugEnabled = process.env.NODE_ENV !== "production" && officeDebug === "1";

  // The expanded Agent Workspace's real data — computed only for the one
  // selected role (not eagerly for all 11) since it's real DB/filesystem
  // work (file reads + syntax highlighting), not just a projection.
  const selectedRole = selectedRoleId ? roles.find((r) => r.id === selectedRoleId) : undefined;
  const agentDetail = selectedRole ? getAgentDetail(db, selectedRole.id, floor.selectedProject?.id) : undefined;
  let fileEntries: WorkspaceFileEntry[] = [];
  if (agentDetail && floor.selectedProject) {
    fileEntries = await Promise.all(
      agentDetail.filesChanged.map(async (file) => {
        const content = await readOfficeWorkspaceFile(floor.selectedProject!.id, file.path);
        return {
          path: file.path,
          sizeBytes: file.sizeBytes,
          lastModifiedByRoleId: file.lastModifiedByRoleId,
          html: await highlightFileContent(file.path, content ?? ""),
        };
      }),
    );
  }

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
      <AutoRefresh intervalMs={overview.activeProjects > 0 || floor.agents.some(a => a.status === "DONE") ? 5000 : 30000} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <OfficeTopBar
            officeState={overview.officeState}
            runnerActivity={runnerActivity}
            floor={floor}
            liveCostUsd={budget.liveSpendUsd}
            liveCapUsd={budget.capUsd}
            engineerStatus={computeOfficeHealthStatus(db)}
            remoteMode={isRemoteExecutionMode()}
          />
        </div>
        <SideCommandPanel sections={sections} pendingApprovalCount={approvals.length} />
      </div>

      <div className="hidden lg:block">
        <OfficeFloor floor={floor} officeState={overview.officeState} recentHandoff={recentHandoff} debugEnabled={debugEnabled} />
      </div>
      <div className="lg:hidden">
        <OfficeProjectStrip floor={floor} />
        <div className="mt-3">
          <AgentsList floor={floor} />
        </div>
      </div>

      {floor.interaction && <>
        <OfficeDestinations view={floor.interaction} />
        <OfficeCommandTable view={floor.interaction} />
        <OfficeTransitionFeed view={floor.interaction} />
        <section id="owner-decisions"><ApprovalsPanel approvals={approvals.filter(a => !a.projectId || a.projectId === floor.selectedProject?.id)} /></section>
      </>}

      {agentDetail && (
        <AgentWorkspace
          detail={agentDetail}
          performance={getRolePerformance(db, agentDetail.roleId)}
          nextSteps={deriveNextSteps(agentDetail)}
          specialization={getRoleSpecialization(agentDetail.roleId)}
          fileEntries={fileEntries}
        />
      )}
    </div>
  );
}
