import type { Metadata } from "next";
import { getSiteConfig, getSkillGroups } from "@/lib/data";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { GlassCard } from "@/components/common/glass-card";
import { SkillLevel } from "@/components/common/skill-level";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { FloatingCard } from "@/components/motion/floating-card";
import { skillGroupIcon } from "@/lib/skill-icons";
import { Layers } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Skills",
    description: `The full technical skill map behind ${site.name}'s work — ${site.role.toLowerCase()}.`,
    alternates: { canonical: "/skills" },
  };
}

export default async function SkillsPage() {
  const groups = await getSkillGroups();

  return (
    <Section className="pt-20 md:pt-24">
      <SectionHeading
        as="h1"
        eager
        eyebrow="Capabilities"
        title="Skill map"
        description="Grouped by domain, with proficiency reflecting hands-on production experience — not just familiarity. Years of experience shown per skill (hover on desktop, listed below each skill on mobile)."
      />

      <StaggerContainer eager className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => {
          const Icon = skillGroupIcon[group.id] ?? Layers;
          return (
          <StaggerItem key={group.id}>
            <FloatingCard tiltStrength={3} className="h-full">
              <GlassCard className="group h-full transition-colors hover:border-primary/40">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-shadow duration-300 group-hover:shadow-[0_0_24px_-4px_var(--primary)]">
                    <Icon className="size-5" />
                  </span>
                  <h2 className="font-medium">{group.category}</h2>
                </div>
                <StaggerContainer className="mt-5 space-y-4" stagger={0.05}>
                  {group.skills.map((skill) => (
                    <StaggerItem key={skill.name}>
                      <div className="group/skill flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-sm text-foreground/90">{skill.name}</span>
                          <span className="relative flex items-center">
                            <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity duration-200 md:inline-block md:group-hover/skill:opacity-100">
                              {skill.yearsExperience ? `${skill.yearsExperience} yrs` : ""}
                            </span>
                            <SkillLevel level={skill.level} />
                          </span>
                        </div>
                        {skill.yearsExperience ? (
                          <span className="font-mono text-[10px] text-muted-foreground md:hidden">
                            {skill.yearsExperience} yrs experience
                          </span>
                        ) : null}
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </GlassCard>
            </FloatingCard>
          </StaggerItem>
          );
        })}
      </StaggerContainer>
    </Section>
  );
}
