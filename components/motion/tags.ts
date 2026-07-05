import { motion } from "motion/react";

/**
 * Static registry of motion-wrapped tags. `motion.create(tag)` must not be
 * called during render (it constructs a new component type on every render,
 * which resets internal state and trips the `react-hooks/static-components`
 * rule) — so every tag a primitive might render as needs to be predeclared
 * here at module scope instead.
 */
export const motionTag = {
  div: motion.div,
  span: motion.span,
  p: motion.p,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  ul: motion.ul,
} as const;

export type MotionTagName = keyof typeof motionTag;
