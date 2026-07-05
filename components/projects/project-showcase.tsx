import Link from "next/link";
import { ArrowUpRight, Globe, Monitor, Smartphone, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectCover } from "@/components/projects/project-cover";
import { FloatingCard } from "@/components/motion/floating-card";
import { AppleIcon } from "@/components/icons/brand-icons";
import { cn } from "@/lib/utils";
import { projectStatusStyle } from "@/lib/project-status";
import { isPlaceholder } from "@/lib/placeholder";
import type { ProjectSummary } from "@/lib/data/types";

const platformIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  Web: Globe,
  Android: Smartphone,
  iOS: AppleIcon,
  "Windows Desktop": Monitor,
  Windows: Monitor,
};

interface ProjectShowcaseProps {
  project: ProjectSummary;
  index?: number;
  reversed?: boolean;
}

/**
 * Big alternating "flagship" project tile — used for the top 1-2 featured
 * projects, distinct from the compact `ProjectCard` used in grids. Reads
 * like a startup landing-page feature section rather than a portfolio tile.
 */
export function ProjectShowcase({ project, index = 0, reversed = false }: ProjectShowcaseProps) {
  const status = projectStatusStyle[project.status];
  const isLive = project.status === "live";
  const realMetrics = (project.metrics ?? []).filter(
    (metric) => !isPlaceholder(metric.value) && !isPlaceholder(metric.label),
  );

  return (
    <div
      className={cn(
        "grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16",
        reversed && "lg:[&>*:first-child]:order-2",
      )}
    >
      <FloatingCard tiltStrength={4} className="rounded-2xl">
        <Link href={`/projects/${project.slug}`} className="group relative block">
          <ProjectCover
            title={project.title}
            coverImage={project.coverImage}
            index={index}
            className="aspect-[4/3] sm:aspect-video"
            priority={index === 0}
          />
          {project.featuredRibbon ? (
            <Badge className="gradient-cta absolute top-3 left-3 gap-1 border-0 text-[10px] font-medium tracking-wide uppercase">
              <Sparkles className="size-3" /> Featured
            </Badge>
          ) : null}
        </Link>
      </FloatingCard>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <span className="relative flex size-1.5">
              {isLive ? (
                <span className="dot-pulse-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
              ) : null}
              <span className={cn("relative inline-flex size-1.5 rounded-full", status.dot)} />
            </span>
            {status.label}
          </Badge>
          {project.badge ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {project.badge}
            </Badge>
          ) : null}
          {project.category.slice(0, 2).map((c) => (
            <Badge key={c} variant="outline" className="font-normal">
              {c}
            </Badge>
          ))}
          <span className="font-mono text-xs text-muted-foreground">{project.year}</span>
        </div>

        <h3 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
          <Link
            href={`/projects/${project.slug}`}
            className="transition-colors hover:text-primary"
          >
            {project.title}
          </Link>
        </h3>
        <p
          className={cn(
            "mt-3 text-pretty text-lg text-muted-foreground",
            isPlaceholder(project.tagline) && "italic",
          )}
        >
          {project.tagline}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{project.role}</span>
          {project.platform.length > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1.5" aria-label={`Available on ${project.platform.join(", ")}`}>
                {project.platform.map((p) => {
                  const Icon = platformIcon[p];
                  return Icon ? <Icon key={p} className="size-3.5" /> : null;
                })}
                <span className="text-xs">{project.platform.join(" + ")}</span>
              </span>
            </>
          ) : null}
        </div>

        {realMetrics.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-6">
            {realMetrics.slice(0, 3).map((metric) => (
              <div key={metric.label}>
                <p className="font-mono text-xl font-semibold text-foreground">{metric.value}</p>
                <p className="text-xs text-muted-foreground">{metric.label}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {project.techStack.slice(0, 5).map((tech) => (
            <Badge
              key={tech}
              variant="outline"
              className="font-mono text-xs font-normal text-muted-foreground transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/50 hover:text-foreground"
            >
              {tech}
            </Badge>
          ))}
        </div>

        <Button asChild className="mt-8 gap-2">
          <Link href={`/projects/${project.slug}`}>
            View case study <ArrowUpRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
