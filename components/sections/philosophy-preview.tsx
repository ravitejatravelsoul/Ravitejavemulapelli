import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSiteConfig } from "@/lib/data";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { Reveal } from "@/components/common/reveal";
import { FadeIn } from "@/components/motion/fade-in";

/**
 * Large-typography manifesto, not another card grid — this section's whole
 * job is to feel visually distinct from the card-heavy sections around it.
 * Each principle is its own big statement with generous vertical rhythm,
 * revealed one at a time as the page scrolls.
 */
export async function PhilosophyPreview() {
  const site = await getSiteConfig();

  return (
    <Section className="border-t border-border/60">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <SectionHeading
          eyebrow="Engineering Philosophy"
          title="Principles that shape every project"
          description="The same handful of instincts show up whether I'm building an internal platform or a consumer app."
        />
        <FadeIn delay={0.2}>
          <Link
            href="/about"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Read my full story <ArrowRight className="size-4" />
          </Link>
        </FadeIn>
      </div>

      <div className="mt-16 lg:mt-20">
        {site.values.map((value, index) => (
          <Reveal key={value.title} delay={index * 0.08}>
            <div className="flex flex-col gap-4 border-b border-border/50 py-12 first:pt-0 last:border-0 last:pb-0 lg:flex-row lg:items-baseline lg:gap-16 lg:py-14">
              <span className="font-mono text-sm text-primary lg:w-14 lg:shrink-0">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
                  {value.title}
                </h3>
                <p className="mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
                  {value.description}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
