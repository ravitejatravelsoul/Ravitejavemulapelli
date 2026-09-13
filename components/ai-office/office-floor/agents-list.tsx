"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { getRoleVisual } from "./role-visuals";
import { WorkstationArt } from "./workstation-art";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import type { OfficeFloorView, AgentDetailView, OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

const STATUS_LABEL: Record<string, string> = {
  IDLE: "Idle",
  WORKING: "Working",
  THINKING: "Thinking",
  REVIEWING: "Reviewing",
  WAITING: "Waiting",
  BLOCKED: "Blocked",
  DONE: "Done",
  PAUSED: "Paused",
};

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

function isActive(status: string): boolean {
  return status === "WORKING" || status === "THINKING" || status === "REVIEWING";
}

/**
 * The below-`md` fallback for the cinematic floor (a full spatial office
 * doesn't survive being shrunk to a phone screen — Section 19 asks for an
 * active-agent hero plus a prioritized list instead) and the side panel's
 * "Agents" section. Clicking an agent opens the same real Agent Room the
 * floor does — mobile agents are just as clickable as desktop ones, only
 * the entry point differs. Thumbnails reuse the same illustrated
 * `WorkstationArt` as the desktop floor, just smaller — never a plain icon.
 */
export function AgentsList({ floor, agentDetails, showHero = true }: { floor: OfficeFloorView; agentDetails?: Record<string, AgentDetailView>; showHero?: boolean }) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const heroAgent: OfficeAgentView | undefined = showHero ? floor.agents.find((a) => isActive(a.status)) : undefined;

  return (
    <>
      {heroAgent && (
        <button
          type="button"
          onClick={() => agentDetails && setSelectedRoleId(heroAgent.roleId)}
          disabled={!agentDetails}
          className="relative mb-3 flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-white/10 p-4 text-left shadow-[0_20px_40px_-24px_rgba(0,0,0,0.6)]"
          style={{ background: "radial-gradient(ellipse 90% 80% at 30% 20%, #241f36 0%, #100d18 70%)" }}
        >
          <WorkstationArt roleId={heroAgent.roleId} accent={getRoleVisual(heroAgent.roleId).accent} status={heroAgent.status} className="h-20 w-20 shrink-0" />
          <div className="min-w-0">
            <p className="font-mono text-[0.6rem] tracking-widest text-primary uppercase">Active now</p>
            <p className="truncate text-sm font-semibold text-white">{heroAgent.roleName}</p>
            <p className="truncate text-xs text-white/60">{heroAgent.currentTaskTitle ?? STATUS_LABEL[heroAgent.status]}</p>
          </div>
        </button>
      )}

      <ul className="flex flex-col gap-2">
        {floor.agents.map((agent) => {
          const visual = getRoleVisual(agent.roleId);
          return (
            <li key={agent.roleId}>
              <button
                type="button"
                onClick={() => agentDetails && setSelectedRoleId(agent.roleId)}
                disabled={!agentDetails}
                style={{ "--role-accent": visual.accent } as React.CSSProperties}
                className="glass flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors enabled:hover:border-(--role-accent)/50 disabled:cursor-default"
              >
                <WorkstationArt roleId={agent.roleId} accent={visual.accent} status={agent.status} className="h-11 w-11 shrink-0" />
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
