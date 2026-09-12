import { cn } from "@/lib/utils";

/**
 * A workflow connector between two department rows — deliberately not an
 * SVG bezier network (that math breaks the moment a responsive grid
 * reflows); a simple centered tick that brightens/quickens exactly when
 * real work is currently flowing into the department below it. Always
 * present at low opacity (`line-pulse`, already defined for the hero) so
 * the office reads as one connected flow even when idle.
 */
export function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center py-0.5" aria-hidden="true">
      <div className={cn("h-4 w-px bg-border line-pulse", active && "w-0.5 bg-primary opacity-80")} />
    </div>
  );
}
