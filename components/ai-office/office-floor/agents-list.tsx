"use client";

import { Badge } from "@/components/ui/badge";
import type { OfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  IDLE: "outline",
  WORKING: "default",
  THINKING: "default",
  REVIEWING: "default",
  WAITING: "outline",
  BLOCKED: "destructive",
  DONE: "secondary",
  PAUSED: "secondary",
};

/**
 * A compact, real-data vertical list of all 11 agents — used both as the
 * side panel's "Agents" section and as the below-768px fallback for the
 * main canvas (per the brief: "do NOT try squeezing a huge isometric
 * office into 390px... compact vertical agent/department view"). Same
 * `OfficeFloorView` data as the visual floor, no separate fetch.
 */
export function AgentsList({ floor, onSelect }: { floor: OfficeFloorView; onSelect?: (roleId: string) => void }) {
  return (
    <ul className="flex flex-col gap-2">
      {floor.agents.map((agent) => (
        <li key={agent.roleId}>
          <button
            type="button"
            onClick={() => onSelect?.(agent.roleId)}
            disabled={!onSelect}
            className="glass flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-colors enabled:hover:border-primary/40 disabled:cursor-default"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {agent.roleName}
                {/* Subtle paid-AI indicator (Part 19) — only paid work gets a marker; local/simulated agents stay unmarked, no redesign. */}
                {agent.provider === "claude" && (
                  <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 align-middle font-mono text-[0.55rem] tracking-widest text-primary uppercase">
                    Claude
                  </span>
                )}
              </p>
              {agent.currentTaskTitle && <p className="truncate text-xs text-muted-foreground">{agent.currentTaskTitle}</p>}
              {!agent.currentTaskTitle && agent.lastCompletedTaskTitle && (
                <p className="truncate text-xs text-muted-foreground">Last: {agent.lastCompletedTaskTitle}</p>
              )}
            </div>
            <Badge variant={STATUS_VARIANT[agent.status]} className="shrink-0 font-mono text-[0.6rem] uppercase">
              {agent.status}
            </Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}
