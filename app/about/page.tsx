import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Compass, HeartHandshake, Lightbulb, Quote, Radar, Users } from "lucide-react";
import { getSiteConfig } from "@/lib/data";
import { JsonLd } from "@/components/common/json-ld";
import { Section } from "@/components/common/section";
import { Reveal } from "@/components/common/reveal";
import { GlassCard } from "@/components/common/glass-card";
import { GradientText } from "@/components/common/gradient-text";
import { Button } from "@/components/ui/button";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { FloatingCard } from "@/components/motion/floating-card";
import { AnimatedGradient } from "@/components/motion/animated-gradient";
import { Timeline, TimelineItem } from "@/components/common/timeline";
import { SectionDivider } from "@/components/motion/section-divider";
import { DraftBadge } from "@/components/common/placeholder-note";
import { isPlaceholder, stripPlaceholderPrefix } from "@/lib/placeholder";
import { cn } from "@/lib/utils";

const PERSONAL_VALUES = [
  {
    title: "Consistency over intensity",
    description:
      "Showing up and shipping something every week beats a burst of effort followed by burnout. I'd rather build for ten years than sprint for two.",
  },
  {
    title: "Say the honest thing",
    description:
      "A tool that hides its limits does more damage than one that says \"I don't know.\" The same goes for status updates.",
  },
  {
    title: "Write down what didn't work too",
    description:
      "The failed first attempt teaches me more than the version that shipped. Writing about both, not just the polished result, is how I actually understand what I built.",
  },
  {
    title: "Curiosity compounds",
    description:
      "The tools I use today didn't exist when I started automating tests by hand. Staying curious about what's next is what keeps the work interesting.",
  },
];

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "About",
    description: site.storyHook,
    alternates: { canonical: "/about" },
  };
}

