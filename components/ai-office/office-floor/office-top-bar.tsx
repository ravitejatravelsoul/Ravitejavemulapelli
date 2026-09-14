import Link from "next/link";
import { Plus, Power, Activity, Users, TrendingUp, DollarSign, Sliders, Wrench } from "lucide-react";
import type { OfficeHealthStatus } from "@/lib/ai-office/engineer/office-engineer";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ai-office/action-button";
import { openOfficeAction, closeOfficeAction } from "@/app/office/actions/office";
import type { OfficeState } from "@/lib/ai-office/domain/office";
import type { RunnerActivityView } from "@/lib/ai-office/dashboard/dashboard-data";
import type { OfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * The compact operational bar (Section 15) — scannable icon+value chips
 * instead of "LABEL: BADGE" pairs, so it stays out of the way of the
 * Living Office below it while still keeping three genuinely distinct
 * concepts separate (Section 30's "OFFICE OPEN / PROJECT RUNNING / RUNNER
 * ACTIVE"): Office state (are new model calls allowed at all), Project
 * status (this one project's lifecycle), and Runner liveness (is the
 * standalone poller actually alive right now, independent of both).
 */
export function OfficeTopBar({
  officeState,
  runnerActivity,
  floor,
  liveCostUsd,
  liveCapUsd,
  engineerStatus,
}: {
  officeState: OfficeState;
  runnerActivity: RunnerActivityView;
  floor: OfficeFloorView;
  liveCostUsd: number;
  liveCapUsd: number;
  engineerStatus: OfficeHealthStatus;
}) {
  const isOpen = officeState === "OPEN";
  const project = floor.selectedProject;
  const percent = project && project.progress.total > 0 ? Math.round((project.progress.completed / project.progress.total) * 100) : null;

  const runnerLabel =
    runnerActivity.runnerStatus === "ONLINE_WORKING" ? "Working" : runnerActivity.runnerStatus === "ONLINE_IDLE" ? "Idle" : "Offline";
  const runnerTone: ChipTone = runnerActivity.runnerStatus === "OFFLINE" ? "bad" : runnerActivity.runnerStatus === "ONLINE_WORKING" ? "good" : "neutral";

  return (
    <div className={cn("glass flex flex-col gap-2 rounded-xl px-3.5 py-2.5 text-xs transition-opacity", !isOpen && "opacity-80")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Chip icon={Power} label={isOpen ? "Office open" : "Office closed"} tone={isOpen ? "good" : "bad"} />
        <Chip
          icon={Activity}
          label={project ? project.displayStatusLabel : "No project"}
          tone={project?.isStalledWithNoDeliverable ? "bad" : "neutral"}
        />
        <Chip icon={Activity} label={`Runner ${runnerLabel}`} tone={runnerTone} title={runnerActivity.message} />
        {project && <Chip icon={Sliders} label={project.aiPolicyMode.replace("_", " ")} tone="neutral" />}
        {project && <Chip icon={Users} label={`${floor.activeAgentCount}/11 active`} tone="neutral" />}
        {percent !== null && <Chip icon={TrendingUp} label={`${percent}%`} tone="neutral" />}
        <Chip icon={DollarSign} label={`${liveCostUsd.toFixed(2)} / ${liveCapUsd.toFixed(2)}`} tone="neutral" />
        <Chip
          icon={Wrench}
          label={`Engineer ${engineerStatus === "HEALTHY" ? "Healthy" : engineerStatus.charAt(0) + engineerStatus.slice(1).toLowerCase()}`}
          tone={engineerStatus === "HEALTHY" ? "good" : engineerStatus === "ESCALATED" ? "bad" : "neutral"}
          href="/office/engineer"
          title="Office Engineer — self-healing maintenance agent. Click to view incident history."
        />

        <div className="flex w-full items-center gap-2 sm:w-auto sm:ml-auto">
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

type ChipTone = "good" | "bad" | "neutral";

const TONE_CLASS: Record<ChipTone, string> = {
  good: "text-primary",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

function Chip({ icon: Icon, label, tone, title, href }: { icon: typeof Power; label: string; tone: ChipTone; title?: string; href?: string }) {
  const content = (
    <span className={cn("flex min-w-0 items-center gap-1.5 font-medium", TONE_CLASS[tone], href && "transition-opacity hover:opacity-75")} title={title}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
