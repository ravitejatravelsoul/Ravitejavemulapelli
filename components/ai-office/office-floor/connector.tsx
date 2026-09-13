import { cn } from "@/lib/utils";

/**
 * A workflow connector between two zones — a vertical line that brightens
 * and gains a small traveling dot exactly when real work is currently
 * flowing into the zone below it. Always present at low opacity
 * (`line-pulse`, shared with the hero) so the office reads as one
 * connected flow even when idle; never a fabricated permanent network of
 * lines.
 */
export function Connector({ active }: { active: boolean }) {
  return (
    <div className="relative flex h-6 justify-center" aria-hidden="true">
      <div className={cn("h-full w-px bg-border line-pulse", active && "w-0.5 bg-primary opacity-90")} />
      {active && <span className="absolute top-0 size-1.5 animate-flow-dot rounded-full bg-primary shadow-[0_0_8px_1px_var(--primary)]" />}
    </div>
  );
}
