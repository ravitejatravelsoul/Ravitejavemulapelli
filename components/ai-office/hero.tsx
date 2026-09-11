import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GradientText } from "@/components/common/gradient-text";
import { FadeIn } from "@/components/motion/fade-in";
import { RevealText } from "@/components/motion/reveal-text";
import { MagneticButton } from "@/components/motion/magnetic-button";
import { OfficeConstellation } from "@/components/ai-office/office-constellation";

export function AiOfficeHero() {
  return (
    <div className="relative flex min-h-[85vh] flex-col items-center justify-center overflow-hidden text-center">
      <OfficeConstellation className="opacity-70" />
      <div className="glow-field pointer-events-none absolute inset-0 -z-10" aria-hidden />

      <FadeIn eager>
        <p className="font-mono text-sm font-medium tracking-[0.2em] text-primary uppercase">
          Private · Autonomous · Owner-Operated
        </p>
      </FadeIn>

      <RevealText
        as="h1"
        text="Teja's AI Office"
        eager
        delay={0.1}
        className="mt-6 block text-balance text-[clamp(2.75rem,7vw,5.5rem)] leading-[1.05] font-semibold tracking-tight"
      />

      <FadeIn eager delay={0.5}>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground">
          A <GradientText>private autonomous AI engineering headquarters</GradientText> — where a
          single idea is researched, planned, built, tested, and reviewed by a coordinated team of
          specialized AI agents, before it ever reaches Raviteja Vemulapelli for final approval.
        </p>
      </FadeIn>

      <FadeIn eager delay={0.7}>
        <MagneticButton className="mt-10 block">
          <Button asChild size="lg" className="gradient-cta glow-pulse h-14 rounded-xl border-0 px-8 text-base">
            <Link href="/office">
              Enter AI Office <ArrowRight className="size-4.5" />
            </Link>
          </Button>
        </MagneticButton>
      </FadeIn>
    </div>
  );
}
