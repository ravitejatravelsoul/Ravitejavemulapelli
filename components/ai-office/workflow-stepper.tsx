import { ArrowRight, BadgeCheck, ClipboardList, Code2, Layers, Lightbulb, Search, ShieldCheck, TestTube2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkflowStep {
  icon: LucideIcon;
  label: string;
}

const STEPS: WorkflowStep[] = [
  { icon: Lightbulb, label: "Idea" },
  { icon: Search, label: "Research" },
  { icon: ClipboardList, label: "Product" },
  { icon: Layers, label: "Architecture" },
  { icon: Code2, label: "Development" },
  { icon: TestTube2, label: "Testing" },
  { icon: ShieldCheck, label: "Security / Review" },
  { icon: BadgeCheck, label: "Owner Approval" },
];

/**
 * The idea-to-approval flow, rendered as a chase of light sweeping through
 * each stage — conveying "the idea is moving through the office" with pure
 * CSS (each node reuses the existing `.glow-pulse` keyframe from
 * globals.css at a staggered delay) rather than a JS animation loop. No
 * "use client" needed here at all; the site-wide reduced-motion rule
 * freezes it automatically.
 */
export function WorkflowStepper() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-8 md:flex-nowrap md:justify-between">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        return (
          <div key={step.label} className="flex items-center">
            <div className="flex flex-col items-center gap-2.5 px-2 text-center">
              <div
                className="glow-pulse flex size-12 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary"
                style={{ animationDelay: `${index * 0.4}s` }}
              >
                <Icon className="size-5" />
              </div>
              <p className="w-20 text-xs font-medium text-muted-foreground">{step.label}</p>
            </div>
            {index < STEPS.length - 1 ? (
              <ArrowRight
                aria-hidden
                className={cn("mx-1 size-4 shrink-0 text-muted-foreground/40", "hidden md:block")}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
