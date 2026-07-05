"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";

/**
 * Route-level cross-fade + blur + slide, replacing the old per-mount-only
 * `template.tsx` entrance with a real enter/exit transition. Deliberately
 * more pronounced than a typical "fade" so the transition itself reads as
 * a designed moment rather than a flicker — still short enough (450ms in,
 * 250ms out) that it never feels like a loading screen.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{
          opacity: 0,
          y: shouldReduceMotion ? 0 : 24,
          scale: shouldReduceMotion ? 1 : 0.985,
          filter: shouldReduceMotion ? "none" : "blur(10px)",
        }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{
          opacity: 0,
          y: shouldReduceMotion ? 0 : -12,
          filter: shouldReduceMotion ? "none" : "blur(6px)",
          transition: { duration: shouldReduceMotion ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] },
        }}
        transition={{ duration: shouldReduceMotion ? 0.01 : 0.45, ease: [0.22, 1, 0.36, 1] }}
        suppressHydrationWarning
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
