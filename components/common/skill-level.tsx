"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { VIEWPORT_ONCE } from "@/components/motion/constants";

export function SkillLevel({ level, className }: { level: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)} aria-hidden>
      {Array.from({ length: 5 }).map((_, index) => (
        <span key={index} className="h-1.5 w-3 overflow-hidden rounded-full bg-border">
          <motion.span
            className={cn("block h-full w-full origin-left rounded-full", "bg-primary")}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: index < level ? 1 : 0 }}
            viewport={VIEWPORT_ONCE}
            transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
          />
        </span>
      ))}
    </div>
  );
}
