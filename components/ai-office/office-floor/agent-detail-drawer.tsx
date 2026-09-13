"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { WorkstationThumb } from "./workstation-thumb";
import type { AgentDetailView, AgentTaskStepState } from "@/lib/ai-office/dashboard/office-floor-data";

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function StepDot({ state }: { state: AgentTaskStepState }) {
  return (
    <span
      className={cn(
        "flex size-2.5 shrink-0 rounded-full",
        state === "COMPLETE" && "bg-accent-2",
        state === "ACTIVE" && "animate-pulse bg-primary",
        state === "PENDING" && "bg-muted-foreground/30",
      )}
      aria-hidden="true"
    />
  );
}

function FieldGrid({ detail }: { detail: AgentDetailView }) {
  return (
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
        <p className="text-muted-foreground">Model</p>
        <p className="mt-0.5 font-mono font-medium">{detail.model ?? "—"}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Attempts</p>
        <p className="mt-0.5 font-medium">
          {detail.attemptCount} / {detail.maxRetries}
        </p>
      </div>
      {detail.lastCompletedTaskTitle && (
        <div>
          <p className="text-muted-foreground">Last completed</p>
          <p className="mt-0.5 font-medium">{detail.lastCompletedTaskTitle}</p>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ detail }: { detail: AgentDetailView }) {
  if (detail.orchestrator) {
    const o = detail.orchestrator;
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-xs text-muted-foreground">
          The Orchestrator plans the task graph and coordinates every other role — it never executes a step itself, so its real,
          observable state is project-wide.
        </p>
        <div>
          <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Selected roles</p>
          <p className="mt-1 text-xs">{o.selectedRoleIds.length > 0 ? `${o.selectedRoleIds.length} roles planned` : "No plan yet"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Next action</p>
          <p className="mt-1 text-xs">{o.nextAction}</p>
        </div>
        {o.blockedTaskTitles.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-tight text-destructive uppercase">Blocked tasks</p>
            <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
              {o.blockedTaskTitles.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Pending approvals</p>
          <p className="mt-1 text-xs">{o.pendingApprovalCount}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <FieldGrid detail={detail} />
      {detail.latestArtifactPreview && (
        <div>
          <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Latest output</p>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg border border-border/60 bg-muted/40 p-2.5 text-[0.7rem] whitespace-pre-wrap text-foreground">
            {detail.latestArtifactPreview}
          </pre>
        </div>
      )}
    </div>
  );
}

function CurrentTaskTab({ detail }: { detail: AgentDetailView }) {
  if (detail.currentTaskSteps.length === 0) {
    return <p className="text-xs text-muted-foreground">No task currently assigned to this role.</p>;
  }
  return (
    <div className="flex flex-col gap-4 text-sm">
      <ol className="flex flex-col gap-2.5">
        {detail.currentTaskSteps.map((step, i) => (
          <li key={i} className="flex items-center gap-2.5 text-xs">
            <StepDot state={step.state} />
            <span className={cn(step.state === "PENDING" && "text-muted-foreground")}>{step.label}</span>
            <span className="ml-auto font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">{step.state}</span>
          </li>
        ))}
      </ol>
      {detail.latestTestResult && (
        <div>
          <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Test result</p>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge variant={detail.latestTestResult.status === "PASS" ? "default" : "destructive"}>{detail.latestTestResult.status}</Badge>
            {detail.latestTestResult.durationMs !== null && (
              <span className="text-xs text-muted-foreground">real check · {detail.latestTestResult.durationMs}ms</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{detail.latestTestResult.summary}</p>
        </div>
      )}
    </div>
  );
}

function FilesTab({ detail }: { detail: AgentDetailView }) {
  if (detail.filesChanged.length === 0) {
    return <p className="text-xs text-muted-foreground">This role hasn&apos;t materialized any real files yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {detail.filesChanged.map((file) => (
        <li key={file.path} className="flex items-center justify-between gap-2 border-b border-border/40 py-1.5 font-mono text-[0.7rem] last:border-0">
          <span className="truncate">{file.path}</span>
          <span className="shrink-0 text-muted-foreground">{file.sizeBytes}B</span>
        </li>
      ))}
    </ul>
  );
}

function ProgressTab({ detail }: { detail: AgentDetailView }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      {detail.failureHistory.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Retry / failure history</p>
          <ul className="mt-1.5 flex flex-col gap-2 text-xs">
            {detail.failureHistory.map((f, i) => (
              <li key={i} className="border-b border-border/40 pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant={f.operational ? "outline" : "destructive"} className="font-mono text-[0.55rem] uppercase">
                    {f.operational ? "operational" : "semantic"}
                  </Badge>
                  <Badge variant={f.resolved ? "secondary" : "outline"} className="font-mono text-[0.55rem] uppercase">
                    {f.resolved ? "resolved" : "unresolved"}
                  </Badge>
                  <span className="ml-auto font-mono text-[0.6rem] text-muted-foreground">{formatTimestamp(f.occurredAt)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{f.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.decisions.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">Decisions &amp; notes</p>
          <ul className="mt-1.5 flex flex-col gap-2 text-xs">
            {detail.decisions.map((d, i) => (
              <li key={i} className="border-b border-border/40 pb-2 last:border-0">
                <p className="font-medium">{d.summary}</p>
                {d.rationale && <p className="mt-0.5 text-muted-foreground">{d.rationale}</p>}
              </li>
            ))}
          </ul>
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
  );
}

/**
 * The Agent Room — click-an-agent panel (Sections 5/6). All fields come
 * from `getAgentDetail()` — no raw prompts, no internal reasoning,
 * nothing beyond what the ordinary project-detail page already surfaces
 * (artifact content, event descriptions) for this one role. Tabbed so a
 * dense set of real signals stays organized rather than one long scroll;
 * a "Terminal/Execution" tab is deliberately omitted — this codebase has
 * no real command-execution history wired into any live workflow yet, and
 * fabricating one would violate the "real data only" requirement.
 */
export function AgentDetailDrawer({ detail, onOpenChange }: { detail: AgentDetailView | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={detail !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        {detail && (
          <>
            <div className="relative overflow-hidden border-b border-white/10 px-4 pt-5 pb-4" style={{ background: "radial-gradient(ellipse 100% 100% at 30% 0%, #241f36 0%, #100d18 75%)" }}>
              <SheetHeader className="relative p-0">
                <div className="flex items-center gap-3">
                  <WorkstationThumb roleId={detail.roleId} sizePx={80} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SheetTitle className="text-white">{detail.roleName}</SheetTitle>
                      <Badge variant="secondary" className="font-mono text-[0.6rem] uppercase">
                        {detail.status}
                      </Badge>
                    </div>
                    <SheetDescription className="mt-0.5 text-white/60">
                      {detail.projectTitle ? `Working within “${detail.projectTitle}”` : "Not currently assigned to a project"}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
            </div>

            <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col px-4 pb-4">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                {!detail.orchestrator && <TabsTrigger value="task">Current Task</TabsTrigger>}
                {!detail.orchestrator && <TabsTrigger value="files">Files</TabsTrigger>}
                <TabsTrigger value="progress">Progress</TabsTrigger>
              </TabsList>
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                <TabsContent value="overview">
                  <OverviewTab detail={detail} />
                </TabsContent>
                {!detail.orchestrator && (
                  <TabsContent value="task">
                    <CurrentTaskTab detail={detail} />
                  </TabsContent>
                )}
                {!detail.orchestrator && (
                  <TabsContent value="files">
                    <FilesTab detail={detail} />
                  </TabsContent>
                )}
                <TabsContent value="progress">
                  <ProgressTab detail={detail} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
