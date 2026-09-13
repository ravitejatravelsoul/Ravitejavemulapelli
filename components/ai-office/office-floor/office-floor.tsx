"use client";

import { useState } from "react";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkstationArt } from "./workstation-art";
import { getRoleVisual } from "./role-visuals";
import { Connector } from "./connector";
import { OfficeProjectStrip } from "./office-project-strip";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import type { OfficeFloorView, AgentDetailView, OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

/** Left-to-right, top-to-bottom reads as the real pipeline order: idea → plan → design → build → verify → ship. */
const FLOOR_ORDER = [
  "product-owner",
  "research-agent",
  "solution-architect",
  "ui-ux-agent",
  "frontend-developer",
  "backend-developer",
  "qa-agent",
  "security-reviewer",
  "code-reviewer",
  "release-agent",
];

const STATUS_LABEL: Record<OfficeAgentView["status"], string> = {
  IDLE: "Idle",
  WORKING: "Working",
  THINKING: "Thinking",
  REVIEWING: "Reviewing",
  WAITING: "Waiting",
  BLOCKED: "Blocked",
  DONE: "Done",
  PAUSED: "Paused",
};

const STATUS_DOT: Record<OfficeAgentView["status"], string> = {
  IDLE: "bg-muted-foreground/50",
  WORKING: "bg-primary",
  THINKING: "bg-accent-2",
  REVIEWING: "bg-accent-2",
  WAITING: "bg-[oklch(0.78_0.14_75)]",
  BLOCKED: "bg-destructive",
  DONE: "bg-[oklch(0.7_0.17_150)]",
  PAUSED: "bg-muted-foreground/30",
};

function isAnyActive(agents: OfficeAgentView[]): boolean {
  return agents.some((a) => a.status === "WORKING" || a.status === "THINKING" || a.status === "REVIEWING");
}

function AgentLabel({ agent }: { agent: OfficeAgentView }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <p className="max-w-[7.5rem] truncate text-xs font-semibold text-white/90">{agent.roleName}</p>
      <span className="flex items-center gap-1 text-[0.6rem] text-white/55">
        <span className={cn("size-1.5 rounded-full", STATUS_DOT[agent.status])} aria-hidden="true" />
        {STATUS_LABEL[agent.status]}
        {agent.provider === "claude" && <span className="ml-1 rounded-full bg-primary/25 px-1 py-px font-mono text-[0.5rem] tracking-widest uppercase">Claude</span>}
      </span>
    </div>
  );
}

/**
 * The living office floor — an illustrated scene (workstation-art.tsx), not
 * a grid of cards. Every desk, monitor motif, and character is decorative
 * SVG; the only real data layered on top is a compact name/status label and
 * the click target itself. Central Command sits apart and larger, the
 * other ten roles read left-to-right in real pipeline order, and a single
 * connector lights up only while real work is actually flowing.
 */
