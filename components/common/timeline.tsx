"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll } from "motion/react";
import { cn } from "@/lib/utils";

export function Timeline({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.6"],
  });

  return (
    <div ref={ref} className={cn("relative space-y-12 pl-10 md:pl-12", className)}>
      <div aria-hidden className="absolute top-0 bottom-0 left-0 w-px bg-border/70" />
      {/*
        Always rendered (never conditionally, even under reduced-motion) —
        `prefers-reduced-motion` is a client-only signal the server can't
        see, so branching the DOM structure on it causes a hydration
        mismatch. Reduced-motion instead gets a static, fully-drawn line via
        the scaleY value below rather than one tied to scroll.
      */}
      <motion.div
        aria-hidden
        className="absolute top-0 left-0 h-full w-px origin-top bg-primary"
        style={{ scaleY: shouldReduceMotion ? 1 : scrollYProgress }}
        suppressHydrationWarning
      />
      {children}
    </div>
  );
}

export function TimelineItem({
  children,
  className,
  active = false,
}: {
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden
        className={cn(
          "absolute top-1.5 -left-[calc(2.5rem+7px)] h-3 w-3 rounded-full border-2 border-primary md:-left-[calc(3rem+7px)]",
          active ? "bg-primary" : "bg-background",
        )}
      >
        {active ? <span className="dot-pulse-ring absolute inset-0 rounded-full bg-primary" /> : null}
      </span>
      {children}
    </div>
  );
}