export default async function AboutPage() {
  const site = await getSiteConfig();
  const hookIsDraft = isPlaceholder(site.storyHook);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: `About ${site.name}`,
          url: `${site.seo.url}/about`,
          mainEntity: {
            "@type": "Person",
            name: site.name,
            jobTitle: site.role,
            description: site.storyHook,
            url: site.seo.url,
          },
        }}
      />
      <Section className="relative overflow-hidden pt-20 pb-16 md:pt-24">
        <AnimatedGradient />
        <div className="grid-pattern grid-fade-mask pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <Reveal eager>
          <p className="text-sm font-medium tracking-wide text-primary uppercase">About</p>
          <div className="relative mt-6 max-w-3xl">
            <Quote className="absolute -top-6 -left-2 size-10 text-primary/25" aria-hidden />
            {hookIsDraft ? (
              <>
                <DraftBadge className="mb-4" />
                <p className="pl-2 text-pretty text-2xl leading-snug font-medium text-muted-foreground italic sm:text-3xl">
                  {stripPlaceholderPrefix(site.storyHook)}
                </p>
              </>
            ) : (
              <h1 className="pl-2 text-balance text-[clamp(1.875rem,4.5vw,3rem)] leading-[1.2] font-semibold tracking-tight">
                <GradientText>{site.storyHook}</GradientText>
              </h1>
            )}
          </div>
        </Reveal>
      </Section>

      <Section className="pt-0">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_18rem]">
          <StaggerContainer className="max-w-2xl" stagger={0.12}>
            <Timeline>
              {site.story.map((paragraph, index) => (
                <TimelineItem key={index} active={index === site.story.length - 1}>
                  <StaggerItem>
                    <FloatingCard tiltStrength={2}>
                      <GlassCard className="transition-colors hover:border-primary/40">
                        <span className="font-mono text-xs text-primary">
                          Chapter {String(index + 1).padStart(2, "0")}
                        </span>
                        <p
                          className={cn(
                            "mt-3 text-pretty text-lg leading-relaxed text-muted-foreground",
                            isPlaceholder(paragraph) && "italic",
                          )}
                        >
                          {stripPlaceholderPrefix(paragraph)}
                        </p>
                      </GlassCard>
                    </FloatingCard>
                  </StaggerItem>
                </TimelineItem>
              ))}
            </Timeline>
          </StaggerContainer>

          <Reveal delay={0.1} className="h-fit space-y-6 lg:sticky lg:top-24">
            <GlassCard>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Quick facts
              </p>
              <dl className="mt-4 space-y-4 text-sm">
                {site.preferredName ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Goes by</dt>
                    <dd className="mt-1 font-medium">{site.preferredName}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-muted-foreground">Role</dt>
                  <dd className="mt-1 font-medium">{site.role}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Location</dt>
                  <dd className="mt-1 font-medium">{site.location}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Focus</dt>
                  <dd className="mt-1 font-medium">{site.currentFocus}</dd>
                </div>
              </dl>
            </GlassCard>

            <Button asChild className="gradient-cta w-full border-0">
              <Link href="/contact">
                Get in touch <ArrowUpRight className="size-4" />
              </Link>
            </Button>
          </Reveal>
        </div>
      </Section>

      <SectionDivider className="my-4" />

      <Section className="border-t border-border/60">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">
          Career philosophy
        </p>
        <h2 className="mt-4 max-w-xl text-balance text-3xl font-semibold tracking-tight">
          Principles that shape every project
        </h2>

        <StaggerContainer className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {site.values.map((value, index) => (
            <StaggerItem key={value.title}>
              <FloatingCard tiltStrength={4} className="h-full">
                <GlassCard className="relative h-full overflow-hidden transition-colors hover:border-primary/40">
                  <Quote
                    className="absolute -top-3 -right-3 size-16 text-primary/[0.06]"
                    aria-hidden
                  />
                  <span className="relative font-mono text-sm text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="relative mt-4 text-lg font-medium">{value.title}</h3>
                  <p className="relative mt-2 text-sm text-muted-foreground">
                    {value.description}
                  </p>
                </GlassCard>
              </FloatingCard>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </Section>

      <Section className="border-t border-border/60">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:gap-24">
          <Reveal>
            <div className="flex items-center gap-2 text-primary">
              <Lightbulb className="size-4" />
              <p className="text-sm font-medium tracking-wide uppercase">How I Think</p>
            </div>
            <p className="mt-5 text-pretty text-2xl leading-snug font-medium tracking-tight sm:text-3xl">
              I don&apos;t start with the tech stack — I start with where trust breaks down.
            </p>
            <p className="mt-5 max-w-md text-pretty text-muted-foreground">
              Most automation failures aren&apos;t technical. They&apos;re a team that doesn&apos;t
              trust the output enough to act on it without double-checking by hand — which means
              the automation just added a second job instead of removing one. So before I write a
              line of code, I&apos;m asking what&apos;s the smallest thing I can ship that someone
              will actually rely on. Architecture, scale, and polish come after that trust is
              earned, not before.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="flex items-center gap-2 text-primary">
              <HeartHandshake className="size-4" />
              <p className="text-sm font-medium tracking-wide uppercase">Why Automation</p>
            </div>
            <p className="mt-5 text-pretty text-2xl leading-snug font-medium tracking-tight sm:text-3xl">
              Automation is most valuable when it helps people move faster without sacrificing
              quality.
            </p>
            <p className="mt-5 max-w-md text-pretty text-muted-foreground">
              It&apos;s not about replacing judgment — it&apos;s about giving people their attention
              back. Every hour a good engineer spends re-running a manual check by hand is an hour
              they&apos;re not spending on the problem that actually needed a person. That&apos;s
              the trade I&apos;m always making: move the repeatable part to a system, and leave the
              judgment calls to the humans who are good at them.
            </p>
          </Reveal>
        </div>
      </Section>

      <Section className="border-t border-border/60">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[16rem_1fr]">
          <Reveal>
            <div className="flex items-center gap-2 text-primary">
              <Users className="size-4" />
              <p className="text-sm font-medium tracking-wide uppercase">Leadership</p>
            </div>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight">
              Adoption is the job, not the code
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Leading automation strategy at Charter Communications taught me that the technical
              design is rarely the hard part — getting a team to change how they work is. I set the
              tooling standards, but the work that actually matters is mentoring: sitting with an
              engineer while they debug a flaky test, explaining why a pattern will bite them at
              scale before it does, and building enough trust that people bring me problems early
              instead of after they&apos;ve shipped. The platforms I&apos;ve built are only as
              useful as the teams that adopted them — and that adoption is a leadership problem,
              not an engineering one. I&apos;d rather spend an afternoon unblocking someone than
              add another line to my own commit history.
            </p>
          </Reveal>
        </div>
      </Section>

      <Section className="border-t border-border/60">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">Personal values</p>
        <h2 className="mt-4 max-w-xl text-balance text-3xl font-semibold tracking-tight">
          What I optimize for outside of work output
        </h2>

        <StaggerContainer className="mt-12 grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2">
          {PERSONAL_VALUES.map((value, index) => (
            <StaggerItem key={value.title}>
              <div className="flex gap-5 border-b border-border/50 pb-8">
                <span className="font-mono text-sm text-primary">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-lg font-medium">{value.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{value.description}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </Section>

      <Section className="border-t border-border/60">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:gap-24">
          <Reveal>
            <div className="flex items-center gap-2 text-primary">
              <Radar className="size-4" />
              <p className="text-sm font-medium tracking-wide uppercase">Current Focus</p>
            </div>
            <p className="mt-5 text-pretty text-xl leading-relaxed text-muted-foreground">
              Right now, that means: {site.currentFocus}
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="flex items-center gap-2 text-primary">
              <Compass className="size-4" />
              <p className="text-sm font-medium tracking-wide uppercase">What I&apos;m Exploring</p>
            </div>
            <p className="mt-5 text-pretty text-xl leading-relaxed text-muted-foreground">
              Going deeper on retrieval-grounded AI for quality engineering — making a tool&apos;s
              answer trustworthy enough that engineers rely on it the way they&apos;d rely on a
              colleague. I&apos;m also curious where agentic workflows fit into release
              engineering — not replacing the pipeline, but reasoning about it. Long term, I want
              to keep building at the intersection of automation platforms and AI product work,
              rather than picking one lane.
            </p>
          </Reveal>
        </div>
      </Section>

      <Section className="relative overflow-hidden border-t border-border/60 text-center">
        <AnimatedGradient />
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-primary uppercase">
            Looking ahead
          </p>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-2xl leading-snug font-medium tracking-tight sm:text-3xl">
            {site.availability}. {site.currentFocus} That&apos;s the work I want more of.
          </p>
          <Button asChild size="lg" className="gradient-cta mt-8 h-12 rounded-xl border-0 px-7 text-base">
            <Link href="/contact">
              Let&apos;s talk <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </Reveal>
      </Section>
    </>
  );
}
