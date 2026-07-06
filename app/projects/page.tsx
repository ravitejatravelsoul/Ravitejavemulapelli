import type { Metadata } from "next";
import { getProjects, getSiteConfig } from "@/lib/data";
import { JsonLd } from "@/components/common/json-ld";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { ProjectsExplorer } from "@/components/projects/projects-explorer";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Projects",
    description: `Products and systems built by ${site.name} — ${site.role.toLowerCase()}.`,
    alternates: { canonical: "/projects" },
  };
}

export default async function ProjectsPage() {
  const [projects, site] = await Promise.all([getProjects(), getSiteConfig()]);

  return (
    <Section className="pt-20 md:pt-24">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Projects",
          url: `${site.seo.url}/projects`,
          mainEntity: {
            "@type": "ItemList",
            itemListElement: projects.map((project, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: `${site.seo.url}/projects/${project.slug}`,
              name: project.title,
            })),
          },
        }}
      />
      <SectionHeading
        as="h1"
        eager
        eyebrow="Work"
        title="Every product tells a different story"
        description="Platform and AI work built at Charter Communications, alongside products I shipped on my own time — ten case studies covering the problem, the architecture, the trade-offs, and what shipped, not just a screenshot and a tech list."
      />

      <div className="mt-14">
        <ProjectsExplorer projects={projects} />
      </div>
    </Section>
  );
}
