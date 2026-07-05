"use client";

import { motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";

/**
 * A thin gradient accent bar that sweeps across the top of the viewport on
 * every route change — the classic Vercel/Linear-style navigation cue. It
 * doesn't track real fetch progress (App Router prefetches most routes, so
 * there's rarely a meaningful "loading" window) — it's a deliberate visual
 * signal that a navigation happened, timed to roughly match PageTransition.
 */
export function RouteProgressBar() {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) return null;

  return (
    <motion.div
      key={pathname}
      className="pointer-events-none fixed top-0 right-0 left-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-primary via-accent-2 to-primary"
      initial={{ scaleX: 0, opacity: 1 }}
      animate={{ scaleX: 1, opacity: 0 }}
      transition={{ scaleX: { duration: 0.5, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.4, delay: 0.3 } }}
      suppressHydrationWarning
    />
  );
}
