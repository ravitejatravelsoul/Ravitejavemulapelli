import { cn } from "@/lib/utils";
import { Workstation } from "./workstation";
import type { OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * One work-zone — a soft-lit glass panel holding one or more workstations,
 * with a warm floor-lighting glow that brightens when anyone inside it is
 * actively working. Deliberately not a plain bordered rectangle: a subtle
 * radial light pool anchors it to the "office floor" rather than reading
 * as a generic dashboard card.
 */
export function DepartmentPod({
  title,
  agents,
  onSelectAgent,
  className,
  columns = 1,
  hasProject = true,
}: {
  title: string;
  agents: OfficeAgentView[];
  onSelectAgent: (roleId: string) => void;
  className?: string;
  columns?: 1 | 2;
  hasProject?: boolean;
}) {
  const active = agents.some((a) => a.status === "WORKING" || a.status === "THINKING" || a.status === "REVIEWING");

  return (
    <div
      className={cn(
        "relative flex h-full flex-col gap-2.5 rounded-[1.75rem] border border-border/40 bg-gradient-to-b from-white/[0.04] to-transparent p-3 transition-shadow duration-300",
        active && "border-primary/30 shadow-[0_0_36px_-14px_var(--primary)]",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-4 top-0 h-16 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity duration-500"
        style={{ opacity: active ? 0.7 : 0.15 }}
        aria-hidden="true"
      />
      <p className="relative px-1 font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{title}</p>
      <div className={cn("relative grid flex-1 content-start gap-2.5", columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {agents.map((agent) => (
          <Workstation key={agent.roleId} agent={agent} onSelect={onSelectAgent} hasProject={hasProject} />
        ))}
      </div>
    </div>
  );
}
