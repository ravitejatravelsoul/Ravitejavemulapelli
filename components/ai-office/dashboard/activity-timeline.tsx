"use client";

import { useMemo, useState } from "react";
import { GlassCard } from "@/components/common/glass-card";
import { cn } from "@/lib/utils";
import type { ActivityEntry, ActivityCategory } from "@/lib/ai-office/dashboard/dashboard-data";

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const FILTERS: Array<{ key: "ALL" | ActivityCategory; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "WORK", label: "Work" },
  { key: "FAILURE", label: "Failures" },
  { key: "RECOVERY", label: "Recovery" },
  { key: "APPROVAL", label: "Approvals" },
  { key: "COST", label: "Cost" },
];

const CATEGORY_DOT: Record<ActivityCategory, string> = {
  WORK: "bg-primary",
  FAILURE: "bg-destructive",
  RECOVERY: "bg-amber-500",
  APPROVAL: "bg-accent-2",
  COST: "bg-emerald-500",
};

/**
 * Platform-hardening phase, Part 4 — a real chronological execution
 * timeline replacing the previous generic "Agent Collaboration"/plain
 * activity list. Every entry is real, already-persisted event history
 * (`ActivityEntry[]`, built server-side from `messages_events` via
 * `describeEvent`/`categorizeEventType`) — this component only filters
 * and renders what it's given, it never invents an entry.
 */
export function ActivityTimeline({ entries }: { entries: ActivityEntry[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("ALL");

  const filtered = useMemo(() => (filter === "ALL" ? entries : entries.filter((e) => e.category === filter)), [entries, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: entries.length };
    for (const key of ["WORK", "FAILURE", "RECOVERY", "APPROVAL", "COST"] as const) c[key] = entries.filter((e) => e.category === key).length;
    return c;
  }, [entries]);

  return (
    <GlassCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Execution Timeline</h2>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter activity">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              disabled={counts[f.key] === 0}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {entries.length === 0 ? "Nothing has happened yet — activity appears here once the project starts planning or running." : "No entries match this filter."}
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2.5 text-xs">
          {filtered.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2.5 border-b border-border/40 pb-2.5 last:border-0 last:pb-0">
              <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", CATEGORY_DOT[entry.category])} aria-hidden="true" />
              <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">{formatTimestamp(entry.occurredAt)}</span>
              <span className="text-foreground">{entry.message}</span>
            </li>
          ))}
        </ol>
      )}
    </GlassCard>
  );
}
