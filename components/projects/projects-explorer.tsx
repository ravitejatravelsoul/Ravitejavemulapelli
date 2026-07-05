"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ProjectCard } from "@/components/projects/project-card";
import { getProjectWorkContext, isProjectInProgress } from "@/lib/project-groups";
import type { ProjectSummary } from "@/lib/data/types";

interface ProjectsExplorerProps {
  projects: ProjectSummary[];
}

const ALL = "All";
const IN_PROGRESS = "In Progress";

/** Combines the raw content categories with a derived work-context tag (and
 * an "In Progress" tag where applicable) so visitors can quickly separate
 * employer platform work from client sites and independent products,
 * without any project being re-tagged or re-categorized by hand. */
function effectiveTags(project: ProjectSummary): string[] {
  const tags = [...project.category, getProjectWorkContext(project)];
  if (isProjectInProgress(project)) tags.push(IN_PROGRESS);
  return tags;
}

export function ProjectsExplorer({ projects }: ProjectsExplorerProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const shouldReduceMotion = useReducedMotion();

  const categories = useMemo(() => {
    const groups = new Set<string>();
    const rest = new Set<string>();
    projects.forEach((project) => {
      groups.add(getProjectWorkContext(project));
      if (isProjectInProgress(project)) groups.add(IN_PROGRESS);
      project.category.forEach((c) => rest.add(c));
    });
    return [ALL, ...Array.from(groups).sort(), ...Array.from(rest).sort()];
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesCategory = category === ALL || effectiveTags(project).includes(category);
      const matchesQuery =
        q.length === 0 ||
        project.title.toLowerCase().includes(q) ||
        project.tagline.toLowerCase().includes(q) ||
        project.techStack.some((tech) => tech.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
  }, [projects, query, category]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects or tech..."
            className="pl-9"
            aria-label="Search projects"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <Badge
                variant={category === cat ? "default" : "outline"}
                className="cursor-pointer px-3 py-1 text-xs font-normal transition-transform hover:scale-105"
              >
                {cat}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-16 text-sm text-muted-foreground">
          No projects match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <motion.div
          layout={!shouldReduceMotion} suppressHydrationWarning
          className="mt-14 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((project, index) => (
              <motion.div
                key={project.slug}
                layout={!shouldReduceMotion} suppressHydrationWarning
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <ProjectCard project={project} index={index} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
