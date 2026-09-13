import type { CSSProperties } from "react";

/**
 * The single source of truth mapping each of the 11 real AI Office roles to
 * a region of the approved master office image
 * (public/images/ai-office/living-office.webp, 1672x941). Coordinates are
 * percentages of the image's own box, not fixed pixels, so hotspots stay
 * aligned however the image is scaled responsively. Regenerate these by
 * running the office image through a grid overlay (see
 * docs/ai-office if ever re-mapped) rather than guessing — they were
 * measured directly against the approved artwork.
 */

export const OFFICE_IMAGE_WIDTH = 1672;
export const OFFICE_IMAGE_HEIGHT = 941;

export interface OfficeHotspot {
  /** Pixel box against the master image's native 1672x941 resolution. */
  px: { x: number; y: number; width: number; height: number };
}

export const OFFICE_HOTSPOTS: Record<string, OfficeHotspot> = {
  orchestrator: { px: { x: 620, y: 60, width: 430, height: 350 } },
  "product-owner": { px: { x: 60, y: 60, width: 280, height: 300 } },
  "research-agent": { px: { x: 10, y: 290, width: 330, height: 220 } },
  "solution-architect": { px: { x: 370, y: 130, width: 280, height: 280 } },
  "ui-ux-agent": { px: { x: 1030, y: 120, width: 260, height: 270 } },
  "frontend-developer": { px: { x: 440, y: 440, width: 400, height: 270 } },
  "backend-developer": { px: { x: 830, y: 430, width: 400, height: 270 } },
  "qa-agent": { px: { x: 1330, y: 180, width: 300, height: 200 } },
  "security-reviewer": { px: { x: 1290, y: 340, width: 380, height: 220 } },
  "code-reviewer": { px: { x: 10, y: 560, width: 400, height: 280 } },
  "release-agent": { px: { x: 1230, y: 560, width: 410, height: 280 } },
};

export interface HotspotPercent {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function getHotspotPercent(roleId: string): HotspotPercent | null {
  const spot = OFFICE_HOTSPOTS[roleId];
  if (!spot) return null;
  return {
    left: (spot.px.x / OFFICE_IMAGE_WIDTH) * 100,
    top: (spot.px.y / OFFICE_IMAGE_HEIGHT) * 100,
    width: (spot.px.width / OFFICE_IMAGE_WIDTH) * 100,
    height: (spot.px.height / OFFICE_IMAGE_HEIGHT) * 100,
  };
}

/**
 * A CSS `background-*` recipe that crops a small, zoomed-in thumbnail of one
 * role's real region out of the SAME master image — used by the Agent Room
 * header and the mobile agent list so continuity holds ("I clicked this
 * workstation, now I'm inspecting it") without ever generating a second,
 * fake illustration.
 */
export function getWorkstationCropStyle(roleId: string, thumbPx: number): CSSProperties | undefined {
  const spot = OFFICE_HOTSPOTS[roleId];
  if (!spot) return undefined;
  const cropWidth = spot.px.width * 0.72;
  const zoom = thumbPx / cropWidth;
  const centerX = spot.px.x + spot.px.width / 2;
  const centerY = spot.px.y + spot.px.height * 0.38;
  const bgWidth = OFFICE_IMAGE_WIDTH * zoom;
  const bgHeight = OFFICE_IMAGE_HEIGHT * zoom;
  const posX = -(centerX * zoom - thumbPx / 2);
  const posY = -(centerY * zoom - thumbPx / 2);
  return {
    backgroundImage: "url(/images/ai-office/living-office.webp)",
    backgroundSize: `${bgWidth}px ${bgHeight}px`,
    backgroundPosition: `${posX}px ${posY}px`,
    backgroundRepeat: "no-repeat",
  };
}
