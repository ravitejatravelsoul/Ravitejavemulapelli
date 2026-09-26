"use client";
import { VISUAL_LABEL } from "@/lib/ai-office/dashboard/office-visual-state";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileBrowser, type WorkspaceFileEntry } from "@/components/ai-office/workspace/file-browser";
import { getRoleVisual } from "./role-visuals";
import { getWorkstationCropRect } from "@/lib/ai-office/office-hotspots";
import { ProviderBadge } from "@/components/ai-office/provider-badge";
import { useAgentSelection } from "./use-agent-selection";
import type { AgentDetailView, AgentTaskStepState } from "@/lib/ai-office/dashboard/office-floor-data";
import type { RolePerformanceSummary } from "@/lib/ai-office/dashboard/agent-workspace-data";
import type { RoleSpecialization } from "@/lib/ai-office/agents/role-specializations";

const STATUS_LABEL = VISUAL_LABEL;

const TAB_TRIGGER_CLASS = "text-white/60 data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-none";

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/10 bg-white/[0.03] p-4", className)}>
      {title && <p className="mb-3 font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-white/50 uppercase">{title}</p>}
      {children}
    </div>
  );
}

function StepDot({ state }: { state: AgentTaskStepState }) {
  return (
    <span
      className={cn(
        "flex size-2.5 shrink-0 rounded-full",
        state === "COMPLETE" && "bg-[oklch(0.7_0.17_150)]",
        state === "ACTIVE" && "animate-pulse bg-primary",
        state === "PENDING" && "bg-white/20",
      )}
      aria-hidden="true"
    />
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-lg font-semibold text-white">{value}</span>
      <span className="text-[0.65rem] text-white/50">{label}</span>
    </div>
  );
}

