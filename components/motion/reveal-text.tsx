"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";
import { DURATION, EASE_OUT, VIEWPORT_ONCE } from "@/components/motion/constants";
import { motionTag, type MotionTagName } from "@/components/motion/tags";

interface RevealTextProps {
  text: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
  eager?: boolean;
  as?: MotionTagName;
}

/**
 * Word-by-word cinematic headline reveal. Renders as one element with the
 * words as `inline-block` spans (needed for the per-word transform).
 * Note: do NOT combine with `.text-gradient` — `background-clip: text` on
 * the parent does not reliably clip through `inline-block` children in
 * Chromium, so the gradient silently fails to paint. Use a solid text color
 * here; reach for `GradientText` (no word-splitting) when a gradient is
 * needed on an entrance-animated heading.
 */
export function RevealText({
  text,
  className,
  wordClassName,
  delay = 0,
  eager = false,
  as = "span",
}: RevealTextProps) {
  const shouldReduceMotion = useReducedMotion();
  const words = text.split(" ");

  const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.045, delayChildren: delay } },
  };

  // Deliberately opacity + y only, no `filter`. A `filter` on these inline
  // word spans creates a new compositing context that breaks the parent's
  // `background-clip: text` gradient rendering in Chromium — the whole
  // headline silently disappears when both are combined.
  const word: Variants = {
    hidden: {
      opacity: 0,
      y: shouldReduceMotion ? 0 : "0.4em",
    },
    visible: {
      opacity: 1,
      y: "0em",
      transition: { duration: DURATION.base, ease: EASE_OUT },
    },
  };

  const MotionTag = motionTag[as];
  const viewportProps = eager
    ? { initial: "hidden", animate: "visible" }
    : { initial: "hidden", whileInView: "visible", viewport: VIEWPORT_ONCE };

  return (
    <MotionTag
      className={cn(className)}
      variants={container}
      suppressHydrationWarning
      {...viewportProps}
    >
      {words.map((wordText, index) => (
        <motion.span
          key={`${wordText}-${index}`}
          className={cn("inline-block will-change-transform", wordClassName)}
          variants={word}
          suppressHydrationWarning
        >
          {wordText}
          {index < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </MotionTag>
  );
}
