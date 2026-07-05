import type { ProjectSummary } from "@/lib/data/types";

/**
 * Built as part of the day job at Charter Communications — see
 * `content/data/experience.json`'s `current-role.relatedProjectSlugs`.
 * Kept as an explicit list (rather than inferred from `category`, which
 * overlaps between enterprise and personal QA tooling) so the grouping is
 * never a guess.
 */
const ENTERPRISE_SLUGS = ["api-automation-platform", "mqe-intelligence", "spectrum-releasepulse-ai"];

export type ProjectWorkContext = "Enterprise Platforms" | "Client Websites" | "Personal Products";

export function getProjectWorkContext(project: ProjectSummary): ProjectWorkContext {
  if (ENTERPRISE_SLUGS.includes(project.slug)) return "Enterprise Platforms";
  if (project.category.includes("Client Project")) return "Client Websites";
  return "Personal Products";
}

export function isProjectInProgress(project: ProjectSummary): boolean {
  return project.status === "in-progress" || project.status === "concept";
}
