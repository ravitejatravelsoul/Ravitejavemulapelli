import { cn } from "@/lib/utils";
import { Workstation } from "./workstation";
import type { OfficeAgentView } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * One work-zone — an organic glass "pod" (oversized, asymmetric corner
 * radii rather than a plain rectangle) holding one or more workstations.
 * Deliberately not a dashboard card: no border-all-four-sides-equal, no
 * uniform box shadow — a soft glow instead, consistent with the site's
 * `.glass`/glow-field language.
 */
export function DepartmentPod({
  title,
  agents,
  onSelectAgent,
  className,
  emphasis = false,
}: {
  title: string;
  agents: OfficeAgentView[];
  onSelectAgent: (roleId: string) => void;
  className?: string;
  emphasis?: boolean;
}) {
  const active = agents.some((a) => a.status === "WORKING" || a.status === "THINKING" || a.status === "REVIEWING");

  return (
    <div
      className={cn(
        "glass relative flex flex-col gap-2 rounded-[2rem] p-3 transition-shadow",
        emphasis && "rounded-[3rem] border-primary/30",
        active && "shadow-[0_0_28px_-8px_var(--primary)]",
        className,
      )}
    >
      <p className="px-1 text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">{title}</p>
      <div className="flex flex-1 flex-wrap items-start justify-center gap-2">
        {agents.map((agent) => (
          <div key={agent.roleId} className="w-[5.5rem]">
            <Workstation agent={agent} onSelect={onSelectAgent} />
          </div>
        ))}
      </div>
    </div>
  );
}
