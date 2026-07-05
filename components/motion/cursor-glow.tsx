"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

/**
 * A soft glow that trails the cursor — desktop pointer devices only, never
 * under reduced-motion. Deliberately does NOT hide or replace the native
 * cursor (that's a usability regression, especially for anyone relying on
 * OS cursor size/contrast settings) and is `pointer-events-none` so it can
 * never block a click.
 *
 * Always renders (no client-only conditional state, to avoid a
 * setState-in-effect / hydration footgun) — on touch devices or under
 * reduced-motion the listener is simply never attached, so it stays parked
 * off-screen at its initial position and is effectively inert.
 */
export function CursorGlow() {
  const shouldReduceMotion = useReducedMotion();
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const springX = useSpring(x, { stiffness: 120, damping: 20, mass: 0.6 });
  const springY = useSpring(y, { stiffness: 120, damping: 20, mass: 0.6 });

  useEffect(() => {
    if (shouldReduceMotion) return;
    const isFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (!isFinePointer) return;

    function handleMove(event: MouseEvent) {
      x.set(event.clientX);
      y.set(event.clientY);
    }
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [shouldReduceMotion, x, y]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-30 size-[420px] rounded-full mix-blend-screen"
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
