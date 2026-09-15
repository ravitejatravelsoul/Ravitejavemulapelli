"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LogOut } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OverviewCards } from "@/components/ai-office/dashboard/overview-cards";
import { BudgetPanel } from "@/components/ai-office/dashboard/budget-panel";
import { ActivityFeed } from "@/components/ai-office/dashboard/activity-feed";
import { RemoteNewProjectForm } from "./remote-new-project-form";
import { RemoteProjectDetail } from "./remote-project-detail";
import type { OfficeOverview, ProjectSummary, ActivityEntry, BudgetView } from "@/lib/ai-office/dashboard/dashboard-data";
import type { ProjectDetail } from "@/lib/ai-office/dashboard/project-detail-data";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  PLANNING: "outline",
  IN_PROGRESS: "default",
  BLOCKED: "destructive",
  PAUSED: "secondary",
  READY_FOR_REVIEW: "secondary",
  APPROVED: "secondary",
  FAILED: "destructive",
  ARCHIVED: "outline",
};

/**
 * Client-side view switch only — `?project=<id>` chooses which already-
 * server-fetched detail to show. Next.js's `layout.tsx` (this
 * component's ultimate parent — see remote-office-shell.tsx) does not
 * receive `searchParams` (page-only, by design — see
 * node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md),
 * so instead of a second server round-trip per selection, every
 * project's full detail is fetched once upfront (realistic for a
 * single-owner tool with a handful of remote projects — see
 * remote-dashboard-store.ts's scale note) and handed to this component,
 * which does the cheap, purely client-side job of picking which one to
 * render. No additional data ever leaves the server as a result of this
 * navigation.
 */
export function RemoteOfficeShellClient({
  email,
  signOut,
  overview,
  projects,
  details,
  activity,
  budget,
}: {
  email: string;
  signOut: () => void;
  overview: OfficeOverview;
  projects: ProjectSummary[];
  details: Record<string, ProjectDetail>;
  activity: ActivityEntry[];
  budget: BudgetView;
}) {
  const searchParams = useSearchParams();
  const selectedProjectId = searchParams.get("project");
  const selectedDetail = selectedProjectId ? details[selectedProjectId] : undefined;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Teja&apos;s AI Office</p>
          <h1 className="mt-1 text-xl font-semibold">Remote Workspace</h1>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="default" className="font-mono text-xs uppercase">
            Remote mode
          </Badge>
          <span className="text-xs text-muted-foreground">{email}</span>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="gap-2">
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </form>
        </div>
      </div>

      <GlassCard className="!p-4">
        <p className="text-sm text-muted-foreground">
          Projects run in the background via GitHub Actions — you can close this tab at any time. State, progress, and generated files persist in a
          private repository and are visible here whenever you come back.
        </p>
      </GlassCard>

      {selectedDetail ? (
        <RemoteProjectDetail detail={selectedDetail} />
      ) : (
        <>
          <OverviewCards overview={overview} />

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-4">
              <GlassCard className="p-4">
                <p className="mb-3 text-sm font-medium">Projects</p>
                {projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No remote projects yet — start one below.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {projects.map((p) => (
                      <Link
                        key={p.id}
                        href={`/office?project=${p.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3 hover:bg-muted/40"
                      >
                        <div>
                          <p className="text-sm font-medium">{p.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.completedTasks}/{p.totalTasks} tasks{p.currentTaskTitle ? ` · ${p.currentTaskTitle}` : ""}
                          </p>
                        </div>
                        <Badge variant={STATUS_VARIANT[p.status] ?? "outline"} className="font-mono text-xs uppercase">
                          {p.displayStatusLabel}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </GlassCard>

              <ActivityFeed entries={activity} />
            </div>

            <div className="flex flex-col gap-4">
              <RemoteNewProjectForm />
              <BudgetPanel budget={budget} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
