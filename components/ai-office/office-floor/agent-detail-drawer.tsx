"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import type { AgentDetailView } from "@/lib/ai-office/dashboard/office-floor-data";

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Click-an-agent panel. All fields come from `getAgentDetail()` — no raw
 * prompts, no internal reasoning, nothing beyond what the ordinary
 * project-detail page already surfaces (artifact content, event
 * descriptions) for this one role.
 */
export function AgentDetailDrawer({ detail, onOpenChange }: { detail: AgentDetailView | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={detail !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {detail && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle>{detail.roleName}</SheetTitle>
                <Badge variant="secondary" className="font-mono text-[0.6rem] uppercase">
                  {detail.status}
                </Badge>
              </div>
              <SheetDescription>{detail.projectTitle ? `Working within “${detail.projectTitle}”` : "Not currently assigned to a project"}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Current task</p>
                  <p className="mt-0.5 font-medium">{detail.currentTaskTitle ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Task status</p>
                  <p className="mt-0.5 font-medium">{detail.taskStatus?.replace(/_/g, " ") ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Provider</p>
                  <p className="mt-0.5 font-mono font-medium uppercase">{detail.provider ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Attempts</p>
                  <p className="mt-0.5 font-medium">
                    {detail.attemptCount} / {detail.maxRetries}
                  </p>
                </div>
                {detail.lastCompletedTaskTitle && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Last completed</p>
                    <p className="mt-0.5 font-medium">{detail.lastCompletedTaskTitle}</p>
                  </div>
                )}
              </div>

              {detail.latestArtifactPreview && (
                <div>
                  <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Latest output</p>
                  <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg border border-border/60 bg-muted/40 p-2.5 text-[0.7rem] whitespace-pre-wrap text-foreground">
                    {detail.latestArtifactPreview}
                  </pre>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Recent activity</p>
                {detail.recentActivity.length === 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">Nothing recorded for this role yet.</p>
                ) : (
                  <ul className="mt-1.5 flex flex-col gap-2 text-xs">
                    {detail.recentActivity.map((entry) => (
                      <li key={entry.id} className="border-b border-border/40 pb-2 last:border-0">
                        <span className="mr-2 font-mono text-[0.65rem] text-muted-foreground">{formatTimestamp(entry.occurredAt)}</span>
                        {entry.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
