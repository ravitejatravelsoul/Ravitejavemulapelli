import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getFeaturedProjects } from "@/lib/data";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { FadeIn } from "@/components/motion/fade-in";
import { Reveal } from "@/components/common/reveal";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectShowcase } from "@/components/projects/project-showcase";

// The 4 flagship projects (API Automation Platform, Snaptura, MQE Intelligence
// Platform, SoloTravelSoul) are ordered first in content/data — see each
// project's `order` field — so they land in the large showcase treatment
// below instead of the compact grid.
const SHOWCASE_COUNT = 4;

export async function FeaturedProjects() {
  const projects = await getFeaturedProjects();
  const flagship = projects.slice(0, SHOWCASE_COUNT);
  const rest = projects.slice(SHOWCASE_COUNT);

  return (
    <Section id="work">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <SectionHeading
          eyebrow="Selected Work"
          title="Products I've taken from idea to production"
          description="Some built as part of leading automation strategy at Charter Communications, others shipped solo on nights and weekends — different contexts, the same habit of finishing the whole thing instead of stopping at the interesting part."
        />
        <FadeIn delay={0.2}>
          <Link
            href="/projects"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all projects <ArrowRight className="size-4" />
          </Link>
        </FadeIn>
      </div>

      {flagship.length > 0 ? (
        <div className="mt-16 space-y-24">
          {flagship.map((project, index) => (
            <Reveal key={project.slug}>
              <ProjectShowcase project={project} index={index} reversed={index % 2 === 1} />
            </Reveal>
          ))}
        </div>
      ) : null}

      {rest.length > 0 ? (
        <StaggerContainer className="mt-24 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((project, index) => (
            <StaggerItem key={project.slug}>
              <ProjectCard project={project} index={index + SHOWCASE_COUNT} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : null}
    </Section>
  );
}
