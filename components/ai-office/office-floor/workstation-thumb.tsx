import { cn } from "@/lib/utils";
import { getWorkstationCropStyle } from "@/lib/ai-office/office-hotspots";

/**
 * A real crop of that role's own region from the approved master office
 * image — used anywhere a small per-role visual is needed (mobile agent
 * list, Agent Room header) so the office → workstation → detail path is
 * always the same real artwork, never a second generated illustration
 * (Section 13/15).
 */
export function WorkstationThumb({ roleId, sizePx, className }: { roleId: string; sizePx: number; className?: string }) {
  const style = getWorkstationCropStyle(roleId, sizePx);
  return (
    <div
      role="img"
      aria-hidden="true"
      className={cn("shrink-0 overflow-hidden rounded-lg bg-black/40", className)}
      style={{ width: sizePx, height: sizePx, ...style }}
    />
  );
}
