import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { getProjectBySlug, getProjectSlugs, getProjects, getSiteConfig } from "@/lib/data";
import { mdxComponents } from "@/lib/mdx-components";
import { extractToc } from "@/lib/toc";
import { Section } from "@/components/common/section";
import { Reveal } from "@/components/common/reveal";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectCover } from "@/components/projects/project-cover";
import { ProjectCard } from "@/components/projects/project-card";
import { AppleIcon, GitHubIcon, GooglePlayIcon } from "@/components/icons/brand-icons";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { FloatingCard } from "@/components/motion/floating-card";
import { TableOfContents } from "@/components/blog/table-of-contents";
import { ReadingProgress } from "@/components/motion/reading-progress";
import { JsonLd } from "@/components/common/json-ld";

export async function generateStaticParams() {
  const slugs = await getProjectSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project) return {};

  const ogImage = project.coverImage || "/og-image.png";

  return {
    title: project.title,
    description: project.summary,
    alternates: { canonical: `/projects/${project.slug}` },
    openGraph: {
      title: project.title,
      description: project.summary,
      type: "article",
      images: [{ url: ogImage, width: 1200, height: 630, alt: project.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: project.title,
      description: project.summary,
      images: [ogImage],
    },
  };
}

const statusLabel: Record<string, string> = {
  live: "Live",
  "in-progress": "In Progress",
  concept: "Concept",
  archived: "Archived",
};

export default async function ProjectCaseStudyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [project, allProjects, site] = await Promise.all([
    getProjectBySlug(slug),
    getProjects(),
    getSiteConfig(),
  ]);

  if (!project) notFound();

  const related = allProjects.filter((p) => p.slug !== project.slug).slice(0, 3);
  const currentIndex = allProjects.findIndex((p) => p.slug === project.slug);
  const nextProject =
    allProjects.length > 1 ? allProjects[(currentIndex + 1) % allProjects.length] : null;
  const toc = extractToc(project.content);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          name: project.title,
          description: project.summary,
          creator: { "@type": "Person", name: site.name },
          dateCreated: project.year,
          url: `${site.seo.url}/projects/${project.slug}`,
        }}
      />
      <ReadingProgress />
      <Section className="pt-20 pb-0 md:pt-24">
        <Reveal eager>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> All projects
          </Link>

          <div className="mt-8 flex flex-wrap gap-2">
            {project.featuredRibbon ? (
              <Badge className="gradient-cta gap-1 border-0 text-[10px] font-medium tracking-wide uppercase">
                <Sparkles className="size-3" /> Featured
              </Badge>
            ) : null}
            {project.category.map((c) => (
              <Badge key={c} variant="secondary">
                {c}
              </Badge>
            ))}
            <Badge variant="outline">{statusLabel[project.status]}</Badge>
            {project.badge ? <Badge variant="outline">{project.badge}</Badge> : null}
            <Badge variant="outline">{project.year}</Badge>
          </div>

          <h1 className="mt-6 max-w-3xl text-balance text-[clamp(1.875rem,4vw,2.75rem)] leading-[1.15] font-semibold tracking-tight">
            {project.title}
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
            {project.summary}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {project.links.live ? (
              <Button asChild>
                <a href={project.links.live} target="_blank" rel="noreferrer">
                  Visit Website <ArrowUpRight className="size-4" />
                </a>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href="#case-study">
                View Case Study <ArrowUpRight className="size-4" />
              </Link>
            </Button>
            {project.links.playStore ? (
              <a
                href={project.links.playStore}
                target="_blank"
                rel="noreferrer"
                aria-label="Get it on Google Play"
                className="flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <GooglePlayIcon className="size-4" />
              </a>
            ) : null}
            {project.links.appStore ? (
              <a
                href={project.links.appStore}
                target="_blank"
                rel="noreferrer"
                aria-label="Download on the App Store"
                className="flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <AppleIcon className="size-4" />
              </a>
            ) : null}
            {project.links.github ? (
              <a
                href={project.links.github}
                target="_blank"
                rel="noreferrer"
                aria-label="View source on GitHub"
                className="flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <GitHubIcon className="size-4" />
              </a>
            ) : null}
          </div>
        </Reveal>

        <Reveal eager delay={0.1}>
          <ProjectCover
            title={project.title}
            coverImage={project.coverImage}
            className="mt-14 aspect-[21/9]"
            priority
          />
        </Reveal>
      </Section>

      <Section id="case-study" containerClassName="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_18rem]">
        <Reveal className="min-w-0">
          <article className="max-w-2xl">
            <MDXRemote
              source={project.content}
              components={mdxComponents}
              options={{
                mdxOptions: {
                  remarkPlugins: [remarkGfm],
                  rehypePlugins: [
                    rehypeSlug,
                    [rehypeAutolinkHeadings, { behavior: "wrap" }],
                    [rehypePrettyCode, { theme: "github-dark-dimmed" }],
                  ],
                },
              }}
            />
          </article>
        </Reveal>

        <Reveal delay={0.1} className="h-fit space-y-6 lg:sticky lg:top-24">
          <GlassCard>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Quick Facts
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">{statusLabel[project.status]}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Year</dt>
                <dd className="font-medium">{project.year}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Role</dt>
                <dd className="text-right font-medium">{project.role}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Platform</dt>
                <dd className="text-right font-medium">{project.platform.join(", ")}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Category</dt>
                <dd className="text-right font-medium">{project.category.join(", ")}</dd>
              </div>
            </dl>
          </GlassCard>

          {toc.length > 0 ? (
            <GlassCard>
              <TableOfContents entries={toc} />
            </GlassCard>
          ) : null}

          {project.metrics && project.metrics.length > 0 ? (
            <GlassCard>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Results
              </p>
              <dl className="mt-4 space-y-4">
                {project.metrics.map((metric) => (
                  <div key={metric.label}>
                    <dt className="text-xs text-muted-foreground">{metric.label}</dt>
                    <dd className="mt-1 font-mono text-2xl font-semibold">{metric.value}</dd>
                  </div>
                ))}
              </dl>
            </GlassCard>
          ) : null}

          <GlassCard>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Tech Stack
            </p>
            <StaggerContainer eager className="mt-4 flex flex-wrap gap-2">
              {project.techStack.map((tech) => (
                <StaggerItem key={tech}>
                  <Badge
                    variant="outline"
                    className="font-mono text-xs font-normal transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {tech}
                  </Badge>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </GlassCard>

          <GlassCard>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Have something similar to build?
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              I&apos;m {site.availability.toLowerCase()}.
            </p>
            <Button asChild className="mt-4 w-full">
              <Link href="/contact">Get in touch</Link>
            </Button>
          </GlassCard>
        </Reveal>
      </Section>

      {/* TODO(v2): project galleries (screenshots/architecture diagrams/demo videos) — see VERSION2_BACKLOG.md.
          Until a project has real gallery media, the whole section is hidden rather than showing an empty state. */}
      {project.gallery && project.gallery.length > 0 ? (
        <Section className="border-t border-border/60">
          <Reveal>
            <p className="text-sm font-medium tracking-wide text-primary uppercase">Gallery</p>
          </Reveal>
          <StaggerContainer className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {project.gallery.map((image, index) => (
              <StaggerItem key={image}>
                <ProjectCover title={project.title} coverImage={image} index={index} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </Section>
      ) : null}

      {nextProject ? (
        <Section className="border-t border-border/60">
          <Reveal>
            <Link href={`/projects/${nextProject.slug}`} className="group block">
              <FloatingCard tiltStrength={3} className="rounded-2xl">
                <GlassCard className="flex flex-col items-start gap-8 p-10 transition-colors group-hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium tracking-wide text-primary uppercase">
                      Next Project
                    </p>
                    <h3 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                      {nextProject.title}
                    </h3>
                    <p className="mt-2 max-w-md text-muted-foreground">{nextProject.tagline}</p>
                  </div>
                  <ArrowUpRight className="size-8 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-primary" />
                </GlassCard>
              </FloatingCard>
            </Link>
          </Reveal>
        </Section>
      ) : null}

      {related.length > 0 ? (
        <Section className="border-t border-border/60">
          <Reveal>
            <p className="text-sm font-medium tracking-wide text-primary uppercase">
              More work
            </p>
          </Reveal>
          <StaggerContainer className="mt-8 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p, index) => (
              <StaggerItem key={p.slug}>
                <ProjectCard project={p} index={index} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </Section>
      ) : null}
    </>
  );
}
