import "server-only";
import type { ProjectStatus } from "../domain/projects.ts";
import type { DeliveryState } from "../domain/workspace.ts";

/**
 * Phase 8 Part L — "8/8 READY FOR REVIEW" must never be shown unqualified
 * for a project that only completed a simulated text workflow with no
 * real deliverable. `project.status` itself is untouched (no CHECK
 * constraint widened); this is a purely presentational honesty layer
 * computed from the orthogonal `workspaces.deliveryState` alongside it.
 *
 * - A project with no workspace row at all never attempted real
 *   development — its completion is honest as "WORKFLOW COMPLETE · NO
 *   DELIVERABLE", never an unqualified "READY FOR REVIEW".
 * - A project with a workspace whose deliverable has not (yet) been
 *   verified is, for display purposes, exactly as honest as having no
 *   deliverable at all — real development started but nothing has been
 *   proven to work yet.
 * - Only a workspace whose deliveryState is VERIFIED may show the
 *   project's real terminal status (READY_FOR_REVIEW/APPROVED) as-is.
 * - Every non-terminal status (DRAFT, IN_PROGRESS, BLOCKED, PAUSED, ...)
 *   passes through unchanged — this layer only ever qualifies a
 *   completion claim, never any other status.
 */

const TERMINAL_COMPLETION_STATUSES: ReadonlySet<ProjectStatus> = new Set(["READY_FOR_REVIEW", "APPROVED"]);

export const NO_DELIVERABLE_LABEL = "WORKFLOW COMPLETE · NO DELIVERABLE";

export function getHonestStatusLabel(status: ProjectStatus, hasWorkspace: boolean, deliveryState: DeliveryState | null): string {
  if (!TERMINAL_COMPLETION_STATUSES.has(status)) return status.replace(/_/g, " ");
  if (!hasWorkspace) return NO_DELIVERABLE_LABEL;
  if (deliveryState !== "VERIFIED") return NO_DELIVERABLE_LABEL;
  return status.replace(/_/g, " ");
}

/** True whenever `getHonestStatusLabel` would return the honest fallback rather than the project's real status — lets the UI pick a visually distinct (less celebratory) badge style for it. */
export function isUnverifiedCompletionClaim(status: ProjectStatus, hasWorkspace: boolean, deliveryState: DeliveryState | null): boolean {
  return TERMINAL_COMPLETION_STATUSES.has(status) && (!hasWorkspace || deliveryState !== "VERIFIED");
}

export type PreviewStatusLabel = "PREVIEW READY" | "BUILD FAILED" | "NOT RUNNABLE" | "VERIFYING";

/** Phase 8 Part N — the Preview UI's status line. Never says "ready" without a verified deliverable that actually has an index.html to serve. */
export function getPreviewStatusLabel(hasWorkspace: boolean, deliveryState: DeliveryState | null, hasIndexHtml: boolean): PreviewStatusLabel {
  if (!hasWorkspace || deliveryState === "NOT_STARTED") return "NOT RUNNABLE";
  if (deliveryState === "FAILED") return "BUILD FAILED";
  if (deliveryState === "VERIFIED") return hasIndexHtml ? "PREVIEW READY" : "NOT RUNNABLE";
  return "VERIFYING"; // BUILDING or VERIFYING
}
