import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ai-office/action-button";
import { pauseProjectAction, resumeProjectAction } from "@/app/office/actions/projects";
import type { ProjectSummary } from "@/lib/ai-office/dashboard/dashboard-data";
import type { ProjectStatus } from "@/lib/ai-office/domain/projects";

const STATUS_VARIANT: Record<ProjectStatus, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  PLANNING: "outline",
  IN_PROGRESS: "default",
  BLOCKED: "destructive",
  PAUSED: "secondary",
  READY_FOR_REVIEW: "default",
  APPROVED: "default",
  FAILED: "destructive",
  ARCHIVED: "outline",
};

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <GlassCard className="p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold tracking-tight">{project.title}</h3>
            <Badge variant={STATUS_VARIANT[project.status]}>{project.status.replace(/_/g, " ")}</Badge>
            <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
              {project.aiMode}
            </Badge>
          </div>
          {project.ideaSummary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.ideaSummary}</p>}
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/office/projects/${project.id}`}>
            View
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {project.completedTasks}/{project.totalTasks} tasks complete
        </span>
        {project.currentTaskTitle && <span>Current: {project.currentTaskTitle}</span>}
        {project.latestAgentRoleId && <span>Latest agent: {project.latestAgentRoleId}</span>}
        {project.unresolvedFailures > 0 && <span className="text-destructive">{project.unresolvedFailures} unresolved failure(s)</span>}
        {project.pendingApprovals > 0 && <span className="text-amber-500">{project.pendingApprovals} pending approval(s)</span>}
        <span>Simulated cost: ${project.simulatedCostUsd.toFixed(2)}</span>
      </div>

      {(project.canPause || project.canResume) && (
        <div className="mt-3 flex gap-2">
          {project.canPause && (
            <ActionButton action={pauseProjectAction.bind(null, project.id)} variant="outline" size="sm" successMessage="Project paused.">
              Pause
            </ActionButton>
          )}
          {project.canResume && (
            <ActionButton action={resumeProjectAction.bind(null, project.id)} variant="outline" size="sm" successMessage="Project resumed.">
              Resume
            </ActionButton>
          )}
        </div>
      )}
    </GlassCard>
  );
}

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  if (projects.length === 0) {
    return (
      <GlassCard className="text-center text-sm text-muted-foreground">
        No projects yet. Use <span className="font-medium text-foreground">Start New Project</span> above to submit an idea — the
        Orchestrator plans it automatically.
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
