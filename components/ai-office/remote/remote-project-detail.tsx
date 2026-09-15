import Link from "next/link";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProjectDetail } from "@/lib/ai-office/dashboard/project-detail-data";
import { RemoteApprovalButtons } from "./remote-approval-buttons";

const TASK_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DONE: "secondary",
  IN_PROGRESS: "default",
  ASSIGNED: "default",
  PENDING: "outline",
  IN_REVIEW: "default",
  FAILED: "destructive",
  BLOCKED: "destructive",
};

export function RemoteProjectDetail({ detail }: { detail: ProjectDetail }) {
  const { project, tasks, progress, approvals, failures, workspace } = detail;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/office" className="text-xs text-muted-foreground hover:underline">
            ← All remote projects
          </Link>
          <h2 className="mt-1 text-xl font-semibold">{project.title}</h2>
        </div>
        <Badge variant="outline" className="font-mono text-xs uppercase">
          {detail.displayStatusLabel}
        </Badge>
      </div>

      <GlassCard className="p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium">
            {progress.completed} / {progress.total} tasks
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }} />
        </div>
      </GlassCard>

      {approvals.filter((a) => a.status === "PENDING").length > 0 && (
        <GlassCard className="p-4">
          <p className="mb-2 text-sm font-medium">Pending approval</p>
          <div className="flex flex-col gap-2">
            {approvals
              .filter((a) => a.status === "PENDING")
              .map((approval) => (
                <div key={approval.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
                  <div>
                    <p className="text-sm font-medium">{approval.kind.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">Requested by {approval.requestedBy}</p>
                  </div>
                  <RemoteApprovalButtons projectId={project.id} approvalId={approval.id} />
                </div>
              ))}
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-4">
        <p className="mb-3 text-sm font-medium">Tasks</p>
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
              <div>
                <p className="text-sm">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {task.roleId} · attempt {task.attemptCount || 1}
                </p>
              </div>
              <Badge variant={TASK_STATUS_VARIANT[task.status] ?? "outline"} className="font-mono text-xs uppercase">
                {task.status}
              </Badge>
            </div>
          ))}
        </div>
      </GlassCard>

      {failures.length > 0 && (
        <GlassCard className="p-4">
          <p className="mb-2 text-sm font-medium">Failures</p>
          <div className="flex flex-col gap-1">
            {failures.map((f) => (
              <p key={f.id} className="text-xs text-muted-foreground">
                {f.resolved ? "✓ resolved — " : "⚠ unresolved — "}
                {f.reason}
              </p>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-4">
        <p className="mb-2 text-sm font-medium">Workspace</p>
        {workspace.hasWorkspace ? (
          <p className="text-xs text-muted-foreground">
            Delivery state: <span className="font-mono uppercase">{workspace.deliveryState ?? "unknown"}</span> · {workspace.files.length} file(s)
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No workspace yet.</p>
        )}
      </GlassCard>

      <Button asChild variant="outline" size="sm" className="self-start">
        <a href={`https://github.com/${process.env.AI_OFFICE_REMOTE_REPO_OWNER ?? ""}/${process.env.AI_OFFICE_REMOTE_REPO_NAME ?? "teja-ai-office-runtime"}/tree/main/workspaces/${project.id}`} target="_blank" rel="noreferrer">
          View files on GitHub →
        </a>
      </Button>
    </div>
  );
}
