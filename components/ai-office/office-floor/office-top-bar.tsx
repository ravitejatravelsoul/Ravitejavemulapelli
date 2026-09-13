import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ai-office/action-button";
import { openOfficeAction, closeOfficeAction } from "@/app/office/actions/office";
import type { OfficeState } from "@/lib/ai-office/domain/office";
import type { RunnerActivityView } from "@/lib/ai-office/dashboard/dashboard-data";
import type { OfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * The compact operational bar for the office-floor page (Section 2) —
 * three genuinely distinct concepts, kept visually and textually separate
 * (Section 30's "OFFICE OPEN / PROJECT RUNNING / RUNNER ACTIVE" — these
 * were previously easy to conflate):
 *  - Office state: whether new model calls are allowed at all.
 *  - Project status: this one project's own lifecycle state.
 *  - Runner liveness: whether the standalone poller process is actually
 *    alive and reachable right now, independent of both of the above —
 *    a project can have real pending work while the runner itself is
 *    offline, which is exactly the confusing case this bar must make
 *    obvious rather than hide.
 */
export function OfficeTopBar({
  officeState,
  runnerActivity,
  floor,
  liveCostUsd,
  liveCapUsd,
}: {
  officeState: OfficeState;
  runnerActivity: RunnerActivityView;
  floor: OfficeFloorView;
  liveCostUsd: number;
  liveCapUsd: number;
}) {
  const isOpen = officeState === "OPEN";
  const project = floor.selectedProject;
  const percent = project && project.progress.total > 0 ? Math.round((project.progress.completed / project.progress.total) * 100) : null;

  const runnerLabel =
    runnerActivity.runnerStatus === "ONLINE_WORKING" ? "Working" : runnerActivity.runnerStatus === "ONLINE_IDLE" ? "Idle" : "Offline";

  return (
    <div className={cn("glass flex flex-col gap-2.5 rounded-2xl px-4 py-3 text-xs transition-opacity", !isOpen && "opacity-80")}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <StatusField label="Office" value={isOpen ? "OPEN" : "CLOSED"} tone={isOpen ? "default" : "outline"} />
        <StatusField
          label="Project"
          value={project ? project.displayStatusLabel : "None selected"}
          tone={project?.isStalledWithNoDeliverable ? "destructive" : "secondary"}
        />
        <StatusField
          label="Runner"
          value={runnerLabel}
          tone={runnerActivity.runnerStatus === "OFFLINE" ? "destructive" : runnerActivity.runnerStatus === "ONLINE_WORKING" ? "default" : "outline"}
          title={runnerActivity.message}
        />
        {project && <StatusField label="Policy" value={project.aiPolicyMode.replace("_", " ")} tone="outline" />}
        {project && <StatusField label="Active agents" value={`${floor.activeAgentCount}/11`} tone="outline" />}
        {percent !== null && <StatusField label="Progress" value={`${percent}%`} tone="outline" />}
        <StatusField label="LIVE spend" value={`$${liveCostUsd.toFixed(2)} / $${liveCapUsd.toFixed(2)}`} tone="outline" />

        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm">
            <Link href="/office/projects/new">
              <Plus className="size-3.5" />
              New Project
            </Link>
          </Button>
          {isOpen ? (
            <ActionButton action={closeOfficeAction} variant="outline" size="sm">
              Close Office
            </ActionButton>
          ) : (
            <ActionButton action={openOfficeAction} variant="outline" size="sm">
              Open Office
            </ActionButton>
          )}
        </div>
      </div>

      {project && <p className="truncate text-[0.7rem] text-muted-foreground">{project.title}</p>}

      {!isOpen && (
        <p className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-[0.7rem] text-muted-foreground">
          OFFICE CLOSED — all work preserved, no new agent or model execution will start until reopened.
        </p>
      )}
      {isOpen && runnerActivity.runnerStatus === "OFFLINE" && project && project.progress.completed < project.progress.total && (
        <p className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-[0.7rem] text-muted-foreground">
          This project has pending work, but no runner is currently processing it.
        </p>
      )}
    </div>
  );
}

function StatusField({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone: "default" | "secondary" | "outline" | "destructive";
  title?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <span className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">{label}</span>
      <Badge variant={tone} className="font-mono text-[0.65rem] uppercase">
        {value}
      </Badge>
    </div>
  );
}
