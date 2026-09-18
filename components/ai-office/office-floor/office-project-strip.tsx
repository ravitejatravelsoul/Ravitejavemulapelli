"use client";
import { isActiveVisualState } from "@/lib/ai-office/dashboard/office-visual-state";

import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { OfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * The current-project readout, integrated directly into the office canvas
 * rather than as a separate huge card — title, progress, current work, and
 * (when more than one project exists) a plain `<select>` that switches
 * which project's real state the floor visualizes, via a `?project=`
 * query param (no client data-fetching layer needed — the page itself is
 * a Server Component that re-renders with the new selection).
 */
export function OfficeProjectStrip({ floor }: { floor: OfficeFloorView }) {
  const router = useRouter();
  const pathname = usePathname();

  if (!floor.selectedProject) {
    return (
      <div className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <p className="text-sm text-muted-foreground">Office ready — start with an idea.</p>
      </div>
    );
  }

  const { title, progress, provider, displayStatusLabel, isStalledWithNoDeliverable } = floor.selectedProject;
  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const workingAgent = floor.agents.find((a) => isActiveVisualState(a.status));
  const waitingCount = floor.agents.filter((a) => a.status === "WAITING").length;
  const activityLine = workingAgent
    ? `${workingAgent.roleName}${workingAgent.currentTaskTitle ? ` — ${workingAgent.currentTaskTitle}` : " is on it"}`
    : waitingCount > 0
      ? "Waiting on the runner"
      : "Nothing currently running";

  return (
    <div className="glass flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-3.5 py-2">
      <p className="truncate text-sm font-semibold tracking-tight">{title}</p>
      <span className={cn("font-mono text-[0.6rem] tracking-widest uppercase", isStalledWithNoDeliverable ? "text-destructive" : "text-muted-foreground")}>
        {displayStatusLabel}
      </span>
      <span className="hidden rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase sm:inline">
        {provider}
      </span>

      <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
        <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <span className="shrink-0 text-[0.65rem] text-muted-foreground">
          {progress.completed}/{progress.total}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">· {activityLine}</span>
      </div>

      {floor.projects.length > 1 && (
        <select
          aria-label="Select project to visualize"
          className="w-full shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs sm:w-auto"
          value={floor.selectedProject.id}
          onChange={(e) => {
            const params = new URLSearchParams();
            params.set("project", e.target.value);
            router.push(`${pathname}?${params.toString()}`);
          }}
        >
          {floor.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
