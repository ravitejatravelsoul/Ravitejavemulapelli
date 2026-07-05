"use client";

import { motion, useScroll, useSpring } from "motion/react";

/**
 * Thin scroll-linked progress bar for long-form pages (case studies, blog
 * posts). Tracks whole-page scroll progress via `useScroll`, smoothed with
 * a spring — GPU-only (`scaleX` transform), no layout-triggering properties.
 */
export function ReadingProgress() {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 200,
    damping: 40,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-16 right-0 left-0 z-40 h-[2px] origin-left bg-primary"
      style={{ scaleX: progress }}
      suppressHydrationWarning
    />
  );
}
