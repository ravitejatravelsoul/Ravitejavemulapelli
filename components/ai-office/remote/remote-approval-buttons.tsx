"use client";

import { ActionButton } from "@/components/ai-office/action-button";
import { approveRemoteApprovalAction, rejectRemoteApprovalAction } from "@/app/office/actions/remote-approvals";

/**
 * Wraps ActionButton with a hard `window.location.reload()` after a
 * successful decision — caught by real, repeated testing, not inferred:
 * the server action's own `revalidatePath("/office")` decides correctly
 * every time (confirmed by re-reading the committed bundle directly),
 * and a genuinely fresh navigation to this same URL always shows the
 * updated state, but neither `revalidatePath` alone nor an added
 * `router.refresh()` reliably busts every caching layer between here and
 * the server for an in-place client refresh in this specific shape
 * (`layout.tsx` -> RemoteOfficeShell -> RemoteOfficeShellClient's
 * props) — one more hop than the local dashboard's equivalent buttons,
 * which stay inside ordinary Server Component children and refresh
 * correctly via `revalidatePath` alone. Rather than keep guessing at
 * which specific Next.js cache is holding on, `window.location.reload()`
 * is the one thing empirically proven to work: it bypasses every client-
 * side cache unconditionally. Slightly heavier than a soft refresh, but
 * this is a low-frequency, deliberate owner action (behind a confirm
 * dialog already), not something worth further speculative tuning.
 * Scoped to this component only — ActionButton itself is unchanged,
 * since every other (local-mode) caller already refreshes correctly.
 */
export function RemoteApprovalButtons({ projectId, approvalId }: { projectId: string; approvalId: string }) {
  return (
    <div className="flex gap-2">
      <ActionButton
        action={async () => {
          const result = await approveRemoteApprovalAction(projectId, approvalId);
          if (!result.error) window.location.reload();
          return result;
        }}
        variant="default"
        size="sm"
        confirmMessage="Approve this and resume the project in the background?"
        successMessage="Approved — the project will resume shortly."
      >
        Approve
      </ActionButton>
      <ActionButton
        action={async () => {
          const result = await rejectRemoteApprovalAction(projectId, approvalId);
          if (!result.error) window.location.reload();
          return result;
        }}
        variant="outline"
        size="sm"
        confirmMessage="Reject this?"
        successMessage="Rejected."
      >
        Reject
      </ActionButton>
    </div>
  );
}
