import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getProjectDetail } from "@/lib/ai-office/dashboard/project-detail-data";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ai-office/action-button";
import { TaskFlow } from "@/components/ai-office/dashboard/task-flow";
import { AutoRefresh } from "@/components/ai-office/auto-refresh";
import { pauseProjectAction, resumeProjectAction } from "@/app/office/actions/projects";

export const metadata: Metadata = { title: "Project" };

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getAppDatabase();
  const detail = getProjectDetail(db, projectId);
  if (!detail) notFound();

  const { project, ideaText, tasks, progress, failures, decisions, artifacts, approvals, activity, memorySummary, knownIssues, simulatedCostUsd, liveCostUsd } = detail;
  const canPause = project.status === "IN_PROGRESS";
  const canResume = project.status === "PAUSED";

  const isActive = project.status === "IN_PROGRESS";

  return (
    <div className="flex flex-col gap-6">
      {isActive && <AutoRefresh />}
      <GlassCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{project.title}</h1>
              <Badge>{project.status.replace(/_/g, " ")}</Badge>
              <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
                {project.aiMode}
              </Badge>
              <Badge variant="secondary" className="font-mono text-[0.6rem] uppercase">
                {project.provider}
              </Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{ideaText}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Created {formatDate(project.createdAt)} · Updated {formatDate(project.updatedAt)}
            </p>
          </div>
          {(canPause || canResume) && (
            <div className="flex gap-2">
              {canPause && (
                <ActionButton action={pauseProjectAction.bind(null, project.id)} variant="outline" size="sm" successMessage="Project paused.">
                  Pause
                </ActionButton>
              )}
              {canResume && (
                <ActionButton action={resumeProjectAction.bind(null, project.id)} variant="outline" size="sm" successMessage="Project resumed.">
                  Resume
                </ActionButton>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            Progress: {progress.completed}/{progress.total} tasks
          </span>
          <span>Simulated cost: ${simulatedCostUsd.toFixed(2)}</span>
          <span>LIVE cost: ${liveCostUsd.toFixed(2)}</span>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">
          Task Graph <span className="font-normal text-muted-foreground">· {tasks.length} steps</span>
        </h2>
        <div className="mt-4">
          <TaskFlow tasks={tasks} />
        </div>
      </GlassCard>

      {approvals.length > 0 && (
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">Approvals</h2>
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {approvals.map((approval) => (
              <li key={approval.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2 last:border-0">
                <Badge variant={approval.status === "PENDING" ? "default" : approval.status === "APPROVED" ? "secondary" : "destructive"}>
                  {approval.status}
                </Badge>
                <span>{approval.kind.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">{approval.taskId ? "task-scoped" : "project-wide"}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      {failures.length > 0 && (
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight text-destructive">Unresolved Failures</h2>
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {failures.map((failure) => (
              <li key={failure.id} className="border-b border-border/40 pb-2 last:border-0">
                {failure.reason}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">Decisions</h2>
          {decisions.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No decisions recorded yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2.5 text-xs">
              {decisions.map((decision) => (
                <li key={decision.id} className="border-b border-border/40 pb-2.5 last:border-0">
                  <p className="font-medium">{decision.summary}</p>
                  {decision.rationale && <p className="mt-0.5 text-muted-foreground">{decision.rationale}</p>}
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">Artifacts</h2>
          {artifacts.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No artifacts produced yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2.5 text-xs">
              {artifacts.map((artifact) => (
                <li key={artifact.id} className="border-b border-border/40 pb-2.5 last:border-0">
                  <p className="font-medium">
                    {artifact.type} <span className="text-muted-foreground">v{artifact.version}</span>
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{artifact.preview}</p>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Project Memory</h2>
        {memorySummary ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">{memorySummary}</p>
            {knownIssues.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                {knownIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No memory recorded yet — memory builds up once the first task finishes.</p>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Activity</h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {activity.map((entry) => (
              <li key={entry.id} className="border-b border-border/40 pb-2 last:border-0">
                {entry.message}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
