import type { Metadata } from "next";
import { Trophy } from "lucide-react";
import { getExperience, getSiteConfig } from "@/lib/data";
import { JsonLd } from "@/components/common/json-ld";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { Reveal } from "@/components/common/reveal";
import { Timeline, TimelineItem } from "@/components/common/timeline";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { FloatingCard } from "@/components/motion/floating-card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { formatDateRange, formatDuration } from "@/lib/format";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Experience",
    description: `The roles and responsibilities that shaped ${site.name}'s engineering career.`,
    alternates: { canonical: "/experience" },
  };
}

export default async function ExperiencePage() {
  const [experience, site] = await Promise.all([getExperience(), getSiteConfig()]);

  return (
    <Section className="pt-20 md:pt-24">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Person",
          name: site.name,
          url: `${site.seo.url}/experience`,
          worksFor: experience.map((entry) => ({
            "@type": "OrganizationRole",
            roleName: entry.role,
            startDate: entry.startDate,
            ...(entry.endDate ? { endDate: entry.endDate } : {}),
            worksFor: { "@type": "Organization", name: entry.company },
          })),
        }}
      />
      <SectionHeading
        as="h1"
        eager
        eyebrow="Experience"
        title="The roles behind the work"
        description="Scope, ownership, and outcomes from each chapter — expand any role for the full detail."
      />

      <div className="mt-16">
        <Timeline>
          {experience.map((entry, index) => (
            <TimelineItem key={entry.id} active={entry.endDate === null}>
              <Reveal eager={index === 0} delay={index * 0.05}>
                <FloatingCard tiltStrength={3} className="relative rounded-2xl">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-6 right-2 hidden font-mono text-7xl font-semibold text-foreground/[0.04] sm:block lg:text-8xl"
                  >
                    {entry.startDate.slice(0, 4).replace(/\D/g, "") || "•"}
                  </span>
                  <GlassCard className="relative transition-colors hover:border-primary/40">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-medium tracking-tight">{entry.role}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {entry.companyUrl ? (
                            <a
                              href={entry.companyUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="transition-colors hover:text-foreground hover:underline"
                            >
                              {entry.company}
                            </a>
                          ) : (
                            entry.company
                          )}{" "}
                          · {entry.location} · {entry.employmentType}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm text-muted-foreground">
                          {formatDateRange(entry.startDate, entry.endDate)}
                        </p>
                        {formatDuration(entry.startDate, entry.endDate) ? (
                          <p className="mt-1 text-xs text-muted-foreground/90">
                            {formatDuration(entry.startDate, entry.endDate)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      {entry.summary}
                    </p>

                    {entry.achievements.length > 0 ? (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {entry.achievements.map((achievement) => (
                          <span
                            key={achievement}
                            className="inline-flex items-start gap-1.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-xs text-foreground/90"
                          >
                            <Trophy className="mt-0.5 size-3 shrink-0 text-primary" />
                            {achievement}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <Accordion type="single" collapsible className="mt-3">
                      <AccordionItem value={entry.id} className="border-none">
                        <AccordionTrigger className="text-sm text-foreground/90 hover:no-underline">
                          Responsibilities
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground marker:text-primary">
                            {entry.responsibilities.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    <StaggerContainer className="mt-5 flex flex-wrap gap-2">
                      {entry.technologies.map((tech) => (
                        <StaggerItem key={tech}>
                          <Badge
                            variant="outline"
                            className="h-auto max-w-full font-mono text-xs font-normal whitespace-normal break-words transition-colors hover:border-primary/50 hover:text-foreground"
                          >
                            {tech}
                          </Badge>
                        </StaggerItem>
                      ))}
                    </StaggerContainer>
                  </GlassCard>
                </FloatingCard>
              </Reveal>
            </TimelineItem>
          ))}
        </Timeline>
      </div>
    </Section>
  );
}
