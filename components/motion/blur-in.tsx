"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { DURATION, EASE_OUT, VIEWPORT_ONCE } from "@/components/motion/constants";

interface BlurInProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  eager?: boolean;
  blur?: number;
}

/** Opacity + blur — reserved for headline-weight moments, used sparingly. */
export function BlurIn({
  children,
  className,
  delay = 0,
  duration = DURATION.slow,
  eager = false,
  blur = 10,
}: BlurInProps) {
  const shouldReduceMotion = useReducedMotion();
  const hidden = { opacity: 0, filter: shouldReduceMotion ? "none" : `blur(${blur}px)` };
  const visible = { opacity: 1, filter: "blur(0px)" };
  const transition = { duration: shouldReduceMotion ? 0.01 : duration, delay, ease: EASE_OUT };

  if (eager) {
    return (
      <motion.div
        className={cn(className)}
        initial={hidden}
        animate={visible}
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
      initial={hidden}
      whileInView={visible}
      viewport={VIEWPORT_ONCE}
      transition={transition}
      suppressHydrationWarning
    >
      {children}
    </motion.div>
  );
}
