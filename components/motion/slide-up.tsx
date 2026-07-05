"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";
import { DURATION, EASE_OUT, VIEWPORT_ONCE } from "@/components/motion/constants";

interface SlideUpProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  /** Animate on mount instead of on scroll-into-view — use for above-the-fold content so it never depends on an IntersectionObserver callback to become visible. */
  eager?: boolean;
}

/**
 * The workhorse entrance primitive — a short fade + small upward drift.
 * Below the fold it triggers on scroll-into-view; `eager` content animates
 * immediately on mount.
 */
export function SlideUp({ children, className, delay = 0, y = 16, eager = false }: SlideUpProps) {
  const shouldReduceMotion = useReducedMotion();

  const variants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : y },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: DURATION.base, delay, ease: EASE_OUT },
    },
  };

  const viewportProps = eager
    ? { initial: "hidden", animate: "visible" }
    : { initial: "hidden", whileInView: "visible", viewport: VIEWPORT_ONCE };

  return (
    <motion.div
      className={cn(className)}
      variants={variants}
      suppressHydrationWarning
      {...viewportProps}
    >
      {children}
    </motion.div>
  );
}
