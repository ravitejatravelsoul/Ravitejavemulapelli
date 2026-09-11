import { GlassCard } from "@/components/common/glass-card";
import type { OfficeOverview } from "@/lib/ai-office/dashboard/dashboard-data";

function StatCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "default" | "warn" | "danger" }) {
  const toneClass = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-500" : "text-foreground";
  return (
    <GlassCard className="p-4 md:p-5">
      <p className="text-[0.65rem] font-medium tracking-widest text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
    </GlassCard>
  );
}

export function OverviewCards({ overview }: { overview: OfficeOverview }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
      <StatCard label="Active Projects" value={overview.activeProjects} />
      <StatCard label="Paused" value={overview.pausedProjects} />
      <StatCard label="Blocked" value={overview.blockedProjects} tone={overview.blockedProjects > 0 ? "warn" : "default"} />
      <StatCard label="Ready for Review" value={overview.readyForReviewProjects} />
      <StatCard label="Pending Approvals" value={overview.pendingApprovals} tone={overview.pendingApprovals > 0 ? "warn" : "default"} />
      <StatCard label="Tasks Completed" value={overview.tasksCompleted} />
      <StatCard label="Tasks Running" value={overview.tasksRunning} />
      <StatCard label="Blocked Tasks" value={overview.tasksBlocked} tone={overview.tasksBlocked > 0 ? "danger" : "default"} />
      <StatCard label="Simulated Runs" value={overview.simulatedRuns} />
      <StatCard label="Current Month AI Cost (LIVE)" value={`$${overview.currentMonthLiveCostUsd.toFixed(2)}`} />
    </div>
  );
}
