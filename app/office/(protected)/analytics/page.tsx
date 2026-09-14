import type { Metadata } from "next";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOfficeAnalytics } from "@/lib/ai-office/dashboard/analytics-data";
import { GlassCard } from "@/components/common/glass-card";

export const metadata: Metadata = { title: "Analytics" };

function Stat({ label, value, tone }: { label: string; value: string; tone?: "destructive" }) {
  return (
    <div className="rounded-xl border border-border/50 px-3 py-2.5">
      <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tracking-tight ${tone === "destructive" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

/** Office-wide analytics (Section 28) — every number is a real aggregation over persisted state; an office with no paid usage yet reports honest zeros, not omitted sections. */
export default async function AnalyticsPage() {
  const db = getAppDatabase();
  const a = getOfficeAnalytics(db);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Projects</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total" value={String(a.totalProjects)} />
          <Stat label="In progress" value={String(a.projectsByStatus.IN_PROGRESS ?? 0)} />
          <Stat label="Blocked" value={String(a.projectsByStatus.BLOCKED ?? 0)} tone={a.projectsByStatus.BLOCKED ? "destructive" : undefined} />
          <Stat label="Ready for review" value={String(a.projectsByStatus.READY_FOR_REVIEW ?? 0)} />
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Tasks &amp; Retries</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total tasks" value={String(a.totalTasks)} />
          <Stat label="Completed" value={String(a.totalTasksCompleted)} />
          <Stat label="Blocked" value={String(a.totalTasksBlocked)} tone={a.totalTasksBlocked ? "destructive" : undefined} />
          <Stat label="Retries" value={String(a.totalRetries)} />
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Local vs. Paid Calls</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Local runs" value={String(a.localRuns)} />
          <Stat label="Simulated runs" value={String(a.simulatedRuns)} />
          <Stat label="Claude calls" value={String(a.claudeCalls)} />
          <Stat label="Claude spend" value={`$${a.claudeCostUsd.toFixed(4)}`} />
        </div>
      </GlassCard>

      {a.claudeCalls > 0 ? (
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">Claude Tokens &amp; Cache</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Input tokens" value={a.claudeInputTokens.toLocaleString()} />
            <Stat label="Output tokens" value={a.claudeOutputTokens.toLocaleString()} />
            <Stat label="Cache read" value={a.claudeCacheReadTokens.toLocaleString()} />
            <Stat label="Cache write" value={a.claudeCacheWriteTokens.toLocaleString()} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Avg cost / project" value={`$${a.averagePaidCostPerProject.toFixed(4)}`} />
            <Stat label="Cost / completed task" value={`$${a.costPerCompletedPaidTask.toFixed(4)}`} />
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="text-sm text-muted-foreground">No Claude usage recorded yet — token/cache/cost figures will appear here once a paid call completes.</GlassCard>
      )}
    </div>
  );
}
