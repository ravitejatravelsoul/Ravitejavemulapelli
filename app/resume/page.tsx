import type { Metadata } from "next";
import {
  getCertifications,
  getExperience,
  getResume,
  getSiteConfig,
  getSkillGroups,
} from "@/lib/data";
import { JsonLd } from "@/components/common/json-ld";
import { Section } from "@/components/common/section";
import { Reveal } from "@/components/common/reveal";
import { GlassCard } from "@/components/common/glass-card";
import { PrintButton } from "@/components/resume/print-button";
import { ResumeDownloadButton } from "@/components/resume/resume-download-button";
import { FloatingCard } from "@/components/motion/floating-card";
import { PlaceholderNote } from "@/components/common/placeholder-note";
import { isPlaceholder } from "@/lib/placeholder";
import { formatDateRange, formatMonthYear } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Resume",
    description: `Interactive, ATS-friendly resume for ${site.name} — ${site.role}.`,
    alternates: { canonical: "/resume" },
  };
}

export default async function ResumePage() {
  const [site, resume, experience, skillGroups, certifications] = await Promise.all([
    getSiteConfig(),
    getResume(),
    getExperience(),
    getSkillGroups(),
    getCertifications(),
  ]);

  const currentRole = experience.find((entry) => entry.endDate === null) ?? experience[0];

  return (
    <Section className="pt-20 md:pt-24">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Person",
          name: site.name,
          jobTitle: site.role,
          description: resume.summary,
          url: `${site.seo.url}/resume`,
          email: site.email,
          address: site.location,
          ...(currentRole
            ? { worksFor: { "@type": "Organization", name: currentRole.company } }
            : {}),
          ...(resume.education && resume.education.length > 0
            ? {
                alumniOf: resume.education.map((entry) => ({
                  "@type": "EducationalOrganization",
                  name: entry.institution ?? entry.degree,
                })),
              }
            : {}),
        }}
      />
      <Reveal eager>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-sm font-medium tracking-wide text-primary uppercase">Resume</p>
            <h1 className="mt-4 text-[clamp(1.875rem,4vw,2.75rem)] leading-[1.15] font-semibold tracking-tight">
              {site.name}
            </h1>
            <p className="mt-2 text-lg text-muted-foreground">{site.role}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {site.location} · {site.email} · Updated {formatMonthYear(resume.updatedAt)}
            </p>
          </div>
          <div className="flex gap-3 print:hidden">
            <ResumeDownloadButton label="Download PDF" variant="default" magnetic={false} />
            <PrintButton />
          </div>
        </div>
      </Reveal>

      <Reveal eager delay={0.08}>
        <FloatingCard tiltStrength={2} className="mt-10 rounded-2xl">
        <GlassCard className="transition-colors hover:border-primary/40">
          {isPlaceholder(resume.summary) ? (
            <PlaceholderNote text={resume.summary} className="w-full" />
          ) : (
            <p className="leading-relaxed text-muted-foreground">{resume.summary}</p>
          )}
          {resume.highlights.length > 0 ? (
            <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {resume.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-2 text-sm text-foreground/90">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                  {highlight}
                </li>
              ))}
            </ul>
          ) : null}
        </GlassCard>
        </FloatingCard>
      </Reveal>

      <Reveal delay={0.12}>
        <div className="mt-14">
          <h2 className="text-xl font-medium">Experience</h2>
          <div className="mt-6 space-y-8">
            {experience.map((entry) => (
              <div key={entry.id} className="border-b border-border/60 pb-8 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium">
                    {entry.role} · {entry.company}
                  </h3>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDateRange(entry.startDate, entry.endDate)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{entry.summary}</p>
                <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-muted-foreground marker:text-primary">
                  {entry.achievements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.16}>
        <div className="mt-14">
          <h2 className="text-xl font-medium">Skills</h2>
          <div className="mt-6 space-y-3">
            {skillGroups.map((group) => (
              <p key={group.id} className="text-sm">
                <span className="font-medium text-foreground">{group.category}: </span>
                <span className="text-muted-foreground">
                  {group.skills.map((skill) => skill.name).join(", ")}
                </span>
              </p>
            ))}
          </div>
        </div>
      </Reveal>

      {certifications.length > 0 ? (
        <Reveal delay={0.2}>
          <div className="mt-14">
            <h2 className="text-xl font-medium">Certifications</h2>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              {certifications.map((cert) => (
                <li key={cert.id}>
                  {cert.name} — {cert.issuer}
                  {!isPlaceholder(cert.issueDate) ? ` (${formatMonthYear(cert.issueDate)})` : ""}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      ) : null}

      {resume.education && resume.education.length > 0 ? (
        <Reveal delay={0.24}>
          <div className="mt-14 mb-4">
            <h2 className="text-xl font-medium">Education</h2>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              {resume.education.map((entry) => (
                <li key={entry.degree}>
                  {entry.degree}
                  {entry.institution ? ` — ${entry.institution}` : ""}
                  {entry.year ? ` (${entry.year})` : ""}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      ) : null}
    </Section>
  );
}
