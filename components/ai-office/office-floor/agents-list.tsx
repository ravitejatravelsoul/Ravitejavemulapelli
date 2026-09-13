"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { getRoleVisual } from "./role-visuals";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import type { OfficeFloorView, AgentDetailView } from "@/lib/ai-office/dashboard/office-floor-data";

const STATUS_DOT: Record<string, string> = {
  IDLE: "bg-muted-foreground/50",
  WORKING: "bg-primary",
  THINKING: "bg-accent-2",
  REVIEWING: "bg-accent-2",
  WAITING: "bg-[oklch(0.78_0.14_75)]",
  BLOCKED: "bg-destructive",
  DONE: "bg-[oklch(0.7_0.17_150)]",
  PAUSED: "bg-muted-foreground/30",
};

/**
 * The below-`md` fallback for the cinematic floor (a full spatial office
 * doesn't survive being shrunk to a phone screen — Section 23 asks for a
 * prioritized list instead) and the side panel's "Agents" section. Clicking
 * an agent opens the same real Agent Room the floor does — mobile agents
 * are just as clickable as desktop ones, only the entry point differs.
 */
export function AgentsList({ floor, agentDetails }: { floor: OfficeFloorView; agentDetails?: Record<string, AgentDetailView> }) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-2">
        {floor.agents.map((agent) => {
          const visual = getRoleVisual(agent.roleId);
          const Icon = visual.icon;
          const active = agent.status === "WORKING" || agent.status === "THINKING" || agent.status === "REVIEWING";
          return (
            <li key={agent.roleId}>
              <button
                type="button"
                onClick={() => agentDetails && setSelectedRoleId(agent.roleId)}
                disabled={!agentDetails}
                style={{ "--role-accent": visual.accent } as React.CSSProperties}
                className="glass flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors enabled:hover:border-(--role-accent)/50 disabled:cursor-default"
              >
                <span
                  className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", active && "animate-accent-glow-pulse")}
                  style={{ background: "color-mix(in oklch, var(--role-accent) 20%, transparent)", color: "var(--role-accent)" }}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {agent.roleName}
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
                <span className="flex shrink-0 items-center gap-1.5 font-mono text-[0.6rem] text-muted-foreground uppercase">
                  <span className={cn("size-1.5 rounded-full", STATUS_DOT[agent.status])} aria-hidden="true" />
                  {agent.status}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {agentDetails && (
        <AgentDetailDrawer detail={selectedRoleId ? (agentDetails[selectedRoleId] ?? null) : null} onOpenChange={(open) => !open && setSelectedRoleId(null)} />
      )}
    </>
  );
}
