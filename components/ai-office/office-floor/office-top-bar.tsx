import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ai-office/action-button";
import { openOfficeAction, closeOfficeAction } from "@/app/office/actions/office";
import type { OfficeState } from "@/lib/ai-office/domain/office";
import type { RunnerActivityView } from "@/lib/ai-office/dashboard/dashboard-data";
import type { OfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * Compact top bar for the office-floor page — everything the old
 * CommandBar showed, in one dense row rather than a full-width card, so
 * the office floor below gets the majority of the viewport.
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
  const providerLabel = floor.selectedProject?.provider ?? "simulated";

  return (
    <div className="glass flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-2.5 text-xs">
      <p className="text-sm font-semibold tracking-tight whitespace-nowrap">Teja&apos;s AI Office</p>
      <Badge variant={isOpen ? "default" : "outline"}>{isOpen ? "OPEN" : "CLOSED"}</Badge>
      <span className="hidden text-muted-foreground sm:inline" title={runnerActivity.message}>
        {runnerActivity.hasRecentActivity ? "Runner active" : "Runner idle"}
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[0.65rem] tracking-widest uppercase">Mode: {providerLabel}</span>
      {floor.selectedProject && <span className="hidden truncate font-medium text-foreground sm:inline">{floor.selectedProject.title}</span>}
      <span className="font-mono text-[0.65rem] text-muted-foreground">
        LIVE ${liveCostUsd.toFixed(2)} / ${liveCapUsd.toFixed(2)}
      </span>

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
  );
}
