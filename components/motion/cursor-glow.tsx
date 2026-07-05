"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

/**
 * A soft glow that trails the cursor — desktop pointer devices only, never
 * under reduced-motion, dark mode only (`mix-blend-screen` paints ~nothing
 * against a light background, so in light mode it would just be a wasted
 * mousemove listener and spring animation). Deliberately does NOT hide or
 * replace the native cursor (that's a usability regression, especially for
 * anyone relying on OS cursor size/contrast settings) and is
 * `pointer-events-none` so it can never block a click.
 *
 * Always renders (no client-only conditional state, to avoid a
 * setState-in-effect / hydration footgun) — on touch devices, under
 * reduced-motion, or in light mode the listener is simply never attached
 * (and `dark:block hidden` skips the paint), so it's effectively inert.
 */
export function CursorGlow() {
  const shouldReduceMotion = useReducedMotion();
  const { resolvedTheme } = useTheme();
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const springX = useSpring(x, { stiffness: 120, damping: 20, mass: 0.6 });
  const springY = useSpring(y, { stiffness: 120, damping: 20, mass: 0.6 });

  useEffect(() => {
    if (shouldReduceMotion) return;
    if (resolvedTheme !== "dark") return;
    const isFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (!isFinePointer) return;

    function handleMove(event: MouseEvent) {
      x.set(event.clientX);
      y.set(event.clientY);
    }
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [shouldReduceMotion, resolvedTheme, x, y]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-30 hidden size-[420px] rounded-full mix-blend-screen dark:block"
      style={{
        x: springX,
        y: springY,
        translateX: "-50%",
        translateY: "-50%",
        background:
          "radial-gradient(circle, color-mix(in oklch, var(--primary) 16%, transparent) 0%, transparent 70%)",
      }}
    />
  );
}
