import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSiteConfig } from "@/lib/data";
import { Section } from "@/components/common/section";
import { Reveal } from "@/components/common/reveal";

export async function AboutTeaser() {
  const site = await getSiteConfig();

  return (
    <Section className="border-y border-border/60">
      <Reveal>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-20">
          <p className="text-sm font-medium tracking-wide text-primary uppercase">
            Why I build
          </p>
          <div>
            <p className="text-balance text-2xl font-medium leading-snug tracking-tight sm:text-3xl">
              {site.storyHook}
            </p>
            <Link
              href="/about"
              className="mt-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Read the full story <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
