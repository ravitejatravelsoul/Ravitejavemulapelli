import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ai-office/action-button";
import { approveApprovalAction, rejectApprovalAction } from "@/app/office/actions/approvals";
import type { PendingApprovalView } from "@/lib/ai-office/dashboard/dashboard-data";

const KIND_LABEL: Record<string, string> = {
  production_deploy: "Production deploy",
  paid_service_purchase: "Paid service purchase",
  budget_increase: "Budget increase",
  destructive_db_action: "Destructive DB action",
  repository_deletion: "Repository deletion",
  major_architecture_replacement: "Major architecture replacement",
  external_account_creation: "External account creation",
  secrets_access: "Secrets access",
  production_credentials: "Production credentials",
  irreversible_operation: "Irreversible operation",
};

export function ApprovalsPanel({ approvals }: { approvals: PendingApprovalView[] }) {
  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Pending Approvals</h2>
        {approvals.length > 0 && <Badge variant="destructive">{approvals.length}</Badge>}
      </div>

      {approvals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing needs your decision right now.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {approvals.map((approval) => (
            <li key={approval.id} className="rounded-xl border border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{KIND_LABEL[approval.kind] ?? approval.kind}</Badge>
                <Badge variant="secondary" className="text-[0.65rem]">
                  Scope: {approval.scopeLabel}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {approval.projectTitle && <span className="text-foreground">{approval.projectTitle}</span>}
                {approval.taskTitle && <span> — {approval.taskTitle}</span>}
              </p>
              {approval.reason && <p className="mt-1 text-xs text-muted-foreground">{approval.reason}</p>}
              <p className="mt-1 text-[0.65rem] text-muted-foreground">Requested by {approval.requestedBy}</p>

              <div className="mt-3 flex gap-2">
                <ActionButton
                  action={approveApprovalAction.bind(null, approval.id)}
                  size="sm"
                  successMessage="Approved."
                  confirmMessage="Approve this action? Only this exact request becomes eligible to proceed."
                >
                  Approve
                </ActionButton>
                <ActionButton
                  action={rejectApprovalAction.bind(null, approval.id)}
                  variant="outline"
                  size="sm"
                  successMessage="Rejected."
                  confirmMessage="Reject this action? It will remain blocked."
                >
                  Reject
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
