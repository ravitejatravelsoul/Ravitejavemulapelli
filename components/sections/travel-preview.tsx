import Link from "next/link";
import { ArrowRight, Compass, Globe2 } from "lucide-react";
import { getSiteConfig, getTravelStats } from "@/lib/data";
import { Section } from "@/components/common/section";
import { Reveal } from "@/components/common/reveal";
import { FloatingCard } from "@/components/motion/floating-card";
import { GlassCard } from "@/components/common/glass-card";
import { AnimatedCounter } from "@/components/common/animated-counter";
import { Button } from "@/components/ui/button";

export async function TravelPreview() {
  const [site, stats] = await Promise.all([getSiteConfig(), getTravelStats()]);

  return (
    <Section className="border-t border-border/60">
      <Reveal>
        <FloatingCard tiltStrength={2} className="rounded-2xl">
          <GlassCard className="glass-strong flex flex-col items-start gap-8 p-10 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium tracking-wide text-primary uppercase">
                <Compass className="size-4" /> Off the clock
              </p>
              <h2 className="mt-4 max-w-md text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                Based in {site.location} — mapping where I go next
              </h2>
              <p className="mt-3 max-w-md text-sm text-muted-foreground">
                A running map of everywhere I&apos;ve traveled — I find it easier to sit down and
                focus on hard problems after I&apos;ve actually stepped away from them.
              </p>
              <Button asChild className="mt-6">
                <Link href="/travel">
                  See the map <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>

            <div className="flex gap-8">
              <div className="text-center">
                <Globe2 className="mx-auto size-5 text-primary" />
                <p className="mt-2 font-mono text-3xl font-semibold">
                  <AnimatedCounter value={stats.countriesVisited} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Countries</p>
              </div>
              <div className="text-center">
                <Compass className="mx-auto size-5 text-primary" />
                <p className="mt-2 font-mono text-3xl font-semibold">
                  <AnimatedCounter value={stats.statesVisited} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">States</p>
              </div>
            </div>
          </GlassCard>
        </FloatingCard>
      </Reveal>
    </Section>
  );
}
