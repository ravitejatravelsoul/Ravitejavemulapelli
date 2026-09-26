import type { Metadata } from "next";
import { FileText, ImageIcon, LinkIcon, Video } from "lucide-react";
import { getAchievements, getSiteConfig } from "@/lib/data";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { Reveal } from "@/components/common/reveal";
import { Timeline, TimelineItem } from "@/components/common/timeline";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { FloatingCard } from "@/components/motion/floating-card";
import { formatMonthYear } from "@/lib/format";
import type { AchievementMedia } from "@/lib/data/types";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Achievements",
    description: `Milestones, launches, and recognitions from ${site.name}'s career.`,
    alternates: { canonical: "/achievements" },
  };
}

const mediaIcon: Record<AchievementMedia["type"], React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: Video,
  document: FileText,
  link: LinkIcon,
};

export default async function AchievementsPage() {
  const achievements = await getAchievements();

  return (
    <Section className="pt-20 md:pt-24">
      <SectionHeading
        as="h1"
        eager
        eyebrow="Milestones"
        title="Achievements"
        description="A running record of launches, recognitions, and milestones — the moments that mark real progress."
      />

      <div className="mt-16">
        <Timeline>
          {achievements.map((achievement, index) => (
            <TimelineItem key={achievement.id} active={achievement.milestone}>
              <Reveal eager={index === 0} delay={index * 0.04}>
                <FloatingCard tiltStrength={3} className="rounded-2xl">
                <GlassCard className="transition-colors hover:border-primary/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge variant="secondary">{achievement.category}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatMonthYear(achievement.date)}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-medium">{achievement.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {achievement.description}
                  </p>

                  {achievement.tags.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {achievement.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs font-normal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {achievement.media && achievement.media.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-3">
                      {achievement.media.map((media) => {
                        const Icon = mediaIcon[media.type];
                        return (
                          <a
                            key={media.url}
                            href={media.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Icon className="size-3.5" /> {media.label}
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
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
