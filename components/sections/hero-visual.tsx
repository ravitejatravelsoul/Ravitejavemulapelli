"use client";

import Image from "next/image";
import { Atom, BrainCircuit, Braces, Briefcase, Camera, FlaskConical, Terminal, Webhook, Workflow } from "lucide-react";
import { AnimatedCounter } from "@/components/common/animated-counter";
import { Reveal } from "@/components/common/reveal";
import { FloatingCard } from "@/components/motion/floating-card";
import { TechOrbit, type OrbitNode } from "@/components/sections/tech-orbit";

const ORBIT_NODES: OrbitNode[] = [
  { icon: Atom, label: "React" },
  { icon: Braces, label: "TypeScript" },
  { icon: Terminal, label: "Python" },
  { icon: BrainCircuit, label: "AI" },
  { icon: Webhook, label: "API" },
  { icon: Workflow, label: "Automation" },
  { icon: FlaskConical, label: "Testing" },
];

/** Fixed reference frame the orbit's node math is computed against; the whole ring is then uniformly CSS-scaled to fit the fluid container (see `orbitScale` below). */
const ORBIT_REF = 400;

interface HeroVisualProps {
  initials: string;
  photoUrl?: string | null;
  name?: string;
  role: string;
  yearsExperience: number;
  productsShipped: number;
}

interface MiniCardConfig {
  style: React.CSSProperties;
  duration: number;
  delay: number;
  hideBelowXl?: boolean;
  content: React.ReactNode;
}

