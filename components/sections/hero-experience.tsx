"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, MapPin } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import { useSafeReducedMotion } from "@/lib/use-safe-reduced-motion";
import { Container } from "@/components/common/container";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/common/reveal";
import { BlurIn } from "@/components/motion/blur-in";
import { GradientText } from "@/components/common/gradient-text";
import { MagneticButton } from "@/components/motion/magnetic-button";
import { AnimatedCounter } from "@/components/common/animated-counter";
import { DraftBadge } from "@/components/common/placeholder-note";
import { ScrollIndicator } from "@/components/sections/scroll-indicator";
import { HeroBackground } from "@/components/sections/hero-background";
import { HeroVisual } from "@/components/sections/hero-visual";
import { stripPlaceholderPrefix } from "@/lib/placeholder";
import { cn } from "@/lib/utils";

interface HeroExperienceProps {
  displayName: string;
  name: string;
  initials: string;
  role: string;
  location: string;
  yearsExperience: number;
  thesis: string;
  thesisIsDraft: boolean;
  photoUrl: string | null;
  productsShipped: number;
  resumeButton: React.ReactNode;
}

/**
 * Client orchestrator for the hero: a balanced 2-column layout (text /
 * headshot+cards) on large screens, a dedicated simplified stacked layout
 * below `lg`, and a scroll-linked collapse of the whole thing as the hero
 * scrolls out of view. All scroll-driven values are computed once here and
 * passed down as motion values or plain props — `HeroVisual` owns its own
 * idle-float/mouse motion.
 */
export function HeroExperience({
  displayName,
  name,
  initials,
  role,
  location,
  yearsExperience,
  thesis,
  thesisIsDraft,
  photoUrl,
  productsShipped,
  resumeButton,
}: HeroExperienceProps) {
  const shouldReduceMotion = useSafeReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end start"] });

  const textOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 0.7], [0, -28]);
  const visualScale = useTransform(scrollYProgress, [0, 0.8], [1, 0.82]);
  const visualOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0.2]);

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-[calc(100svh-4rem)] items-center overflow-hidden py-10 md:py-12"
    >
      <HeroBackground />
      <div className="grid-pattern grid-fade-mask pointer-events-none absolute inset-0 -z-10" aria-hidden />

      <Container className="relative w-full max-w-[1680px]">
        {/* ---------- Desktop / large-screen 2-column layout ---------- */}
        <div className="hidden lg:grid lg:grid-cols-[minmax(340px,1fr)_clamp(420px,34vw,560px)] lg:items-center lg:gap-12 xl:gap-16">
          <motion.div style={shouldReduceMotion ? undefined : { opacity: textOpacity, y: textY }}>
            <HeroText
              displayName={displayName}
              location={location}
              thesis={thesis}
              thesisIsDraft={thesisIsDraft}
              resumeButton={resumeButton}
              asH1
            />
          </motion.div>

          <motion.div style={shouldReduceMotion ? undefined : { scale: visualScale, opacity: visualOpacity }}>
            <HeroVisual
              initials={initials}
              photoUrl={photoUrl}
              name={name}
              role={role}
              yearsExperience={yearsExperience}
              productsShipped={productsShipped}
            />
          </motion.div>
        </div>

        {/* ---------- Dedicated mobile / tablet hero ---------- */}
        <div className="lg:hidden">
          <div className="flex flex-col items-center text-center">
            <div className="w-full max-w-xl">
              <HeroText
                displayName={displayName}
                location={location}
                thesis={thesis}
                thesisIsDraft={thesisIsDraft}
                resumeButton={resumeButton}
                align="center"
              />
            </div>

            <div className="mt-10">
              <MobileHeadshot initials={initials} photoUrl={photoUrl} name={name} />
            </div>

            <Reveal eager delay={0.75} className="mt-10 w-full max-w-md">
              <div className="grid grid-cols-2 gap-3">
                <MobileStat label="Experience">
                  <AnimatedCounter value={yearsExperience} suffix="+ yrs" />
                </MobileStat>
                <MobileStat label="Products shipped">
                  <AnimatedCounter value={productsShipped} />
                </MobileStat>
              </div>
            </Reveal>
          </div>
        </div>
      </Container>

      <ScrollIndicator />
    </section>
  );
}

