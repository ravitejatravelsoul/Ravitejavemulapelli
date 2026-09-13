import type { Metadata } from "next";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { computeOfficeHealthStatus } from "@/lib/ai-office/engineer/office-engineer";
import { listRecentIncidents } from "@/lib/ai-office/domain/office-incidents";
import { getProject } from "@/lib/ai-office/domain/projects";
import { getTask } from "@/lib/ai-office/domain/tasks";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Office Engineer" };

const STATUS_COPY: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; description: string }> = {
  HEALTHY: { label: "Healthy", variant: "secondary", description: "No open incidents — every project the runner has looked at is progressing normally." },
  WATCHING: { label: "Watching", variant: "outline", description: "A minor signal is being tracked; nothing needs attention yet." },
  INVESTIGATING: { label: "Investigating", variant: "outline", description: "Diagnosing a real symptom before deciding whether it's safe to auto-repair." },
  REPAIRING: { label: "Repairing", variant: "default", description: "Applying a safe, deterministic repair — the same Retry an owner could click themselves." },
  ESCALATED: { label: "Escalated", variant: "destructive", description: "A real problem needs owner judgment — Office Engineer never auto-repairs a content/logic failure." },
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Office Engineer's maintenance/operations area (platform-hardening
 * phase, Part 11) — deliberately separate from the project Workforce
 * grid: this agent is not a project role and never appears in a
 * project's own task DAG. Every incident shown here is real, persisted
 * `office_incidents` history — nothing on this page is synthesized for
 * display.
 */
export default async function OfficeEngineerPage() {
  const db = getAppDatabase();
  const status = computeOfficeHealthStatus(db);
  const incidents = listRecentIncidents(db, 50);
  const statusCopy = STATUS_COPY[status];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Office Engineer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Self-healing maintenance and reliability agent. Runs deterministic, free health checks every runner cycle — it never calls a paid AI
          provider to monitor or repair anything.
        </p>
      </div>

      <GlassCard>
        <div className="flex items-center gap-3">
          <Badge variant={statusCopy.variant} className="font-mono text-xs uppercase">
            {statusCopy.label}
          </Badge>
          <p className="text-sm text-muted-foreground">{statusCopy.description}</p>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Incident history</h2>
        {incidents.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No incidents have ever been recorded — the office has been healthy since it opened.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {incidents.map((incident) => {
              const project = incident.projectId ? getProject(db, incident.projectId) : undefined;
              const task = incident.taskId ? getTask(db, incident.taskId) : undefined;
              return (
                <li key={incident.id} className="rounded-xl border border-border/50 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_COPY[incident.status]?.variant ?? "outline"} className="font-mono text-[0.6rem] uppercase">
                      {incident.status}
                    </Badge>
                    <span className="font-mono text-[0.65rem] text-muted-foreground uppercase">{incident.symptom}</span>
                    {project && <span className="text-xs text-muted-foreground">Project: {project.title}</span>}
                    {task && <span className="text-xs text-muted-foreground">Task: {task.title}</span>}
                    <span className="ml-auto shrink-0 text-[0.65rem] text-muted-foreground">{formatDate(incident.detectedAt)}</span>
                  </div>
                  {incident.diagnosis && <p className="mt-2 text-xs text-muted-foreground">{incident.diagnosis}</p>}
                  {incident.repairAction && (
                    <p className="mt-1 text-xs">
                      <span className="text-muted-foreground">Repair: </span>
                      {incident.repairAction}
                      {incident.repairProvider && ` · provider: ${incident.repairProvider}`}
                      {incident.repairCostUsd != null && ` · cost: $${incident.repairCostUsd.toFixed(4)}`}
                    </p>
                  )}
                  {incident.retryResult && (
                    <p className="mt-1 text-xs">
                      <span className="text-muted-foreground">Result: </span>
                      {incident.retryResult}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
