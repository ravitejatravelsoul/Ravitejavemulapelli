"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Ambient glow that follows the cursor within its own bounding box (not the
 * whole viewport — see `CursorGlow` for that). Mutates a CSS custom property
 * directly via a ref instead of React state, so mouse movement never
 * triggers a re-render.
 */
export function MouseSpotlight({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (shouldReduceMotion) return;
    const el = ref.current;
    if (!el) return;

    function handleMove(event: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      el!.style.setProperty("--spot-x", `${x}%`);
      el!.style.setProperty("--spot-y", `${y}%`);
    }

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [shouldReduceMotion]);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn("spotlight pointer-events-none absolute inset-0", className)}
    />
  );
}