function OrchestratorOverviewTab({ detail }: { detail: AgentDetailView }) {
  const o = detail.orchestrator!;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Project Overview">
        <p className="text-sm text-white/80">{detail.projectTitle ?? "No project selected."}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <Stat label="Roles selected" value={o.selectedRoleIds.length} />
          <Stat label="Pending approvals" value={o.pendingApprovalCount} />
          <Stat label="Blocked tasks" value={o.blockedTaskTitles.length} />
        </div>
      </Card>

      <Card title="Next Eligible Action">
        <p className="text-sm text-white/80">{o.nextAction}</p>
      </Card>

      {o.blockedTaskTitles.length > 0 && (
        <Card title="Blocked" className="lg:col-span-2">
          <ul className="list-inside list-disc text-sm text-white/70">
            {o.blockedTaskTitles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Recent Activity" className="lg:col-span-2">
        {detail.recentActivity.length === 0 ? (
          <p className="text-sm text-white/50">Nothing recorded for this role yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.recentActivity.slice(0, 5).map((entry) => (
              <li key={entry.id} className="flex gap-3 border-b border-white/5 pb-2 text-white/75 last:border-0">
                <span className="shrink-0 font-mono text-[0.65rem] text-white/40">{formatTimestamp(entry.occurredAt)}</span>
                {entry.message}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function OverviewTab({
  detail,
  performance,
  nextSteps,
  fileEntries,
}: {
  detail: AgentDetailView;
  performance: RolePerformanceSummary;
  nextSteps: string[];
  fileEntries: WorkspaceFileEntry[];
}) {
  if (detail.orchestrator) return <OrchestratorOverviewTab detail={detail} />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Task Pipeline">
        {detail.currentTaskSteps.length === 0 ? (
          <p className="text-sm text-white/50">No task currently assigned to this role.</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {detail.currentTaskSteps.map((step, i) => (
              <li key={i} className="flex items-center gap-2.5 text-sm">
                <StepDot state={step.state} />
                <span className={cn(step.state === "PENDING" ? "text-white/40" : "text-white/90")}>{step.label}</span>
                <span className="ml-auto font-mono text-[0.6rem] tracking-widest text-white/40 uppercase">{step.state}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Performance">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Tasks completed" value={performance.tasksCompleted} />
          <Stat label="Success rate" value={performance.successRate !== null ? `${Math.round(performance.successRate * 100)}%` : "—"} />
          <Stat label="Attempts" value={performance.totalAttempts} />
          <Stat label="Files touched" value={performance.filesTouched} />
          <Stat label="Tests pass/fail" value={`${performance.testsPassed}/${performance.testsFailed}`} />
          <Stat label="Active time" value={performance.totalActiveExecutionMs !== null ? formatDuration(performance.totalActiveExecutionMs) : "—"} />
        </div>
        {performance.claudeCostUsd > 0 && (
          <p className="mt-3 border-t border-white/10 pt-3 text-xs text-white/60">
            Paid AI: ${performance.claudeCostUsd.toFixed(3)} · {performance.claudeInputTokens + performance.claudeOutputTokens} tokens
          </p>
        )}
      </Card>

      <Card title="Workspace">
        {fileEntries.length === 0 ? (
          <p className="text-sm text-white/50">This role hasn&apos;t materialized any real files yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {fileEntries.slice(0, 5).map((f) => (
              <li key={f.path} className="truncate font-mono text-xs text-white/70">
                {f.path}
              </li>
            ))}
            {fileEntries.length > 5 && <li className="text-xs text-white/40">+{fileEntries.length - 5} more</li>}
          </ul>
        )}
      </Card>

      <Card title="Next Steps">
        <ul className="flex flex-col gap-2 text-sm text-white/80">
          {nextSteps.map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              {step}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Recent Activity" className="lg:col-span-2">
        {detail.recentActivity.length === 0 ? (
          <p className="text-sm text-white/50">Nothing recorded for this role yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.recentActivity.slice(0, 5).map((entry) => (
              <li key={entry.id} className="flex gap-3 border-b border-white/5 pb-2 text-white/75 last:border-0">
                <span className="shrink-0 font-mono text-[0.65rem] text-white/40">{formatTimestamp(entry.occurredAt)}</span>
                {entry.message}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function CurrentTaskTab({ detail }: { detail: AgentDetailView }) {
  if (!detail.currentTaskTitle && detail.taskStatus === null) {
    return <p className="text-sm text-white/50">No task currently assigned to this role.</p>;
  }
  const unresolved = detail.failureHistory.filter((f) => !f.resolved);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="text-lg font-semibold text-white">{detail.currentTaskTitle ?? detail.lastCompletedTaskTitle ?? "—"}</p>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-white/40">Status</p>
            <p className="mt-0.5 font-medium text-white">{detail.taskStatus?.replace(/_/g, " ") ?? "—"}</p>
          </div>
          <div>
            <p className="text-white/40">Attempt</p>
            <p className="mt-0.5 font-medium text-white">
              {detail.attemptCount} / {detail.maxRetries}
            </p>
          </div>
          <div>
            <p className="text-white/40">Provider</p>
            {detail.provider ? (
              <ProviderBadge provider={detail.provider} model={detail.model} className="mt-0.5 border-white/20" />
            ) : (
              <p className="mt-0.5 font-mono font-medium text-white">—</p>
            )}
          </div>
        </div>
      </Card>

      {detail.latestTestResult && (
        <Card title="Latest Verification">
          <div className="flex items-center gap-2">
            <Badge variant={detail.latestTestResult.status === "PASS" ? "default" : "destructive"}>{detail.latestTestResult.status}</Badge>
            {detail.latestTestResult.durationMs !== null && <span className="text-xs text-white/50">real check · {detail.latestTestResult.durationMs}ms</span>}
          </div>
          <p className="mt-1.5 text-sm text-white/70">{detail.latestTestResult.summary}</p>
        </Card>
      )}

      {unresolved.length > 0 && (
        <Card title="Unresolved">
          <ul className="flex flex-col gap-2 text-sm text-white/80">
            {unresolved.map((f, i) => (
              <li key={i}>
                <Badge variant={f.operational ? "outline" : "destructive"} className="mr-2 font-mono text-[0.55rem] uppercase">
                  {f.operational ? "operational" : "semantic"}
                </Badge>
                {f.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {detail.latestArtifactPreview && (
        <Card title="Latest Output">
          <pre className="max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-xs whitespace-pre-wrap text-white/80">{detail.latestArtifactPreview}</pre>
        </Card>
      )}
    </div>
  );
}

function TasksProgressTab({ detail }: { detail: AgentDetailView }) {
  if (!detail.currentTaskTitle && detail.failureHistory.length === 0 && !detail.lastCompletedTaskTitle) {
    return <p className="text-sm text-white/50">No task has been assigned to this role in this project yet.</p>;
  }
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-white">{detail.currentTaskTitle ?? detail.lastCompletedTaskTitle}</p>
        <Badge variant="secondary" className="font-mono text-[0.6rem] uppercase">
          {detail.taskStatus?.replace(/_/g, " ") ?? "DONE"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-white/50">
        Attempt {detail.attemptCount} of {detail.maxRetries}
      </p>
      {detail.failureHistory.length > 0 && (
        <ol className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4">
          {detail.failureHistory.map((f, i) => (
            <li key={i} className="flex flex-col gap-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-white/40">Attempt {i + 1}</span>
                <Badge variant={f.resolved ? "secondary" : "destructive"} className="font-mono text-[0.55rem] uppercase">
                  {f.resolved ? "resolved" : "unresolved"}
                </Badge>
                <span className="ml-auto font-mono text-[0.6rem] text-white/40">{formatTimestamp(f.occurredAt)}</span>
              </div>
              <p className="text-white/70">{f.reason}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function OrchestratorTasksTab({ detail }: { detail: AgentDetailView }) {
  const o = detail.orchestrator!;
  return (
    <Card>
      <p className="mb-3 text-sm text-white/60">{o.selectedRoleIds.length} role(s) selected for this project.</p>
      {o.blockedTaskTitles.length > 0 && (
        <div className="mb-3">
          <p className="font-mono text-[0.6rem] tracking-widest text-destructive uppercase">Blocked</p>
          <ul className="mt-1 list-inside list-disc text-sm text-white/70">
            {o.blockedTaskTitles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm text-white/80">{o.nextAction}</p>
    </Card>
  );
}

function FilesTab({ fileEntries }: { fileEntries: WorkspaceFileEntry[] }) {
  if (fileEntries.length === 0) {
    return <p className="text-sm text-white/50">This role hasn&apos;t materialized any real files yet.</p>;
  }
  return (
    <div className="[&_button]:text-white/80 [&_span]:text-white/50">
      <FileBrowser files={fileEntries} />
    </div>
  );
}

function ActivityTab({ detail }: { detail: AgentDetailView }) {
  if (detail.recentActivity.length === 0) {
    return <p className="text-sm text-white/50">Nothing recorded for this role yet.</p>;
  }
  return (
    <Card>
      <ul className="flex flex-col gap-2.5 text-sm">
        {detail.recentActivity.map((entry) => (
          <li key={entry.id} className="flex gap-3 border-b border-white/5 pb-2.5 text-white/75 last:border-0">
            <span className="shrink-0 font-mono text-[0.65rem] text-white/40">{formatTimestamp(entry.occurredAt)}</span>
            {entry.message}
          </li>
        ))}
      </ul>
      {detail.decisions.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 font-mono text-[0.6rem] tracking-widest text-white/50 uppercase">Decisions</p>
          <ul className="flex flex-col gap-2 text-sm">
            {detail.decisions.map((d, i) => (
              <li key={i}>
                <p className="font-medium text-white/85">{d.summary}</p>
                {d.rationale && <p className="text-xs text-white/50">{d.rationale}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function CapabilitiesTab({ specialization }: { specialization: RoleSpecialization }) {
  return (
    <Card>
      <p className="text-sm text-white/80">{specialization.mission}</p>
      {specialization.capabilities.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {specialization.capabilities.map((c) => (
            <Badge key={c} variant="outline" className="border-white/20 text-white/70">
              {c}
            </Badge>
          ))}
        </div>
      )}
      {specialization.responsibilities.length > 0 && (
        <ul className="mt-4 flex list-inside list-disc flex-col gap-1.5 border-t border-white/10 pt-4 text-sm text-white/70">
          {specialization.responsibilities.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The premium, full-width Agent Workspace that replaced the old narrow
 * AgentDetailDrawer. Selection lives in the URL (`useAgentSelection`), so
 * this component only needs `detail` to be non-null to render — its
 * mount/unmount is entirely controlled by the caller reading that same
 * selection.
 */
export function AgentWorkspace({
  detail,
  performance,
  nextSteps,
  specialization,
  fileEntries,
}: {
  detail: AgentDetailView;
  performance: RolePerformanceSummary;
  nextSteps: string[];
  specialization: RoleSpecialization;
  fileEntries: WorkspaceFileEntry[];
}) {
  const { clearSelection } = useAgentSelection();
  const accent = getRoleVisual(detail.roleId).accent;
  const isOrchestrator = !!detail.orchestrator;
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") clearSelection();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection]);

  // Real defect found during the platform-hardening audit: clicking an
  // office hotspot selects the agent (URL updates, workstation
  // highlights) but on desktop this component renders in-flow *below*
  // the office scene, off-screen — the owner had to scroll down manually
  // every time to actually see it. On mobile it's already a full-screen
  // overlay (`fixed inset-0`), so no scroll is needed there.
  //
  // Keyed on `detail.roleId` alone (not `officeState`/refresh-driven
  // props) so this only fires on a genuine new selection — this
  // component's props are re-supplied by every `AutoRefresh`-driven
  // server refresh too, but React only re-runs an effect when a
  // dependency's *value* actually changes, so a refresh that leaves the
  // same agent selected never re-triggers the scroll.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(min-width: 768px)").matches) return;
    workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detail.roleId]);

  const bannerStyle = getWorkstationCropRect(detail.roleId, 1200, 220, 1.0, 0.42);

  return (
    <div
      id="agent-workspace"
      ref={workspaceRef}
      role="region"
      aria-label={`${detail.roleName} workspace`}
      className="animate-workspace-enter fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#0a0812] md:static md:z-auto md:mt-4 md:overflow-visible md:rounded-[2rem] md:border md:border-white/10 md:shadow-[0_30px_70px_-30px_rgba(0,0,0,0.6)] md:scroll-mt-4"
    >
      <div className="relative shrink-0 overflow-hidden md:rounded-t-[2rem]" style={{ height: 200 }}>
        <div className="absolute inset-0" style={bannerStyle} aria-hidden="true" />
        <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, #0a0812 5%, transparent 50%), linear-gradient(0deg, #0a0812 0%, transparent 55%)` }} aria-hidden="true" />
        <div className="absolute inset-0" style={{ background: `color-mix(in oklch, ${accent} 12%, transparent)` }} aria-hidden="true" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={clearSelection}
          aria-label="Close agent workspace"
          className="absolute top-3 right-3 z-10 text-white hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" />
        </Button>

        <div className="relative flex h-full flex-col justify-end p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">{detail.roleName}</h2>
            <Badge style={{ background: accent, color: "#0a0812" }} className="border-0 font-mono text-[0.65rem] font-bold uppercase">
              {STATUS_LABEL[detail.status]}
            </Badge>
          </div>
          <p className="mt-1 max-w-xl text-sm text-white/70">{specialization.mission}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {specialization.capabilities.slice(0, 5).map((c) => (
              <span key={c} className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] text-white/80">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-white/10 bg-white/[0.02] px-5 py-3 text-xs sm:px-6">
        <div>
          <span className="text-white/40">Project </span>
          <span className="text-white/90">{detail.projectTitle ?? "None"}</span>
        </div>
        {detail.provider && (
          <div className="flex items-center gap-1.5">
            <span className="text-white/40">Provider </span>
            <ProviderBadge provider={detail.provider} model={detail.model} className="border-white/20" />
          </div>
        )}
        <div>
          <span className="text-white/40">Current Task </span>
          <span className="text-white/90">{detail.currentTaskTitle ?? "—"}</span>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col px-5 py-4 sm:px-6">
        <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <TabsList className="w-max bg-white/5">
            {/* The panel is always dark regardless of site theme (Section 16),
                but TabsTrigger's default text color is theme-variable-based
                (`text-foreground`, only light in .dark) — forced explicitly
                here so inactive tabs stay legible in light mode too. */}
            <TabsTrigger value="overview" className={TAB_TRIGGER_CLASS}>
              Overview
            </TabsTrigger>
            {!isOrchestrator && (
              <TabsTrigger value="task" className={TAB_TRIGGER_CLASS}>
                Current Task
              </TabsTrigger>
            )}
            <TabsTrigger value="progress" className={TAB_TRIGGER_CLASS}>
              Tasks &amp; Progress
            </TabsTrigger>
            {!isOrchestrator && (
              <TabsTrigger value="files" className={TAB_TRIGGER_CLASS}>
                Files
              </TabsTrigger>
            )}
            <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
              Activity
            </TabsTrigger>
            <TabsTrigger value="capabilities" className={TAB_TRIGGER_CLASS}>
              Capabilities
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="mt-4 min-h-0 flex-1">
          <TabsContent value="overview">
            <OverviewTab detail={detail} performance={performance} nextSteps={nextSteps} fileEntries={fileEntries} />
          </TabsContent>
          {!isOrchestrator && (
            <TabsContent value="task">
              <CurrentTaskTab detail={detail} />
            </TabsContent>
          )}
          <TabsContent value="progress">{isOrchestrator ? <OrchestratorTasksTab detail={detail} /> : <TasksProgressTab detail={detail} />}</TabsContent>
          {!isOrchestrator && (
            <TabsContent value="files">
              <FilesTab fileEntries={fileEntries} />
            </TabsContent>
          )}
          <TabsContent value="activity">
            <ActivityTab detail={detail} />
          </TabsContent>
          <TabsContent value="capabilities">
            <CapabilitiesTab specialization={specialization} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
