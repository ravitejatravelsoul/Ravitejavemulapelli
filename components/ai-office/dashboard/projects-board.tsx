"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "@/lib/ai-office/dashboard/dashboard-data";

const FILTERS = ["All", "Running", "Needs Attention", "Ready for Review", "Completed", "Paused"] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(project: ProjectSummary, filter: Filter): boolean {
  switch (filter) {
    case "All":
      return true;
    case "Running":
      return project.status === "IN_PROGRESS";
    case "Needs Attention":
      return project.status === "BLOCKED" || project.unresolvedFailures > 0 || project.pendingApprovals > 0 || project.isStalledWithNoDeliverable;
    case "Ready for Review":
      return project.status === "READY_FOR_REVIEW" && !project.isUnverifiedCompletion;
    case "Completed":
      return project.status === "APPROVED";
    case "Paused":
      return project.status === "PAUSED";
  }
}

function formatRelativeTime(ms: number): string {
  const diffMinutes = Math.round((Date.now() - ms) / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const progressPct = project.totalTasks > 0 ? Math.round((project.completedTasks / project.totalTasks) * 100) : 0;

  return (
    <Link
      href={`/office/projects/${project.id}`}
      className={cn(
        "glass block rounded-2xl p-4 transition-colors",
        "hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="truncate text-sm font-semibold tracking-tight">{project.title}</h3>
        <Badge variant={project.isStalledWithNoDeliverable ? "destructive" : project.isUnverifiedCompletion ? "outline" : "default"}>
          {project.displayStatusLabel}
        </Badge>
        {project.deliveryState && (
          <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
            {project.deliveryState}
          </Badge>
        )}
        <Badge variant={project.aiPolicyMode === "LOCAL_ONLY" ? "outline" : "secondary"} className="font-mono text-[0.6rem] uppercase">
          {project.aiPolicyMode.replace("_", " ")}
        </Badge>
        {project.canPreview && (
          <Badge variant="secondary" className="font-mono text-[0.6rem] uppercase">
            Preview ready
          </Badge>
        )}
      </div>
      {project.ideaSummary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.ideaSummary}</p>}

      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {project.completedTasks}/{project.totalTasks} tasks
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {project.currentTaskRoleName && (
          <span>
            {project.completedTasks === project.totalTasks ? "Last active" : "Active"}: {project.currentTaskRoleName}
          </span>
        )}
        {project.unresolvedFailures > 0 && <span className="text-destructive">{project.unresolvedFailures} failure(s)</span>}
        {project.pendingApprovals > 0 && <span className="text-amber-500">{project.pendingApprovals} approval(s)</span>}
        <span>LIVE ${project.liveCostUsd.toFixed(2)}</span>
        <span>{formatRelativeTime(project.updatedAt)}</span>
      </div>
    </Link>
  );
}

/**
 * Projects portfolio (Section 26) — client-side filter/search over an
 * already-real, server-fetched `ProjectSummary[]`; no separate data
 * fetch per filter, since the office's project count is modest and every
 * field needed is already part of the existing summary projection.
 */
export function ProjectsBoard({ projects }: { projects: ProjectSummary[] }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return projects.filter((p) => matchesFilter(p, filter) && (lowerQuery === "" || p.title.toLowerCase().includes(lowerQuery)));
  }, [projects, filter, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter projects">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <GlassCard className="text-center text-sm text-muted-foreground">
          {projects.length === 0 ? "No projects yet — start one from the Office." : "No projects match this filter."}
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
