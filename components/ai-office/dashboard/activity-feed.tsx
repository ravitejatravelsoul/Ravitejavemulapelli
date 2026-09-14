import { GlassCard } from "@/components/common/glass-card";
import type { ActivityEntry } from "@/lib/ai-office/dashboard/dashboard-data";

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  return (
    <GlassCard>
      <h2 className="text-sm font-semibold tracking-tight">Activity</h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing has happened yet — activity appears here once a project starts planning or running.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5 text-xs">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2.5 border-b border-border/40 pb-2.5 last:border-0 last:pb-0">
              <span className="mt-0.5 shrink-0 font-mono text-[0.65rem] text-muted-foreground">{formatTimestamp(entry.occurredAt)}</span>
              <span className="text-foreground">{entry.message}</span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
