import { cn } from "@/lib/utils";
import type { OfficeAgentVisualStatus } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * A small, internally-authored stylized worker at a desk — plain SVG
 * shapes only (no external art), one shared silhouette whose animation
 * changes per real status via CSS classes. Every loop here is a plain CSS
 * `@keyframes` (see app/globals.css's "office-floor agent animations"),
 * so the site's existing blanket `prefers-reduced-motion` rule
 * (`* { animation-duration: 0.01ms !important }`) neutralizes all of it
 * for free — nothing here needs its own reduced-motion branch.
 */

const MONITOR_GLOW: Record<OfficeAgentVisualStatus, string> = {
  IDLE: "fill-muted-foreground/25",
  WORKING: "fill-primary animate-glow-pulse",
  THINKING: "fill-accent-2 animate-glow-pulse",
  REVIEWING: "fill-accent-2 animate-glow-pulse",
  WAITING: "fill-muted-foreground/30",
  BLOCKED: "fill-destructive/70",
  DONE: "fill-[oklch(0.7_0.17_150)]",
  PAUSED: "fill-muted-foreground/15",
};

const BODY_TONE: Record<OfficeAgentVisualStatus, string> = {
  IDLE: "fill-muted-foreground/60",
  WORKING: "fill-foreground/80",
  THINKING: "fill-foreground/80",
  REVIEWING: "fill-foreground/80",
  WAITING: "fill-muted-foreground/50",
  BLOCKED: "fill-destructive/80",
  DONE: "fill-foreground/80",
  PAUSED: "fill-muted-foreground/30",
};

export function AgentCharacter({ status, className }: { status: OfficeAgentVisualStatus; className?: string }) {
  const bodyTone = BODY_TONE[status];
  const monitorGlow = MONITOR_GLOW[status];
  const isTyping = status === "WORKING";
  const isBreathing = status === "IDLE" || status === "WAITING";
  const isDone = status === "DONE";

  return (
    <svg viewBox="0 0 64 56" aria-hidden="true" className={cn("size-full overflow-visible", isDone && "animate-done-pulse", className)}>
      {/* desk */}
      <rect x="6" y="38" width="52" height="4" rx="1.5" className="fill-border" />
      <rect x="10" y="42" width="3" height="10" className="fill-border/70" />
      <rect x="51" y="42" width="3" height="10" className="fill-border/70" />

      {/* monitor */}
      <g className={isTyping ? "" : undefined}>
        <rect x="20" y="20" width="24" height="16" rx="1.5" className="fill-card stroke-border" strokeWidth="1" />
        <rect x="22" y="22" width="20" height="12" rx="1" className={monitorGlow} />
        <rect x="30" y="36" width="4" height="3" className="fill-border" />
      </g>

      {/* chair back */}
      <rect x="26" y="20" width="12" height="14" rx="4" className="fill-muted/70" />

      {/* body (breathes when idle/waiting) */}
      <g className={isBreathing ? "animate-icon-breathe" : undefined} style={{ transformOrigin: "32px 34px" }}>
        <rect x="26" y="26" width="12" height="12" rx="4" className={bodyTone} />
        <circle cx="32" cy="18" r="6" className={bodyTone} />
      </g>

      {/* arms/hands — bounce when typing */}
      <rect x="22" y="30" width="6" height="3" rx="1.5" className={cn(bodyTone, isTyping && "animate-typing-bounce")} />
      <rect x="36" y="30" width="6" height="3" rx="1.5" className={cn(bodyTone, isTyping && "animate-typing-bounce")} style={{ animationDelay: "0.3s" }} />
    </svg>
  );
}
