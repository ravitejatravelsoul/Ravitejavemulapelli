"use client";
import { VISUAL_LABEL } from "@/lib/ai-office/dashboard/office-visual-state";

import { summarizeVisualAgents, isActiveVisualState as isActive } from "@/lib/ai-office/dashboard/office-visual-state";
import { cn } from "@/lib/utils";
import { getRoleVisual } from "./role-visuals";
import { WorkstationThumb } from "./workstation-thumb";
import { useAgentSelection } from "./use-agent-selection";
import type { OfficeFloorView, OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

const STATUS_LABEL = VISUAL_LABEL;

const STATUS_DOT: Record<string, string> = {
  QUEUED: "bg-amber-300", TESTING: "bg-emerald-300", FAILED: "bg-red-400", RETRYING: "bg-cyan-300",
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
 * The below-`lg` fallback for the cinematic floor (a full spatial office
 * doesn't survive being shrunk to a phone screen) and the side panel's
 * "Agents" section. Clicking an agent shares the same `?agent=` URL
 * selection the office image's hotspots write to, so it opens the exact
 * same full-screen Agent Workspace — mobile agents are just as clickable
 * as desktop ones, only the entry point differs. Thumbnails are real
 * crops of that role's own region from the approved master office image —
 * never a generated icon.
 */
export function AgentsList({ floor, showHero = true }: { floor: OfficeFloorView; showHero?: boolean }) {
  const { selectedRoleId, selectRole } = useAgentSelection();
  const heroAgent: OfficeAgentView | undefined = showHero ? floor.agents.find((a) => isActive(a.status)) : undefined;

  const summary = summarizeVisualAgents(floor.agents);
  return (
    <>
      <div className="mb-3 rounded-xl border border-white/10 bg-[#101827] p-3 text-xs text-slate-200" data-testid="mobile-office-summary">
        <p className="font-mono text-cyan-200">{summary.active ? "LIVE OFFICE" : "OFFICE AT REST"}</p>
        <p className="mt-1">{summary.active} active · {summary.waiting} waiting · {summary.reviewing} reviewing · {summary.blocked} blocked / failed</p>
        <p className="mt-1 text-slate-300">{Object.entries(summary.providers).map(([p,n]) => `${p} ${n}`).join(" · ")}</p>
      </div>
      {heroAgent && (
        <button
          type="button"
          onClick={() => selectRole(heroAgent.roleId)}
          className="relative mb-3 flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-white/10 p-4 text-left shadow-[0_20px_40px_-24px_rgba(0,0,0,0.6)]"
          style={{ background: "radial-gradient(ellipse 90% 80% at 30% 20%, #241f36 0%, #100d18 70%)" }}
        >
          <WorkstationThumb roleId={heroAgent.roleId} sizePx={80} />
          <div className="min-w-0">
            <p className="font-mono text-[0.6rem] tracking-widest text-primary uppercase">Active now</p>
            <p className="truncate text-sm font-semibold text-white">{heroAgent.roleName}</p>
            <p className="truncate text-xs text-white/60">{heroAgent.currentTaskTitle ?? STATUS_LABEL[heroAgent.status]}</p>
          </div>
        </button>
      )}

      <ul className="flex flex-col gap-2 pb-16">
        {floor.agents.map((agent) => {
          const visual = getRoleVisual(agent.roleId);
          return (
            <li key={agent.roleId} data-mobile-agent={agent.roleId} data-state={agent.status}>
              <button
                type="button"
                onClick={() => selectRole(agent.roleId)}
                aria-pressed={selectedRoleId === agent.roleId}
                aria-label={[agent.roleName, agent.status, agent.currentTaskTitle, agent.provider, agent.model].filter(Boolean).join(" — ")}
                style={{ "--role-accent": visual.accent } as React.CSSProperties}
                className="glass flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:border-(--role-accent)/50"
              >
                <WorkstationThumb roleId={agent.roleId} sizePx={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {agent.roleName}
                    {agent.provider === "claude" && (
                      <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 align-middle font-mono text-[0.55rem] tracking-widest text-primary uppercase">
                        Claude
                      </span>
                    )}
                  </p>
                  {agent.provider && <p className="truncate font-mono text-[0.65rem] text-cyan-800 dark:text-cyan-200">{agent.provider} · {agent.model ?? "Model not recorded"}</p>}
                  {agent.attemptCount > 0 && <p className="text-[0.65rem] text-muted-foreground">Attempt {agent.attemptCount}/{agent.maxAttempts ?? "—"}</p>}
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
    </>
  );
}