function HeroText({
  displayName,
  location,
  thesis,
  thesisIsDraft,
  resumeButton,
  align = "left",
  asH1 = false,
}: {
  displayName: string;
  location: string;
  thesis: string;
  thesisIsDraft: boolean;
  resumeButton: React.ReactNode;
  align?: "left" | "center";
  asH1?: boolean;
}) {
  const centered = align === "center";
  const headingClassName = "text-[clamp(1.5rem,3.2vw,2.25rem)] leading-[1.25] font-semibold tracking-tight text-foreground";
  const headingContent = (
    <>
      <span className="block">Building automation platforms and</span>
      <span className="mt-1 block">
        <GradientText>AI-powered</GradientText> products that ship.
      </span>
    </>
  );
  return (
    <div>
      <Reveal eager>
        <div
          className={cn(
            "glass-strong inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-muted-foreground",
            centered && "justify-center",
          )}
        >
          <span className="relative flex size-2">
            <span className="dot-pulse-ring absolute inline-flex h-full w-full rounded-full bg-primary" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Available for opportunities
        </div>
      </Reveal>

      <Reveal eager delay={0.08}>
        <p className={cn("mt-5 text-lg text-muted-foreground", centered && "text-center")}>Hi, I&apos;m {displayName}.</p>
        <p
          className={cn(
            "mt-1 flex items-center gap-1 text-sm text-muted-foreground/90",
            centered && "justify-center",
          )}
        >
          <MapPin className="size-3.5" /> {location}
        </p>
      </Reveal>

      <div className={cn("mt-4 max-w-3xl", centered && "mx-auto")}>
        <BlurIn eager delay={0.16}>
          {asH1 ? (
            <h1 className={headingClassName}>{headingContent}</h1>
          ) : (
            <p role="heading" aria-level={1} className={headingClassName}>
              {headingContent}
            </p>
          )}
        </BlurIn>
      </div>

      <Reveal eager delay={0.4}>
        <div className={cn("mt-7 max-w-xl", centered && "mx-auto")}>
          {thesisIsDraft ? (
            <>
              <DraftBadge className="mb-3" />
              <p className="text-pretty text-lg text-muted-foreground italic">{stripPlaceholderPrefix(thesis)}</p>
            </>
          ) : (
            <p className="text-pretty text-lg text-muted-foreground">{thesis}</p>
          )}
        </div>
      </Reveal>

      <Reveal eager delay={0.55}>
        <div className={cn("mt-10 flex flex-wrap items-center gap-4", centered && "justify-center")}>
          <MagneticButton>
            <Button asChild size="lg" className="gradient-cta h-12 rounded-xl border-0 px-7 text-base">
              <Link href="/projects">
                View Projects <ArrowUpRight className="size-4" />
              </Link>
            </Button>
          </MagneticButton>
          {resumeButton}
        </div>
      </Reveal>
    </div>
  );
}

function MobileHeadshot({
  initials,
  photoUrl,
  name,
}: {
  initials: string;
  photoUrl: string | null;
  name: string;
}) {
  const shouldReduceMotion = useSafeReducedMotion();
  return (
    <motion.div
      className="relative flex items-center justify-center"
      style={{ width: 176, height: 176 }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: shouldReduceMotion ? 0.01 : 0.9, ease: [0.16, 1, 0.3, 1] }}
      suppressHydrationWarning
    >
      <div
        aria-hidden
        className="breathe-glow absolute size-40 rounded-full blur-2xl"
        style={{
          background: "radial-gradient(circle, color-mix(in oklch, var(--primary) 45%, transparent), transparent 70%)",
        }}
      />
      <div className="glass-strong relative flex size-40 items-center justify-center overflow-hidden rounded-[2rem]">
        <span className="rotating-ring" />
        {photoUrl ? (
          <Image src={photoUrl} alt={`Portrait of ${name}`} fill priority className="object-cover" sizes="160px" />
        ) : (
          <span className="text-gradient font-mono text-4xl font-semibold tracking-tight">{initials}</span>
        )}
      </div>
    </motion.div>
  );
}

function MobileStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="glass-strong rounded-2xl px-4 py-3 text-center">
      <p className="font-mono text-xl font-semibold text-foreground">{children}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
