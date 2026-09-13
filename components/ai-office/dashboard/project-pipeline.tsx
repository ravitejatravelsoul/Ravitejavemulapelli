import { cn } from "@/lib/utils";
import type { PipelineStageView } from "@/lib/ai-office/dashboard/project-detail-data";

const STATE_STYLES: Record<PipelineStageView["state"], string> = {
  COMPLETE: "border-accent-2/60 bg-accent-2/10 text-accent-2",
  ACTIVE: "border-primary/60 bg-primary/10 text-primary animate-pulse",
  BLOCKED: "border-destructive/60 bg-destructive/10 text-destructive",
  PENDING: "border-border text-muted-foreground",
  SKIPPED: "border-border/40 text-muted-foreground/50",
};

/**
 * A compact horizontal pipeline (Section 13) — IDEA through RELEASE.
 * A stage the Orchestrator legitimately didn't select any role for
 * (e.g. Design on a project with no UI/UX task) reads SKIPPED, never as
 * an incomplete step — a simple project must never look broken merely
 * because unnecessary agents weren't chosen.
 */
export function ProjectPipeline({ stages }: { stages: PipelineStageView[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Project pipeline">
      {stages.map((stage, i) => (
        <li key={stage.key} className="flex items-center gap-1.5">
          <div
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-xl border px-2.5 py-1.5 text-center transition-colors",
              STATE_STYLES[stage.state],
            )}
          >
            <span className="text-[0.7rem] font-medium whitespace-nowrap">{stage.label}</span>
            <span className="font-mono text-[0.55rem] tracking-widest uppercase">{stage.state}</span>
          </div>
          {i < stages.length - 1 && <span className="text-muted-foreground/40" aria-hidden="true">→</span>}
        </li>
      ))}
    </ol>
  );
}