function MiniCard({ config, revealDelay }: { config: MiniCardConfig; revealDelay: number }) {
  return (
    <div
      className={`absolute z-20 ${config.hideBelowXl ? "hidden xl:block" : ""}`}
      style={config.style}
    >
      <Reveal eager delay={revealDelay}>
        <div
          className="widget-float"
          style={{
            ["--widget-duration" as string]: `${config.duration}s`,
            ["--widget-delay" as string]: `${config.delay}s`,
            ["--widget-x" as string]: "0px",
            ["--widget-y" as string]: "-8px",
          }}
        >
          <div className="glow-pulse glass-strong flex max-w-[125px] items-center gap-2 rounded-2xl px-3 py-2.5">
            {config.content}
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/**
 * The hero's visual anchor: a large, prominent headshot (glass frame,
 * gradient ring, ambient glow, slight idle float) surrounded by a slow
 * rotating tech-icon orbit, with four status cards pushed fully outside the
 * headshot's own bounding box on at least one axis — so no matter the
 * viewport width, a card can never overlap the portrait, only the ambient
 * orbit ring around it.
 */
export function HeroVisual({ initials, photoUrl, name, role, yearsExperience, productsShipped }: HeroVisualProps) {
  const cards: MiniCardConfig[] = [
    {
      style: { top: "2%", left: "-15%" },
      duration: 10,
      delay: 0,
      content: (
        <>
          <span className="relative flex size-2.5 shrink-0">
            <span className="dot-pulse-ring absolute inline-flex h-full w-full rounded-full bg-primary" />
            <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
          </span>
          <p className="text-xs font-medium text-pretty text-foreground">Available for opportunities</p>
        </>
      ),
    },
    {
      style: { top: "2%", right: "-15%" },
      duration: 13,
      delay: 1.4,
      content: (
        <>
          <Briefcase className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="text-xs font-medium text-foreground">Current role</p>
            <p className="mt-0.5 text-pretty text-[11px] text-muted-foreground">{role}</p>
          </div>
        </>
      ),
    },
    {
      style: { bottom: "2%", left: "-15%" },
      duration: 16,
      delay: 0.8,
      hideBelowXl: true,
      content: (
        <div>
          <p className="font-mono text-lg font-semibold text-foreground">
            <AnimatedCounter value={yearsExperience} suffix="+" />
          </p>
          <p className="text-[10px] whitespace-nowrap text-muted-foreground">years experience</p>
        </div>
      ),
    },
    {
      style: { bottom: "2%", right: "-15%" },
      duration: 11,
      delay: 2.2,
      hideBelowXl: true,
      content: (
        <div>
          <p className="font-mono text-lg font-semibold text-foreground">
            <AnimatedCounter value={productsShipped} />
          </p>
          <p className="text-[10px] whitespace-nowrap text-muted-foreground">products shipped</p>
        </div>
      ),
    },
  ];

  const boxSize = "clamp(380px, min(33vw, 47svh), 500px)";
  // ~7% larger than the previous 0.56 factor, within the requested 5-8% bump.
  const headshotSize = `calc(${boxSize} * 0.6)`;
  // Kept proportional to boxSize (no fixed-px addition) so the ring never grows
  // disproportionately large at the smaller end of the fluid range — verified visually
  // to clear the headshot's corners with a comfortable margin at every container size.
  const orbitSize = `calc(${boxSize} * 0.9)`;

  return (
    <div
      className="relative mx-auto hidden lg:flex lg:items-center lg:justify-center"
      style={{ width: boxSize, height: boxSize }}
    >
      {/* Ambient breathing glow behind the headshot */}
      <div
        aria-hidden
        className="breathe-glow absolute inset-[10%] z-0 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklch, var(--primary) 45%, transparent), transparent 70%)",
        }}
      />

      {/* Slow-rotating tech orbit — sized at a fixed reference for its node math, then uniformly scaled to fit the fluid container so it always sits just outside the headshot frame */}
      <div
        className="absolute top-1/2 left-1/2 z-[1]"
        style={{
          width: ORBIT_REF,
          height: ORBIT_REF,
          transform: `translate(-50%, -50%) scale(calc(${orbitSize} / ${ORBIT_REF}px))`,
        }}
      >
        <TechOrbit nodes={ORBIT_NODES} size={ORBIT_REF} className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>

      {/* Headshot core — gradient ring via the padding-trick (a plain conic-gradient background showing through 2px of padding), more reliable across browsers than a mask-composite ring */}
      <div
        className="widget-float relative z-[2] rounded-[2.5rem] p-[2px]"
        style={{
          width: headshotSize,
          height: headshotSize,
          background:
            "conic-gradient(from 0deg, color-mix(in oklch, var(--primary) 70%, transparent), color-mix(in oklch, var(--accent-2) 65%, transparent), color-mix(in oklch, var(--primary) 70%, transparent))",
          ["--widget-duration" as string]: "7s",
          ["--widget-x" as string]: "0px",
          ["--widget-y" as string]: "-10px",
        }}
      >
        <FloatingCard tiltStrength={4} className="size-full rounded-[calc(2.5rem-2px)]">
          <div className="glass-strong relative flex size-full items-center justify-center overflow-hidden rounded-[calc(2.5rem-2px)]">
            {photoUrl ? (
              <>
                <Image
                  src={photoUrl}
                  alt={name ? `Portrait of ${name}` : "Portrait"}
                  fill
                  priority
                  className="object-cover"
                  sizes="(min-width: 1024px) 20vw, 300px"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(135deg, color-mix(in oklch, var(--foreground) 14%, transparent) 0%, transparent 45%)",
                  }}
                />
              </>
            ) : (
              <>
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 50% 15%, color-mix(in oklch, var(--primary) 30%, transparent), transparent 65%)",
                  }}
                />
                <span className="text-gradient relative font-mono text-4xl font-semibold tracking-tight">
                  {initials}
                </span>
                <div className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-full border border-dashed border-primary/40 bg-primary/[0.08] px-2 py-1 font-mono text-[9px] font-medium tracking-wide text-primary/80 uppercase">
                  <Camera className="size-3" />
                  Add portrait
                </div>
              </>
            )}
          </div>
        </FloatingCard>
      </div>

      {cards.map((card, index) => (
        <MiniCard key={index} config={card} revealDelay={0.9 + index * 0.12} />
      ))}
    </div>
  );
}
