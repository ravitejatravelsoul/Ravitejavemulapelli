import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import type { BudgetView } from "@/lib/ai-office/dashboard/dashboard-data";

const STATUS_STYLE: Record<BudgetView["status"], { label: string; badge: "default" | "destructive" | "secondary"; bar: string }> = {
  SAFE: { label: "SAFE", badge: "secondary", bar: "bg-primary" },
  WARNING: { label: "WARNING", badge: "default", bar: "bg-amber-500" },
  AT_CAP: { label: "AT CAP", badge: "destructive", bar: "bg-destructive" },
};

export function BudgetPanel({ budget }: { budget: BudgetView }) {
  const committed = budget.liveSpendUsd + budget.reservedUsd;
  const percent = budget.capUsd > 0 ? Math.min(100, (committed / budget.capUsd) * 100) : 0;
  const style = STATUS_STYLE[budget.status];

  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">AI Budget — {budget.monthLabel}</h2>
        <Badge variant={style.badge}>{style.label}</Badge>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${percent}%` }} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Monthly Limit</dt>
          <dd className="font-medium">${budget.capUsd.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">LIVE Spend</dt>
          <dd className="font-medium">${budget.liveSpendUsd.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reserved</dt>
          <dd className="font-medium">${budget.reservedUsd.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Remaining</dt>
          <dd className="font-medium">${budget.remainingUsd.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Simulated Runs</dt>
          <dd className="font-medium">{budget.simulatedRuns}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Simulated Cost</dt>
          <dd className="font-medium">${budget.simulatedCostUsd.toFixed(2)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[0.7rem] text-muted-foreground">
        No live provider exists yet (Phase 7+) — LIVE spend and reservations are exercised only via automated tests today, and will
        always remain $0 until a real provider is connected under separate, explicit authorization.
      </p>
    </GlassCard>
  );
}
