"use client";

import { cn } from "@/lib/utils";
import { AgentCharacter } from "./agent-character";
import type { OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * Status text always accompanies the color (never color-only) — the pill's
 * dot and text both change, and the text itself is the accessible label.
 */
const STATUS_META: Record<OfficeAgentView["status"], { label: string; dot: string; ring: string }> = {
  IDLE: { label: "Idle", dot: "bg-muted-foreground/50", ring: "" },
  WORKING: { label: "Working", dot: "bg-primary", ring: "ring-primary/40" },
  THINKING: { label: "Thinking", dot: "bg-accent-2", ring: "ring-accent-2/40" },
  REVIEWING: { label: "Reviewing", dot: "bg-accent-2", ring: "ring-accent-2/40" },
  WAITING: { label: "Waiting", dot: "bg-muted-foreground/40", ring: "" },
  BLOCKED: { label: "Blocked", dot: "bg-destructive", ring: "ring-destructive/50" },
  DONE: { label: "Done", dot: "bg-[oklch(0.7_0.17_150)]", ring: "ring-[oklch(0.7_0.17_150)]/40" },
  PAUSED: { label: "Paused", dot: "bg-muted-foreground/30", ring: "" },
};

export function Workstation({ agent, onSelect }: { agent: OfficeAgentView; onSelect: (roleId: string) => void }) {
  const meta = STATUS_META[agent.status];
  const dimmed = agent.status === "PAUSED";

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.roleId)}
      className={cn(
        "group flex w-full flex-col items-center gap-1.5 rounded-xl border border-border/50 bg-background/30 p-2 text-left transition-colors hover:border-primary/40 hover:bg-background/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        dimmed && "opacity-50",
        meta.ring && `ring-1 ${meta.ring}`,
      )}
      aria-label={`${agent.roleName}, ${meta.label}${agent.currentTaskTitle ? `: ${agent.currentTaskTitle}` : ""}`}
    >
      <div className="relative h-14 w-16">
        <AgentCharacter status={agent.status} />
        {agent.status === "REVIEWING" && (
          <span className="absolute inset-x-3 top-2 h-8 overflow-hidden rounded-sm" aria-hidden="true">
            <span className="block h-2 w-full bg-accent-2/40 animate-scan-sweep" />
          </span>
        )}
        {agent.status === "THINKING" && (
          <span className="absolute -top-1 right-0 flex gap-0.5" aria-hidden="true">
            <span className="size-1 rounded-full bg-accent-2 animate-[star-twinkle_1.6s_ease-in-out_infinite]" />
            <span className="size-1 rounded-full bg-accent-2 animate-[star-twinkle_1.6s_ease-in-out_infinite_0.3s]" />
            <span className="size-1 rounded-full bg-accent-2 animate-[star-twinkle_1.6s_ease-in-out_infinite_0.6s]" />
          </span>
        )}
      </div>

      <div className="flex w-full flex-col items-center gap-0.5">
        <p className="w-full truncate text-center text-[0.65rem] font-semibold tracking-tight text-foreground">{agent.roleName}</p>
        <span className="flex items-center gap-1 text-[0.6rem] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden="true" />
          {meta.label}
        </span>
      </div>
    </button>
  );
}