export function OfficeFloor({
  floor,
  agentDetails,
  officeState = "OPEN",
}: {
  floor: OfficeFloorView;
  agentDetails: Record<string, AgentDetailView>;
  officeState?: "OPEN" | "CLOSED";
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const isClosed = officeState === "CLOSED";
  const byRole = new Map(floor.agents.map((a) => [a.roleId, a]));
  const orchestrator = byRole.get("orchestrator");
  const floorAgents = FLOOR_ORDER.map((id) => byRole.get(id)).filter((a): a is OfficeAgentView => !!a);
  const anyActive = !isClosed && isAnyActive(floor.agents);

  return (
    <div className="flex flex-col gap-3">
      <OfficeProjectStrip floor={floor} />

      <div
        className={cn(
          "relative overflow-hidden rounded-[2.5rem] border border-white/10 p-4 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.6)] transition-opacity sm:p-6 lg:p-8",
          isClosed && "opacity-60",
        )}
      >
        {/* Ambient office — a dark "night engineering office" backdrop the
            illustrated workstations sit directly on, deliberately never a
            bordered rectangle per role. Always dark/cinematic regardless of
            the site's light/dark theme (Section 16). */}
        <div
          className="absolute inset-0 rounded-[2.5rem]"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, #241f36 0%, #140f20 55%, #0a0812 100%)" }}
          aria-hidden="true"
        />
        <div className="grid-pattern grid-fade-mask pointer-events-none absolute inset-0 rounded-[2.5rem] opacity-[0.12]" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -top-16 left-1/4 h-56 w-56 rounded-full blur-[100px] transition-opacity duration-700"
          style={{ background: "oklch(0.64 0.19 280 / 35%)", opacity: anyActive ? 0.9 : 0.4 }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute right-0 bottom-0 h-64 w-64 rounded-full blur-[100px]"
          style={{ background: "oklch(0.78 0.14 75 / 18%)" }}
          aria-hidden="true"
        />

        {isClosed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50" aria-hidden="true">
            <span className="glass-strong rounded-full px-4 py-1.5 font-mono text-xs tracking-widest text-white uppercase">Office closed</span>
          </div>
        )}

        <div className="relative flex flex-col gap-6 py-2">
          {/* Central Command — elevated, larger, visually the room's anchor:
              a raised dais and two flanking status tiles set it apart from
              an ordinary workstation, not just a bigger copy of one. */}
          <div className="mx-auto flex w-full max-w-[15rem] flex-col items-center gap-2">
            <span className="flex items-center gap-1.5 font-mono text-[0.62rem] font-semibold tracking-[0.22em] text-primary uppercase">
              <Crown className="size-3.5" aria-hidden="true" />
              Central Command
            </span>
            <div className="relative flex items-end justify-center">
              <div
                className="absolute bottom-2 h-6 w-56 rounded-[50%] opacity-70 sm:w-64"
                style={{ background: "radial-gradient(ellipse, oklch(0.64 0.19 280 / 45%) 0%, transparent 75%)" }}
                aria-hidden="true"
              />
              <div className="hidden shrink-0 flex-col gap-1.5 self-center pb-6 opacity-70 sm:flex" aria-hidden="true">
                <span className="h-6 w-9 rounded-sm bg-primary/25" />
                <span className="h-6 w-9 rounded-sm bg-primary/15" />
              </div>
              {orchestrator ? (
                <button
                  type="button"
                  onClick={() => setSelectedRoleId("orchestrator")}
                  className="relative z-10 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                  aria-label={`${orchestrator.roleName}, ${STATUS_LABEL[orchestrator.status]}${orchestrator.currentTaskTitle ? `: ${orchestrator.currentTaskTitle}` : ""}`}
                >
                  <WorkstationArt
                    roleId="orchestrator"
                    accent={getRoleVisual("orchestrator").accent}
                    status={orchestrator.status}
                    dim={isClosed}
                    className="h-40 w-40 drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)] transition-transform duration-200 hover:scale-[1.03] sm:h-48 sm:w-48"
                  />
                </button>
              ) : (
                <div className="h-40 w-40 sm:h-48 sm:w-48" />
              )}
              <div className="hidden shrink-0 flex-col gap-1.5 self-center pb-6 opacity-70 sm:flex" aria-hidden="true">
                <span className="h-6 w-9 rounded-sm bg-primary/15" />
                <span className="h-6 w-9 rounded-sm bg-primary/25" />
              </div>
            </div>
            {orchestrator && <AgentLabel agent={orchestrator} />}
          </div>

          <Connector active={anyActive} />

          {/* The other ten roles, in real pipeline order. */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-7 sm:grid-cols-3 sm:gap-x-3 lg:grid-cols-5">
            {floorAgents.map((agent) => (
              <div key={agent.roleId} className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedRoleId(agent.roleId)}
                  className="rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                  aria-label={`${agent.roleName}, ${STATUS_LABEL[agent.status]}${agent.currentTaskTitle ? `: ${agent.currentTaskTitle}` : ""}`}
                >
                  <WorkstationArt
                    roleId={agent.roleId}
                    accent={getRoleVisual(agent.roleId).accent}
                    status={agent.status}
                    dim={isClosed}
                    className="h-28 w-28 drop-shadow-[0_14px_22px_rgba(0,0,0,0.5)] transition-transform duration-200 hover:scale-[1.05] sm:h-32 sm:w-32"
                  />
                </button>
                <AgentLabel agent={agent} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <AgentDetailDrawer detail={selectedRoleId ? (agentDetails[selectedRoleId] ?? null) : null} onOpenChange={(open) => !open && setSelectedRoleId(null)} />
    </div>
  );
}
