"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { DURATION, EASE_OUT, VIEWPORT_ONCE } from "@/components/motion/constants";

interface FadeInProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  /** Animate immediately on mount instead of on scroll-into-view — use for above-the-fold content. */
  eager?: boolean;
}

/** Pure opacity fade — the quietest primitive, for content that shouldn't move. */
export function FadeIn({ children, className, delay = 0, duration = DURATION.base, eager = false }: FadeInProps) {
  const shouldReduceMotion = useReducedMotion();
  const transition = { duration: shouldReduceMotion ? 0.01 : duration, delay, ease: EASE_OUT };

  if (eager) {
    return (
      <motion.div
        className={cn(className)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transition}
        suppressHydrationWarning
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={cn(className)}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={VIEWPORT_ONCE}
      transition={transition}
      suppressHydrationWarning
    >
      {children}
    </motion.div>
  );
}
