import { GlassCard } from "@/components/common/glass-card";
import type { CollaborationEntry } from "@/lib/ai-office/dashboard/project-detail-data";

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Section 14 — every entry is derived from real task completions and
 * real failure/remediation records (see `getCollaborationFeed`); this is
 * deliberately never a fabricated chat transcript. An empty project
 * (nothing has finished or failed yet) gets an honest empty state, not a
 * blank rectangle.
 */
export function CollaborationFeed({ entries }: { entries: CollaborationEntry[] }) {
  return (
    <GlassCard>
      <h2 className="text-sm font-semibold tracking-tight">Agent Collaboration</h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No hand-offs or reviews recorded yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5 text-xs">
          {entries.map((entry) => (
            <li key={entry.id} className="border-b border-border/40 pb-2.5 last:border-0">
              <p className="font-medium">{entry.fromRoleName}</p>
              <p className="mt-0.5 text-muted-foreground">{entry.message.replace(`${entry.fromRoleName}: `, "")}</p>
              <p className="mt-0.5 font-mono text-[0.6rem] text-muted-foreground/70">{formatTimestamp(entry.occurredAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
