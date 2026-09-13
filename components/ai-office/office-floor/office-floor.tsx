"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DepartmentPod } from "./department-pod";
import { CentralCommandPod } from "./central-command-pod";
import { Connector } from "./connector";
import { OfficeProjectStrip } from "./office-project-strip";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import type { OfficeFloorView, AgentDetailView } from "@/lib/ai-office/dashboard/office-floor-data";

type DeptKey = "product" | "design" | "engineering" | "quality" | "release";

const DEPARTMENTS: { key: DeptKey; title: string; roleIds: string[] }[] = [
  { key: "product", title: "Product & Research", roleIds: ["product-owner", "research-agent"] },
  { key: "design", title: "Design & Architecture", roleIds: ["solution-architect", "ui-ux-agent"] },
  { key: "engineering", title: "Engineering", roleIds: ["frontend-developer", "backend-developer"] },
  { key: "quality", title: "Quality & Security", roleIds: ["qa-agent", "security-reviewer"] },
  { key: "release", title: "Review & Release", roleIds: ["code-reviewer", "release-agent"] },
];

function isDeptActive(agents: OfficeFloorView["agents"], roleIds: string[]): boolean {
  return agents.some((a) => roleIds.includes(a.roleId) && (a.status === "WORKING" || a.status === "THINKING" || a.status === "REVIEWING"));
}

/**
 * The living office floor — idea flows top-to-bottom, left-to-right:
 * Central Command coordinates, then Product & Research / Design &
 * Architecture / Engineering / Quality & Security sit side by side as one
 * visual row the eye can scan across, and Review & Release closes the
 * loop at the bottom. Every zone, glow, and connector is driven entirely
 * by real per-role status from `getOfficeFloorView()` — nothing here is
 * decorative-only except the ambient background wash.
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

  const byDept = new Map(DEPARTMENTS.map((d) => [d.key, floor.agents.filter((a) => d.roleIds.includes(a.roleId))]));
  const dept = (key: DeptKey) => byDept.get(key) ?? [];
  const active = (key: DeptKey) => !isClosed && isDeptActive(floor.agents, DEPARTMENTS.find((d) => d.key === key)!.roleIds);
  const orchestrator = floor.agents.find((a) => a.roleId === "orchestrator");
  const anyRowActive = (["product", "design", "engineering", "quality"] as DeptKey[]).some(active);
  const hasProject = floor.selectedProject !== null;

  return (
    <div className="flex flex-col gap-3">
      <OfficeProjectStrip floor={floor} />

      <div
        className={cn(
          "glass-strong relative overflow-hidden rounded-[2.5rem] p-4 transition-[filter,opacity] sm:p-6 lg:p-8",
          isClosed && "opacity-70 grayscale-[0.6]",
        )}
      >
        {isClosed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40" aria-hidden="true">
            <span className="glass-strong rounded-full px-4 py-1.5 font-mono text-xs tracking-widest text-muted-foreground uppercase">Office closed</span>
          </div>
        )}

        {/* Ambient office lighting — a floor wash plus two soft corner light
            pools for depth, entirely decorative and non-interactive. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="grid-pattern grid-fade-mask absolute inset-0 opacity-25" />
          <div
            className="absolute -top-24 -left-16 h-72 w-72 rounded-full blur-[90px] transition-opacity duration-700"
            style={{ background: "oklch(0.64 0.19 280 / 30%)", opacity: anyRowActive ? 0.9 : 0.45 }}
          />
          <div
            className="absolute -right-20 bottom-0 h-64 w-64 rounded-full blur-[90px]"
            style={{ background: "oklch(0.78 0.14 75 / 22%)" }}
          />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/25 to-transparent dark:from-black/40" />
        </div>

        <div className="relative flex flex-col gap-1">
          <CentralCommandPod agent={orchestrator} floor={floor} onSelectAgent={setSelectedRoleId} />
          <Connector active={anyRowActive} />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <DepartmentPod title="Product & Research" agents={dept("product")} onSelectAgent={setSelectedRoleId} hasProject={hasProject} />
            <DepartmentPod title="Design & Architecture" agents={dept("design")} onSelectAgent={setSelectedRoleId} hasProject={hasProject} />
            <DepartmentPod title="Engineering" agents={dept("engineering")} onSelectAgent={setSelectedRoleId} hasProject={hasProject} />
            <DepartmentPod title="Quality & Security" agents={dept("quality")} onSelectAgent={setSelectedRoleId} hasProject={hasProject} />
          </div>

          <Connector active={active("release")} />
          <div className="mx-auto w-full max-w-2xl">
            <DepartmentPod title="Review & Release" agents={dept("release")} onSelectAgent={setSelectedRoleId} columns={2} hasProject={hasProject} />
          </div>
        </div>
      </div>

      <AgentDetailDrawer detail={selectedRoleId ? (agentDetails[selectedRoleId] ?? null) : null} onOpenChange={(open) => !open && setSelectedRoleId(null)} />
    </div>
  );
}
