import type { Metadata } from "next";
import { BookOpen, Compass, Flag, Globe2, MapPin } from "lucide-react";
import { getSiteConfig, getTravelEntries, getTravelStats } from "@/lib/data";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { GlassCard } from "@/components/common/glass-card";
import { AnimatedCounter } from "@/components/common/animated-counter";
import { BlurIn } from "@/components/motion/blur-in";
import { Reveal } from "@/components/common/reveal";
import { FloatingCard } from "@/components/motion/floating-card";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { Timeline, TimelineItem } from "@/components/common/timeline";
import { UsStatesMap } from "@/components/travel/us-states-map";
import { formatMonthYear } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Travel",
    description: `Places ${site.name} has visited.`,
    alternates: { canonical: "/travel" },
  };
}

export default async function TravelPage() {
  const [entries, stats] = await Promise.all([getTravelEntries(), getTravelStats()]);
  const visited = entries.filter((entry) => entry.visited);
  const visitedStates = visited.flatMap((entry) => entry.states ?? []);

  const timelineEntries = visited
    .flatMap((entry) =>
      (entry.stories ?? []).map((story) => ({ ...story, countryName: entry.countryName })),
    )
    .filter((story) => story.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const statCards = [
    { label: "Countries visited", value: stats.countriesVisited, icon: Flag },
    { label: "Continents", value: stats.continentsVisited, icon: Globe2 },
    { label: "States / regions", value: stats.statesVisited, icon: MapPin },
    { label: "Stories logged", value: stats.citiesVisited, icon: BookOpen },
  ];

  return (
    <Section className="pt-20 md:pt-24">
      <SectionHeading
        as="h1"
        eager
        eyebrow="Off the clock"
        title="Travel"
        description="A state-by-state look at where I've been in the US — kept alongside the work because the two feed each other."
      />

      <StaggerContainer eager className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((stat) => (
          <StaggerItem key={stat.label}>
            <FloatingCard tiltStrength={3}>
              <GlassCard className="text-center transition-colors hover:border-primary/40">
                <stat.icon className="mx-auto size-5 text-primary" />
                <p className="mt-2 font-mono text-3xl font-semibold">
                  <AnimatedCounter value={stat.value} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
              </GlassCard>
            </FloatingCard>
          </StaggerItem>
        ))}
      </StaggerContainer>

      <BlurIn delay={0.1} className="mt-10">
        <UsStatesMap states={visitedStates} />
      </BlurIn>

      {visited.length > 0 ? (
        <StaggerContainer className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visited.map((entry) => (
            <StaggerItem key={entry.countryCode}>
              <FloatingCard tiltStrength={3}>
                <GlassCard className="h-full transition-colors hover:border-primary/40">
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-primary" />
                    <h3 className="font-medium">{entry.countryName}</h3>
                  </div>
                  {entry.notes ? (
                    <p className="mt-2 text-sm text-muted-foreground">{entry.notes}</p>
                  ) : null}
                  {entry.stories && entry.stories.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {entry.stories.map((story) => (
                        <li key={story.title} className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground/90">{story.title}</span>{" "}
                          — {story.excerpt}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </GlassCard>
              </FloatingCard>
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : (
        <BlurIn delay={0.14}>
          <div className="mt-14 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-6 py-16 text-center">
            <Compass className="size-8 text-primary/70" />
            <p className="font-medium text-foreground">The map is ready — the pins aren&apos;t yet.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add visited countries in <code className="font-mono text-xs">content/data/travel.json</code>{" "}
              and they&apos;ll light up here automatically.
            </p>
          </div>
        </BlurIn>
      )}

      {/* TODO(v2): trip timeline — see VERSION2_BACKLOG.md. Hidden entirely until there's at least one
          dated story, rather than showing an empty "no stories yet" state. */}
      {timelineEntries.length > 0 ? (
        <div className="mt-20 border-t border-border/60 pt-16">
          <Reveal>
            <p className="text-sm font-medium tracking-wide text-primary uppercase">
              Travel Timeline
            </p>
            <h2 className="mt-4 max-w-xl text-balance text-3xl font-semibold tracking-tight">
              Trips, in order
            </h2>
          </Reveal>

          <div className="mt-12">
            <Timeline>
              {timelineEntries.map((story, index) => (
                <TimelineItem key={`${story.title}-${index}`} active={index === 0}>
                  <Reveal delay={index * 0.05}>
                    <GlassCard>
                      <p className="font-mono text-xs text-primary">{story.countryName}</p>
                      <h3 className="mt-2 font-medium">{story.title}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">{story.excerpt}</p>
                      <p className="mt-3 text-xs text-muted-foreground/85">
                        {formatMonthYear(story.date)}
                      </p>
                    </GlassCard>
                  </Reveal>
                </TimelineItem>
              ))}
            </Timeline>
          </div>
        </div>
      ) : null}

      {/* TODO(v2): photo gallery — see VERSION2_BACKLOG.md. Hidden entirely until real photos exist,
          rather than showing a "coming soon" placeholder. */}
    </Section>
  );
}
