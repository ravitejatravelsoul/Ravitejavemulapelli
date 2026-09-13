import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Workstation } from "./workstation";
import type { OfficeFloorView, OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * The Orchestrator's own pod — visually the hero of the floor, not another
 * generic zone. A calm radial glow when idle, a brighter "the company is
 * working" glow the moment anything real is in flight, plus a compact,
 * real readout of the project it's currently coordinating.
 */
export function CentralCommandPod({
  agent,
  floor,
  onSelectAgent,
}: {
  agent: OfficeAgentView | undefined;
  floor: OfficeFloorView;
  onSelectAgent: (roleId: string) => void;
}) {
  const project = floor.selectedProject;
  const percent = project && project.progress.total > 0 ? Math.round((project.progress.completed / project.progress.total) * 100) : null;
  const alive = floor.activeAgentCount > 0;

  return (
    <div
      className={cn(
        "relative mx-auto flex w-full max-w-md flex-col items-center gap-3 overflow-hidden rounded-[2rem] border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent p-4 transition-shadow duration-500",
        alive && "shadow-[0_0_56px_-16px_var(--primary)]",
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-8 -top-6 h-24 rounded-full bg-primary/25 blur-3xl transition-opacity duration-700"
        style={{ opacity: alive ? 0.8 : 0.25 }}
        aria-hidden="true"
      />
      <div className="relative flex items-center gap-1.5 font-mono text-[0.62rem] font-semibold tracking-[0.2em] text-primary uppercase">
        <Crown className="size-3.5" aria-hidden="true" />
        Central Command
      </div>

      {agent ? (
        <div className="relative w-full max-w-[18rem]">
          <Workstation agent={agent} onSelect={onSelectAgent} emphasis hasProject={!!project} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Orchestrator unavailable.</p>
      )}

      <div className="relative flex w-full flex-col items-center gap-1 border-t border-border/40 pt-2.5 text-center">
        {project ? (
          <>
            <p className="max-w-full truncate text-xs font-medium text-foreground">{project.title}</p>
            <p className="text-[0.65rem] text-muted-foreground">
              {project.displayStatusLabel}
              {percent !== null && ` · ${percent}% · ${project.progress.completed}/${project.progress.total} tasks`}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No project selected — the company is idle.</p>
        )}
      </div>
    </div>
  );
}
