import type { ProjectSummary } from "@/lib/data/types";

export const projectStatusStyle: Record<ProjectSummary["status"], { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-emerald-400" },
  "in-progress": { label: "In Progress", dot: "bg-primary" },
  concept: { label: "Concept", dot: "bg-accent-2" },
  archived: { label: "Archived", dot: "bg-muted-foreground" },
};
