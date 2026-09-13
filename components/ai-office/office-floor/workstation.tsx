"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { getRoleVisual } from "./role-visuals";
import type { OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * Status text always accompanies the color (never color-only) — the dot
 * and label both change, and the label itself is the accessible text.
 */
const STATUS_META: Record<OfficeAgentView["status"], { label: string; dot: string }> = {
  IDLE: { label: "Idle", dot: "bg-muted-foreground/50" },
  WORKING: { label: "Working", dot: "bg-primary" },
  THINKING: { label: "Thinking", dot: "bg-accent-2" },
  REVIEWING: { label: "Reviewing", dot: "bg-accent-2" },
  WAITING: { label: "Waiting", dot: "bg-[oklch(0.78_0.14_75)]" },
  BLOCKED: { label: "Blocked", dot: "bg-destructive" },
  DONE: { label: "Done", dot: "bg-[oklch(0.7_0.17_150)]" },
  PAUSED: { label: "Paused", dot: "bg-muted-foreground/30" },
};

function screenText(agent: OfficeAgentView, hasProject: boolean): string {
  if (agent.currentTaskTitle) return agent.currentTaskTitle;
  if (agent.status === "BLOCKED") return "Blocked — waiting on remediation";
  if (agent.status === "DONE" && agent.lastCompletedTaskTitle) return `Done — ${agent.lastCompletedTaskTitle}`;
  if (agent.status === "PAUSED") return "Paused";
  if (agent.status === "WAITING") return "Waiting for its turn";
  if (agent.lastCompletedTaskTitle) return `Last: ${agent.lastCompletedTaskTitle}`;
  return hasProject ? "Not assigned in this project" : "No active project";
}

export function Workstation({
  agent,
  onSelect,
  emphasis = false,
  hasProject = true,
}: {
  agent: OfficeAgentView;
  onSelect: (roleId: string) => void;
  emphasis?: boolean;
  hasProject?: boolean;
}) {
  const meta = STATUS_META[agent.status];
  const visual = getRoleVisual(agent.roleId);
  const Icon = visual.icon;
  const dimmed = agent.status === "PAUSED";
  const isActive = agent.status === "WORKING" || agent.status === "THINKING" || agent.status === "REVIEWING";

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.roleId)}
      style={{ "--role-accent": visual.accent } as CSSProperties}
      className={cn(
        "group relative flex w-full flex-col gap-2 overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card/80 to-card/30 p-3 text-left shadow-[0_10px_28px_-16px_rgba(0,0,0,0.7)] transition-all duration-200 hover:-translate-y-0.5 hover:border-(--role-accent)/50 hover:shadow-[0_14px_32px_-14px_var(--role-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        emphasis && "p-4",
        dimmed && "opacity-45 saturate-50",
      )}
      aria-label={`${agent.roleName}, ${meta.label}${agent.currentTaskTitle ? `: ${agent.currentTaskTitle}` : ""}`}
    >
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "var(--role-accent)" }} aria-hidden="true" />
      {isActive && (
        <span
          className="pointer-events-none absolute -inset-px animate-accent-glow-pulse rounded-2xl"
          style={{ boxShadow: "inset 0 0 0 1px var(--role-accent), 0 0 26px -6px var(--role-accent)" }}
          aria-hidden="true"
        />
      )}

      <div className="relative flex items-center gap-2.5">
        <span
          className={cn("flex shrink-0 items-center justify-center rounded-lg", emphasis ? "size-10" : "size-8")}
          style={{ background: "color-mix(in oklch, var(--role-accent) 20%, transparent)", color: "var(--role-accent)" }}
        >
          <Icon className={emphasis ? "size-5" : "size-4"} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              "font-semibold tracking-tight text-foreground",
              emphasis ? "text-sm leading-snug break-words sm:text-base" : "truncate text-sm",
            )}
          >
            {agent.roleName}
          </p>
          <span className="flex items-center gap-1 text-[0.65rem] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden="true" />
            {meta.label}
          </span>
        </div>
        {agent.provider === "claude" && (
          <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[0.55rem] tracking-widest text-primary uppercase">
            Claude
          </span>
        )}
      </div>

      <div className="relative flex min-h-11 flex-col justify-center overflow-hidden rounded-lg border border-border/50 bg-black/35 px-2.5 py-2 dark:bg-black/50">
        <p className="line-clamp-2 text-[0.7rem] leading-snug text-foreground/75">{screenText(agent, hasProject)}</p>
        {agent.status === "REVIEWING" && (
          <span className="absolute inset-x-2 top-1.5 h-[3px] overflow-hidden rounded-full bg-white/5" aria-hidden="true">
            <span className="block h-full w-1/3 rounded-full animate-scan-sweep" style={{ background: "var(--role-accent)" }} />
          </span>
        )}
        {agent.status === "WORKING" && (
          <span className="absolute right-2 bottom-1.5 flex items-end gap-0.5" aria-hidden="true">
            <span className="h-2 w-0.5 rounded-full animate-typing-bounce" style={{ background: "var(--role-accent)" }} />
            <span className="h-2 w-0.5 rounded-full animate-typing-bounce [animation-delay:0.15s]" style={{ background: "var(--role-accent)" }} />
            <span className="h-2 w-0.5 rounded-full animate-typing-bounce [animation-delay:0.3s]" style={{ background: "var(--role-accent)" }} />
          </span>
        )}
        {agent.status === "DONE" && (
          <span className="absolute right-2 bottom-1.5 size-3 animate-done-pulse rounded-full" style={{ background: "oklch(0.7 0.17 150)" }} aria-hidden="true" />
        )}
      </div>
    </button>
  );
}
