import Link from "next/link";
import { ArrowUpRight, Globe, Monitor, Smartphone, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProjectCover } from "@/components/projects/project-cover";
import { FloatingCard } from "@/components/motion/floating-card";
import { AppleIcon } from "@/components/icons/brand-icons";
import { projectStatusStyle } from "@/lib/project-status";
import { isPlaceholder } from "@/lib/placeholder";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "@/lib/data/types";

const platformIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  Web: Globe,
  Android: Smartphone,
  iOS: AppleIcon,
  "Windows Desktop": Monitor,
  Windows: Monitor,
};

export function ProjectCard({ project, index = 0 }: { project: ProjectSummary; index?: number }) {
  const status = projectStatusStyle[project.status];
  const isLive = project.status === "live";
  const realMetric = (project.metrics ?? []).find(
    (metric) => !isPlaceholder(metric.value) && !isPlaceholder(metric.label),
  );

  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <FloatingCard className="glass rounded-2xl p-4 transition-[border-color,box-shadow] duration-300 group-hover:border-primary/40 group-hover:shadow-[0_28px_70px_-30px_rgba(0,0,0,0.7)]">
        <div className="relative">
          <ProjectCover title={project.title} coverImage={project.coverImage} index={index} />
          {project.featuredRibbon ? (
            <Badge className="gradient-cta absolute top-3 left-3 gap-1 border-0 text-[10px] font-medium tracking-wide uppercase">
              <Sparkles className="size-3" /> Featured
            </Badge>
          ) : null}
        </div>

        <div className="mt-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-medium tracking-tight">{project.title}</h3>
              <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
                <span className="relative flex size-1.5">
                  {isLive ? (
                    <span className="dot-pulse-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                  ) : null}
                  <span className={cn("relative inline-flex size-1.5 rounded-full", status.dot)} />
                </span>
                {status.label}
              </Badge>
              {project.badge ? (
                <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                  {project.badge}
                </Badge>
              ) : null}
            </div>
            <p
              className={cn(
                "mt-1.5 text-sm text-muted-foreground",
                isPlaceholder(project.tagline) && "italic",
              )}
            >
              {project.tagline}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{project.year}</span>
              <span aria-hidden>·</span>
              <span>{project.role}</span>
              {project.platform.length > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-1.5" aria-label={`Available on ${project.platform.join(", ")}`}>
                    {project.platform.map((p) => {
                      const Icon = platformIcon[p];
                      return Icon ? <Icon key={p} className="size-3" /> : null;
                    })}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>

        {realMetric ? (
          <p className="mt-3 font-mono text-xs text-primary/90">
            {realMetric.value} <span className="text-muted-foreground">{realMetric.label}</span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {project.techStack.slice(0, 4).map((tech, chipIndex) => (
            <Badge
              key={tech}
              variant="outline"
              style={{ transitionDelay: `${chipIndex * 40}ms` }}
              className="font-mono text-xs font-normal text-muted-foreground transition-all duration-300 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:text-foreground"
            >
              {tech}
            </Badge>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          View case study <ArrowUpRight className="size-3" />
        </div>
      </FloatingCard>
    </Link>
  );
}
