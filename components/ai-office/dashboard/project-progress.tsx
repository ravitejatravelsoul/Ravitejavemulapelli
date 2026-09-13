import { Badge } from "@/components/ui/badge";
import type { OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  IDLE: "outline",
  WORKING: "default",
  THINKING: "default",
  REVIEWING: "default",
  WAITING: "outline",
  BLOCKED: "destructive",
  DONE: "secondary",
  PAUSED: "secondary",
};

/**
 * Section 12 — real per-role stage indicators, never a fabricated
 * percentage. A role reading IDLE with no task ever assigned means the
 * Orchestrator didn't select it for this project — shown as such, not
 * hidden or mislabeled as "waiting."
 */
export function ProjectProgress({ agents }: { agents: OfficeAgentView[] }) {
  const involved = agents.filter((a) => a.status !== "IDLE" || a.currentTaskTitle || a.lastCompletedTaskTitle);
  const notSelected = agents.filter((a) => a.status === "IDLE" && !a.currentTaskTitle && !a.lastCompletedTaskTitle);

  if (involved.length === 0) {
    return <p className="text-sm text-muted-foreground">No roles have been assigned work on this project yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1.5">
        {involved.map((agent) => (
          <li key={agent.roleId} className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 text-xs">
            <span className="min-w-[9rem] shrink-0 font-medium">{agent.roleName}</span>
            <Badge variant={STATUS_VARIANT[agent.status] ?? "outline"} className="font-mono text-[0.6rem] uppercase">
              {agent.status}
            </Badge>
            <span className="truncate text-muted-foreground">{agent.currentTaskTitle ?? agent.lastCompletedTaskTitle ?? "—"}</span>
            {agent.provider && (
              <span className="ml-auto shrink-0 font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">{agent.provider}</span>
            )}
          </li>
        ))}
      </ul>
      {notSelected.length > 0 && (
        <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
          Not selected for this project: {notSelected.map((a) => a.roleName).join(", ")}.
        </p>
      )}
    </div>
  );
}
