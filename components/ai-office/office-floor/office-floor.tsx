"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DepartmentPod } from "./department-pod";
import { Connector } from "./connector";
import { OfficeProjectStrip } from "./office-project-strip";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import type { OfficeFloorView, AgentDetailView } from "@/lib/ai-office/dashboard/office-floor-data";

type DeptKey = "command" | "product" | "design" | "engineering" | "quality" | "review" | "release";

const DEPARTMENTS: { key: DeptKey; title: string; roleIds: string[] }[] = [
  { key: "command", title: "Central Command", roleIds: ["orchestrator"] },
  { key: "product", title: "Product & Research", roleIds: ["product-owner", "research-agent"] },
  { key: "design", title: "Design & Architecture", roleIds: ["solution-architect", "ui-ux-agent"] },
  { key: "engineering", title: "Engineering", roleIds: ["frontend-developer", "backend-developer"] },
  { key: "quality", title: "Quality", roleIds: ["qa-agent"] },
  { key: "review", title: "Review & Security", roleIds: ["security-reviewer", "code-reviewer"] },
  { key: "release", title: "Release", roleIds: ["release-agent"] },
];

function isDeptActive(agents: OfficeFloorView["agents"], roleIds: string[]): boolean {
  return agents.some((a) => roleIds.includes(a.roleId) && (a.status === "WORKING" || a.status === "THINKING" || a.status === "REVIEWING"));
}

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

  const byDept = new Map(DEPARTMENTS.map((d) => [d.key, floor.agents.filter((a) => d.roleIds.includes(a.roleId))]));
  const dept = (key: DeptKey) => byDept.get(key) ?? [];
  const active = (key: DeptKey) => !isClosed && isDeptActive(floor.agents, DEPARTMENTS.find((d) => d.key === key)!.roleIds);

  return (
    <div className="flex flex-col gap-3">
      <OfficeProjectStrip floor={floor} />

      <div className={cn("glass-strong relative overflow-hidden rounded-[2.5rem] p-4 transition-[filter,opacity] sm:p-6", isClosed && "opacity-70 grayscale-[0.6]")}>
        {isClosed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40" aria-hidden="true">
            <span className="glass-strong rounded-full px-4 py-1.5 font-mono text-xs tracking-widest text-muted-foreground uppercase">Office closed</span>
          </div>
        )}
        <div className="grid-pattern grid-fade-mask pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />

        <div className="relative flex flex-col gap-0">
          <DepartmentPod title="Central Command" agents={dept("command")} onSelectAgent={setSelectedRoleId} emphasis className="mx-auto w-full max-w-xs" />
          <Connector active={active("product") || active("design")} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DepartmentPod title="Product & Research" agents={dept("product")} onSelectAgent={setSelectedRoleId} />
            <DepartmentPod title="Design & Architecture" agents={dept("design")} onSelectAgent={setSelectedRoleId} />
          </div>
          <Connector active={active("engineering")} />

          <DepartmentPod title="Engineering" agents={dept("engineering")} onSelectAgent={setSelectedRoleId} />
          <Connector active={active("quality") || active("review")} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DepartmentPod title="Quality" agents={dept("quality")} onSelectAgent={setSelectedRoleId} />
            <DepartmentPod title="Review & Security" agents={dept("review")} onSelectAgent={setSelectedRoleId} />
          </div>
          <Connector active={active("release")} />

          <DepartmentPod title="Release" agents={dept("release")} onSelectAgent={setSelectedRoleId} className="mx-auto w-full max-w-xs" />
        </div>
      </div>

      <AgentDetailDrawer detail={selectedRoleId ? (agentDetails[selectedRoleId] ?? null) : null} onOpenChange={(open) => !open && setSelectedRoleId(null)} />
    </div>
  );
}
