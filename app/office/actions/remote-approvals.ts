"use server";

import { approveApproval, rejectApproval } from "@/lib/ai-office/approvals/approval-service";
import { withRemoteProjectMutation, REMOTE_SYNTHETIC_OWNER_ID } from "@/lib/ai-office/remote/remote-state-store";

/**
 * Remote Mode's approve/reject implementation — called from
 * app/office/actions/approvals.ts when `isRemoteExecutionMode()`, so the
 * SAME UI/Server Action names local mode uses work unmodified in both
 * modes. Reuses `approveApproval`/`rejectApproval` completely
 * unmodified; `withRemoteProjectMutation` (remote-state-store.ts) is the
 * shared hydrate/flush/retry/dispatch boundary every remote write now
 * goes through.
 */
export async function decideRemoteApproval(projectId: string, approvalId: string, note: string | undefined, kind: "approve" | "reject"): Promise<{ error?: string }> {
  const result = await withRemoteProjectMutation(
    projectId,
    (db) => {
      const decision =
        kind === "approve"
          ? approveApproval(db, { approvalId, decidedByUserId: REMOTE_SYNTHETIC_OWNER_ID, note: note?.trim() || undefined })
          : rejectApproval(db, { approvalId, decidedByUserId: REMOTE_SYNTHETIC_OWNER_ID, note: note?.trim() || undefined });
      return decision.ok ? { ok: true, value: undefined } : { ok: false, error: decision.reason };
    },
    { dispatchContinue: true },
  );
  return result.ok ? {} : { error: result.error };
}
