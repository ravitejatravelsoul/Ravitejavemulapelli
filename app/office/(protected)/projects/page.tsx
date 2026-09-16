import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getOfficeDb } from "@/lib/ai-office/office-db";
import { getProjectSummaries } from "@/lib/ai-office/dashboard/dashboard-data";
import { ProjectsBoard } from "@/components/ai-office/dashboard/projects-board";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Projects" };

/** The project portfolio (Section 26) — every project the Office has ever planned, filterable and searchable, all from real, already-persisted state. */
export default async function ProjectsPage() {
  const db = await getOfficeDb();
  const projects = getProjectSummaries(db);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
        <Button asChild size="sm">
          <Link href="/office/projects/new">
            <Plus className="size-3.5" />
            New Project
          </Link>
        </Button>
      </div>
      <ProjectsBoard projects={projects} />
    </div>
  );
}
