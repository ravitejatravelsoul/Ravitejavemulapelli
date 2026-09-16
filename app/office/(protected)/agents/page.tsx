import type { Metadata } from "next";
import { getOfficeDb } from "@/lib/ai-office/office-db";
import { getOfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";
import { listAgentRoles } from "@/lib/ai-office/domain/agent-roles";
import { AgentsGrid, type AgentCardData } from "@/components/ai-office/dashboard/agents-grid";
import { GlassCard } from "@/components/common/glass-card";

export const metadata: Metadata = { title: "Agents" };

/**
 * The AI Workforce (Section 27) — real status reflects the office's
 * current most-active project (same default-selection logic the Living
 * Office itself uses); a project switcher isn't needed here since this
 * page's job is "who is on the team and what are they generally doing,"
 * not per-project drill-down (that's the project detail page's job).
 */
export default async function AgentsPage() {
  const db = await getOfficeDb();
  const roles = listAgentRoles(db);
  const floor = getOfficeFloorView(db);

  const cards: AgentCardData[] = roles.map((role) => {
    const agent = floor.agents.find((a) => a.roleId === role.id)!;
    const responsibilities = JSON.parse(role.responsibilities) as string[];
    return { agent, description: responsibilities[0] ?? "" };
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">AI Workforce</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {floor.selectedProject ? `Showing real status within "${floor.selectedProject.title}."` : "No active project — every role is idle."}
        </p>
      </div>

      {!floor.selectedProject && (
        <GlassCard className="text-sm text-muted-foreground">Start a project from the Office to see the team at work.</GlassCard>
      )}

      <AgentsGrid cards={cards} />
    </div>
  );
}
