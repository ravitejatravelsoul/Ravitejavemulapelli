"use client";

import { useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { cn } from "@/lib/utils";

interface FloatingCardProps {
  children: React.ReactNode;
  className?: string;
  /** Max tilt in degrees. */
  tiltStrength?: number;
}

/**
 * Premium product-tile hover: a subtle 3D tilt that tracks the cursor, a
 * gentle lift, and a cursor-tracked gradient border glow (see `.card-glow`
 * in globals.css, driven by the --mouse-x/--mouse-y custom properties set
 * here). Inert under reduced-motion — the glow still shows on hover, but
 * without the tilt/lift transform.
 */
export function FloatingCard({ children, className, tiltStrength = 6 }: FloatingCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springRotateX = useSpring(rotateX, { stiffness: 200, damping: 20 });
  const springRotateY = useSpring(rotateY, { stiffness: 200, damping: 20 });

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    ref.current.style.setProperty("--mouse-x", `${px * 100}%`);
    ref.current.style.setProperty("--mouse-y", `${py * 100}%`);

    if (shouldReduceMotion) return;
    rotateY.set((px - 0.5) * tiltStrength);
    rotateX.set(-(py - 0.5) * tiltStrength);
  }

  function handleMouseLeave() {
    rotateX.set(0);
    rotateY.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX: springRotateX,
        rotateY: springRotateY,
        transformPerspective: 800,
      }}
      whileHover={shouldReduceMotion ? undefined : { y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={cn("card-glow", className)}
      suppressHydrationWarning
    >
      {children}
    </motion.div>
  );
}
