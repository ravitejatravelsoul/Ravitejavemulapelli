"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";
import { DURATION, EASE_OUT, VIEWPORT_ONCE } from "@/components/motion/constants";
import { motionTag, type MotionTagName } from "@/components/motion/tags";

interface StaggerContainerProps {
  children: React.ReactNode;
  className?: string;
  /** Delay between each StaggerItem child animating in. */
  stagger?: number;
  delay?: number;
  eager?: boolean;
  as?: MotionTagName;
}

/**
 * Orchestrates a cascading reveal across its direct `StaggerItem` children —
 * use for grids/lists instead of hand-rolling `delay={index * 0.05}` on each
 * card, which doesn't compose and can't be reused.
 */
export function StaggerContainer({
  children,
  className,
  stagger = 0.08,
  delay = 0,
  eager = false,
  as = "div",
}: StaggerContainerProps) {
  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren: delay },
    },
  };

  const viewportProps = eager
    ? { initial: "hidden", animate: "visible" }
    : { initial: "hidden", whileInView: "visible", viewport: VIEWPORT_ONCE };

  const MotionTag = motionTag[as];

  return (
    <MotionTag
      className={cn(className)}
      variants={containerVariants}
      suppressHydrationWarning
      {...viewportProps}
    >
      {children}
    </MotionTag>
  );
}

export function StaggerItem({
  children,
  className,
  y = 16,
}: {
  children: React.ReactNode;
  className?: string;
  y?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : y },
    visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
  };

  return (
    <motion.div className={cn(className)} variants={itemVariants} suppressHydrationWarning>
      {children}
    </motion.div>
  );
}
