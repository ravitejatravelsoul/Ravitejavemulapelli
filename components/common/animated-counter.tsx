"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";

interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}

export function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  duration = 1.4,
  className,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const shouldReduceMotion = useReducedMotion();
  const isMobile = useIsMobileViewport();
  // Always starts at 0 — matches SSR output regardless of the client's
  // `prefers-reduced-motion` setting (a client-only signal the server can't
  // know), so there's nothing to reconcile on hydration. The reduced-motion
  // case still goes through `animate()`, just with duration 0, so the only
  // `setState` call site is inside its `onUpdate` callback.
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    // Mobile skips the IntersectionObserver-gated animation entirely — see
    // `shown` below, which renders `value` directly in that case — so
    // there's nothing for this effect to do on mobile. Between responsive
    // layouts mounting both a desktop and a mobile copy of the same stat
    // (only one visible via CSS at a time), mobile browsers' dynamic
    // viewport height (the collapsing address bar) shifting during scroll,
    // and the `-80px` margin shrinking an already-short mobile viewport,
    // `isInView` was unreliable enough to leave counters permanently stuck
    // at 0 on phones.
    if (isMobile) return;
    if (!isInView) return;
    const controls = animate(0, value, {
      duration: shouldReduceMotion ? 0 : duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => controls.stop();
  }, [isInView, isMobile, value, duration, shouldReduceMotion]);

  // Mobile bypasses the animated state entirely and renders the final value
  // straight away — no dependency on scroll position or resize timing.
  const shown = isMobile ? value : display;

  return (
    <span ref={ref} className={className}>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
}
