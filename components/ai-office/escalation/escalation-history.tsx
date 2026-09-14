import { Badge } from "@/components/ui/badge";
import type { EscalationRow } from "@/lib/ai-office/domain/escalations";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  CALLING: "default",
  SMS_SENT: "default",
  WAITING_FOR_RESPONSE: "default",
  APPROVED: "secondary",
  REJECTED: "destructive",
  EXPIRED: "outline",
  FAILED: "destructive",
  CANCELLED: "outline",
};

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Owner-only history of every real escalation this office has ever raised (Section N) — never a raw credential/header, only the already-safe fields on the row itself. */
export function EscalationHistory({ escalations }: { escalations: EscalationRow[] }) {
  if (escalations.length === 0) {
    return <p className="text-sm text-muted-foreground">No escalations have been raised yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {escalations.map((e) => {
        const channels = e.channelAttempted ? (JSON.parse(e.channelAttempted) as string[]) : [];
        return (
          <li key={e.id} className="flex flex-col gap-1 border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[0.65rem] text-muted-foreground">{formatTimestamp(e.createdAt)}</span>
              {e.agentRole && <span className="font-medium">{e.agentRole}</span>}
              <Badge variant={STATUS_VARIANT[e.status] ?? "outline"} className="font-mono text-[0.6rem] uppercase">
                {e.status.replace(/_/g, " ")}
              </Badge>
              <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
                {e.urgency}
              </Badge>
              {channels.length > 0 && <span className="font-mono text-[0.6rem] text-muted-foreground uppercase">{channels.join(" → ")}</span>}
            </div>
            <p className="text-xs text-muted-foreground">{e.reason}</p>
            {e.resolution && <p className="text-xs text-muted-foreground">{e.resolution}</p>}
          </li>
        );
      })}
    </ul>
  );
}
