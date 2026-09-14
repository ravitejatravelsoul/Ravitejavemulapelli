import { Bot, KeyRound, ShieldCheck, Users } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { cn } from "@/lib/utils";

/**
 * Conceptual only — no file paths, stack internals, cost figures, or
 * anything from docs/ai-office/08-security-plan.md §12's internal-only
 * list. This is deliberately the shallowest diagram in the whole planning
 * package; an implementer should never lift copy from the internal docs
 * for this section.
 */
const CONCEPTS = [
  {
    icon: Users,
    title: "Specialized Agent Team",
    description: "A roster of focused roles — only the ones a given idea actually needs.",
  },
  {
    icon: Bot,
    title: "Provider-Agnostic AI Layer",
    description: "Not locked to one AI vendor — the office can run on different models over time.",
  },
  {
    icon: ShieldCheck,
    title: "Owner Approval Gate",
    description: "Meaningful decisions wait for Raviteja's review before they go further.",
  },
  {
    icon: KeyRound,
    title: "Owner-Only Access",
    description: "Everything operational sits behind private, authenticated access.",
  },
];

export function ArchitectureOverview() {
  return (
    <div className="flex flex-col items-center gap-6">
      <GlassCard className="glow-pulse w-fit border-primary/30 bg-primary/5 px-8 py-5 text-center">
        <p className="text-sm font-semibold tracking-tight">Orchestrator</p>
        <p className="mt-1 text-xs text-muted-foreground">Interprets the idea and coordinates the office</p>
      </GlassCard>

      <div aria-hidden className="h-8 w-px bg-border" />

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CONCEPTS.map((concept) => {
          const Icon = concept.icon;
          return (
            <GlassCard
              key={concept.title}
              className={cn("flex flex-col items-start gap-3 transition-colors hover:border-primary/40")}
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Icon className="size-4.5" />
              </div>
              <div>
                <p className="text-sm font-medium">{concept.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{concept.description}</p>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
