import { OfficeProjectStrip } from "./office-project-strip";
import { OfficeImageScene } from "./office-image-scene";
import type { OfficeFloorView, AgentDetailView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * The living office — the approved master illustration
 * (public/images/ai-office/living-office.webp) is the visual itself; this
 * component only supplies the compact project strip above it and passes
 * real per-role state down to `OfficeImageScene`, which overlays clickable
 * hotspots and status indicators on top of the artwork. See
 * lib/ai-office/office-hotspots.ts for the single coordinate mapping every
 * hotspot and crop thumbnail in the app reads from.
 */
export function OfficeFloor({
  floor,
  agentDetails,
  officeState = "OPEN",
  recentHandoff = null,
  debugEnabled = false,
}: {
  floor: OfficeFloorView;
  agentDetails: Record<string, AgentDetailView>;
  officeState?: "OPEN" | "CLOSED";
  recentHandoff?: { from: string; to: string } | null;
  debugEnabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <OfficeProjectStrip floor={floor} />
      <OfficeImageScene floor={floor} agentDetails={agentDetails} officeState={officeState} recentHandoff={recentHandoff} debugEnabled={debugEnabled} />
    </div>
  );
}
