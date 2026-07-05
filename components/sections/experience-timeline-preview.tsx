import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { getAchievements, getExperience } from "@/lib/data";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { Reveal } from "@/components/common/reveal";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { FloatingCard } from "@/components/motion/floating-card";
import { GlassCard } from "@/components/common/glass-card";
import { formatMonthYear } from "@/lib/format";

export async function ExperienceTimelinePreview() {
  const [experience, achievements] = await Promise.all([getExperience(), getAchievements()]);
  const current = experience.find((entry) => entry.endDate === null) ?? experience[0];
  const milestones = achievements.filter((a) => a.milestone).slice(0, 3);

  if (!current) return null;

  return (
    <Section className="border-t border-border/60">
      <SectionHeading
        eyebrow="Experience & Timeline"
        title="Where I am now, and how I got here"
        description="The current role, and a few of the milestones along the way."
      />

      <div className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Reveal>
          <FloatingCard tiltStrength={3} className="h-full">
            <GlassCard className="h-full transition-colors hover:border-primary/40">
              <p className="text-xs font-medium tracking-wide text-primary uppercase">
                Current role
              </p>
              <h3 className="mt-3 text-xl font-medium">{current.role}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {current.company} · {current.location}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {current.summary}
              </p>
              <Link
                href="/experience"
                className="mt-5 inline-flex items-center gap-1 text-sm text-primary transition-colors hover:text-primary/80"
              >
                Full experience <ArrowRight className="size-4" />
              </Link>
            </GlassCard>
          </FloatingCard>
        </Reveal>

        <Reveal delay={0.1}>
          <GlassCard className="h-full">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Recent milestones
            </p>
            <StaggerContainer className="mt-5 space-y-5">
              {milestones.map((milestone) => (
                <StaggerItem key={milestone.id}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                      <Trophy className="size-3.5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground/90">{milestone.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {formatMonthYear(milestone.date)}
                      </p>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
            <Link
              href="/achievements"
              className="mt-6 inline-flex items-center gap-1 text-sm text-primary transition-colors hover:text-primary/80"
            >
              Full timeline <ArrowRight className="size-4" />
            </Link>
          </GlassCard>
        </Reveal>
      </div>
    </Section>
  );
}
