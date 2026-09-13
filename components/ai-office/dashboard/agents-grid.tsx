"use client";

import { useState } from "react";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { AgentDetailDrawer } from "@/components/ai-office/office-floor/agent-detail-drawer";
import type { OfficeAgentView, AgentDetailView } from "@/lib/ai-office/dashboard/office-floor-data";

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

export interface AgentCardData {
  agent: OfficeAgentView;
  description: string;
}

/**
 * The AI Workforce (Section 27) — all 11 specialized engineering roles,
 * their real current status in the office's most active project, and a
 * one-line description of what each role is responsible for (from the
 * agent role catalog, not a fabricated biography). Clicking a card opens
 * the same real Agent Room used everywhere else in the Office.
 */
export function AgentsGrid({ cards, agentDetails }: { cards: AgentCardData[]; agentDetails: Record<string, AgentDetailView> }) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ agent, description }) => (
          <button
            key={agent.roleId}
            type="button"
            onClick={() => setSelectedRoleId(agent.roleId)}
            className="text-left"
            aria-label={`Open ${agent.roleName}'s details`}
          >
            <GlassCard className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold tracking-tight">{agent.roleName}</p>
                  <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">AI Agent</p>
                </div>
                <Badge variant={STATUS_VARIANT[agent.status] ?? "outline"} className="font-mono text-[0.6rem] uppercase">
                  {agent.status}
                </Badge>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
              <div className="mt-auto flex flex-col gap-0.5 pt-2 text-xs">
                {agent.currentTaskTitle && <p className="truncate">Now: {agent.currentTaskTitle}</p>}
                {!agent.currentTaskTitle && agent.lastCompletedTaskTitle && <p className="truncate text-muted-foreground">Last: {agent.lastCompletedTaskTitle}</p>}
                {!agent.currentTaskTitle && !agent.lastCompletedTaskTitle && <p className="text-muted-foreground">Not yet assigned</p>}
                {agent.provider && (
                  <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">{agent.provider}</p>
                )}
              </div>
            </GlassCard>
          </button>
        ))}
      </div>

      <AgentDetailDrawer detail={selectedRoleId ? (agentDetails[selectedRoleId] ?? null) : null} onOpenChange={(open) => !open && setSelectedRoleId(null)} />
    </>
  );
}
