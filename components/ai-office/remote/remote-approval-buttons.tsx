"use client";

import { ActionButton } from "@/components/ai-office/action-button";
import { approveRemoteApprovalAction, rejectRemoteApprovalAction } from "@/app/office/actions/remote-approvals";

export function RemoteApprovalButtons({ projectId, approvalId }: { projectId: string; approvalId: string }) {
  return (
    <div className="flex gap-2">
      <ActionButton
        action={() => approveRemoteApprovalAction(projectId, approvalId)}
        variant="default"
        size="sm"
        confirmMessage="Approve this and resume the project in the background?"
        successMessage="Approved — the project will resume shortly."
      >
        Approve
      </ActionButton>
      <ActionButton
        action={() => rejectRemoteApprovalAction(projectId, approvalId)}
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
