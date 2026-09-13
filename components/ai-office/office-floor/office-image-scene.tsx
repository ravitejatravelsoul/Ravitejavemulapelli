"use client";

import { useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRoleVisual } from "./role-visuals";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import { OFFICE_HOTSPOTS, OFFICE_IMAGE_WIDTH, OFFICE_IMAGE_HEIGHT, getHotspotPercent } from "@/lib/ai-office/office-hotspots";
import type { OfficeFloorView, AgentDetailView, OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

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

const ROLE_ORDER = Object.keys(OFFICE_HOTSPOTS);

function isActive(status: OfficeAgentView["status"]): boolean {
  return status === "WORKING" || status === "THINKING" || status === "REVIEWING";
}

/**
 * The approved master office illustration IS the visual (Section 3 of this
 * phase — do not recreate it). Every operational signal is a transparent
 * HTML overlay positioned from `OFFICE_HOTSPOTS`' percentages, so the image
 * itself never needs to change, and hotspots stay aligned at every
 * breakpoint the image is rendered at.
 */
export function OfficeImageScene({
  floor,
  agentDetails,
  officeState = "OPEN",
  recentHandoff,
  debugEnabled = false,
}: {
  floor: OfficeFloorView;
  agentDetails: Record<string, AgentDetailView>;
  officeState?: "OPEN" | "CLOSED";
  recentHandoff?: { from: string; to: string } | null;
  debugEnabled?: boolean;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [labelsAlwaysOn, setLabelsAlwaysOn] = useState(false);
  const isClosed = officeState === "CLOSED";
  const byRole = new Map(floor.agents.map((a) => [a.roleId, a]));
  const activeAgents = floor.agents.filter((a) => isActive(a.status));

  const handoffFrom = recentHandoff ? getHotspotPercent(recentHandoff.from) : null;
  const handoffTo = recentHandoff ? getHotspotPercent(recentHandoff.to) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setLabelsAlwaysOn((v) => !v)}
          className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[0.65rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          {labelsAlwaysOn ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
          {labelsAlwaysOn ? "Labels on" : "Labels on hover"}
        </button>
      </div>

      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.6)]" style={{ aspectRatio: `${OFFICE_IMAGE_WIDTH} / ${OFFICE_IMAGE_HEIGHT}` }}>
        <Image
          src="/images/ai-office/living-office.webp"
          alt="Teja's AI Office — the living virtual engineering office"
          fill
          priority
          sizes="(min-width: 1024px) 1200px, 100vw"
          className={cn("object-cover transition-[filter]", isClosed && "brightness-[0.35] grayscale")}
        />

        {isClosed && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-black/35" aria-hidden="true">
            <span className="rounded-full bg-black/70 px-4 py-1.5 font-mono text-xs font-semibold tracking-widest text-white uppercase">Office Closed</span>
            <span className="max-w-xs text-center text-xs text-white/70">Work preserved. No new agent or model execution will start.</span>
          </div>
        )}

        {/* Real recent handoff — only rendered when the caller found one within its own recency window. */}
        {!isClosed && handoffFrom && handoffTo && (
          <svg className="pointer-events-none absolute inset-0 z-[15] h-full w-full" aria-hidden="true">
            <line
              x1={`${handoffFrom.left + handoffFrom.width / 2}%`}
              y1={`${handoffFrom.top + handoffFrom.height / 2}%`}
              x2={`${handoffTo.left + handoffTo.width / 2}%`}
              y2={`${handoffTo.top + handoffTo.height / 2}%`}
              stroke="var(--primary)"
              strokeWidth="5"
              opacity="0.35"
              style={{ filter: "blur(3px)" }}
            />
            <line
              x1={`${handoffFrom.left + handoffFrom.width / 2}%`}
              y1={`${handoffFrom.top + handoffFrom.height / 2}%`}
              x2={`${handoffTo.left + handoffTo.width / 2}%`}
              y2={`${handoffTo.top + handoffTo.height / 2}%`}
              stroke="var(--primary)"
              strokeWidth="2.5"
              strokeDasharray="8 6"
              opacity="0.95"
              className="animate-handoff-dash"
            />
          </svg>
        )}

        {!isClosed &&
          ROLE_ORDER.map((roleId) => {
            const agent = byRole.get(roleId);
            if (!agent) return null;
            const pct = getHotspotPercent(roleId)!;
            const accent = getRoleVisual(roleId).accent;
            const active = isActive(agent.status);

            return (
              <div
                key={roleId}
                className="group absolute z-10"
                style={{ left: `${pct.left}%`, top: `${pct.top}%`, width: `${pct.width}%`, height: `${pct.height}%` }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedRoleId(roleId)}
                  aria-label={`${agent.roleName}, ${STATUS_LABEL[agent.status]}${agent.currentTaskTitle ? `: ${agent.currentTaskTitle}` : ""}`}
                  className={cn(
                    "relative h-full w-full rounded-xl outline-2 -outline-offset-2 outline-transparent transition-all",
                    "hover:outline-white/50 focus-visible:outline-primary",
                    agent.status === "PAUSED" && "backdrop-brightness-75 backdrop-saturate-50",
                  )}
                  style={active ? { boxShadow: `inset 0 0 0 2px ${accent}, 0 0 26px 2px color-mix(in oklch, ${accent} 65%, transparent)` } : undefined}
                >
                  {agent.status === "WAITING" && (
                    <span className="absolute top-1 right-1 size-2.5 rounded-full bg-[oklch(0.78_0.14_75)] shadow-[0_0_6px_1px_oklch(0.78_0.14_75)]" aria-hidden="true" />
                  )}
                  {agent.status === "BLOCKED" && (
                    <span className="absolute top-1 right-1 size-2.5 animate-accent-glow-pulse rounded-full bg-destructive shadow-[0_0_8px_1px_var(--destructive)]" aria-hidden="true" />
                  )}
                  {agent.status === "DONE" && (
                    <span className="absolute top-1 right-1 size-2.5 animate-done-pulse rounded-full bg-[oklch(0.7_0.17_150)]" aria-hidden="true" />
                  )}
                </button>

                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-1 flex justify-center transition-opacity duration-150",
                    labelsAlwaysOn ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                  )}
                >
                  <span className="flex items-center gap-1.5 rounded-full bg-black/75 px-2 py-0.5 text-[0.6rem] whitespace-nowrap text-white shadow-lg">
                    <span
                      className={cn("size-1.5 rounded-full", active && "animate-pulse")}
                      style={{ background: active ? accent : "rgba(255,255,255,0.4)" }}
                      aria-hidden="true"
                    />
                    {agent.roleName} · {STATUS_LABEL[agent.status]}
                  </span>
                </div>

                {debugEnabled && (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-start border-2 border-dashed border-lime-400/80 bg-lime-400/10 p-1">
                    <span className="rounded bg-lime-500 px-1 font-mono text-[0.55rem] text-black">{roleId}</span>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Active-work focus panel (Section 10/11) — real data only. */}
      {!isClosed && activeAgents.length === 1 && (
        <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/60 px-3.5 py-2 text-xs">
          <span className="font-mono text-[0.6rem] tracking-widest text-primary uppercase">Currently working</span>
          <span className="font-semibold">{activeAgents[0].roleName}</span>
          {activeAgents[0].currentTaskTitle && <span className="truncate text-muted-foreground">{activeAgents[0].currentTaskTitle}</span>}
          {activeAgents[0].provider && <span className="ml-auto shrink-0 font-mono text-[0.6rem] text-muted-foreground uppercase">{activeAgents[0].provider}</span>}
        </div>
      )}
      {!isClosed && activeAgents.length > 1 && (
        <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/60 px-3.5 py-2 text-xs">
          <span className="font-mono text-[0.6rem] tracking-widest text-primary uppercase">{activeAgents.length} agents active</span>
          <span className="truncate text-muted-foreground">{activeAgents.map((a) => a.roleName).join(", ")}</span>
        </div>
      )}

      <AgentDetailDrawer detail={selectedRoleId ? (agentDetails[selectedRoleId] ?? null) : null} onOpenChange={(open) => !open && setSelectedRoleId(null)} />
    </div>
  );
}
