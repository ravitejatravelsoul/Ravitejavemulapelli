import { OfficeProjectStrip } from "./office-project-strip";
import { OfficeImageScene } from "./office-image-scene";
import type { OfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * The living office — the approved master illustration
 * (public/images/ai-office/living-office.webp) is the visual itself; this
 * component only supplies the compact project strip above it and passes
 * real per-role state down to `OfficeImageScene`, which overlays clickable
 * hotspots and status indicators on top of the artwork. See
 * lib/ai-office/office-hotspots.ts for the single coordinate mapping every
 * hotspot and crop thumbnail in the app reads from. The expanded Agent
 * Workspace itself is mounted once by the page, driven by the same
 * `?agent=` URL selection `OfficeImageScene`'s hotspots write to.
 */
export function OfficeFloor({
  floor,
  officeState = "OPEN",
  recentHandoff = null,
  debugEnabled = false,
}: {
  floor: OfficeFloorView;
  officeState?: "OPEN" | "CLOSED";
  recentHandoff?: { from: string; to: string } | null;
  debugEnabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <OfficeProjectStrip floor={floor} />
      <OfficeImageScene floor={floor} officeState={officeState} recentHandoff={recentHandoff} debugEnabled={debugEnabled} />
    </div>
  );
}
