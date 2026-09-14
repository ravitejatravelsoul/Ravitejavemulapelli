import Link from "next/link";
import { Plus, Radio, RadioTower } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ai-office/action-button";
import { openOfficeAction, closeOfficeAction } from "@/app/office/actions/office";
import type { OfficeState } from "@/lib/ai-office/domain/office";
import type { RunnerActivityView } from "@/lib/ai-office/dashboard/dashboard-data";

export function CommandBar({ officeState, runnerActivity }: { officeState: OfficeState; runnerActivity: RunnerActivityView }) {
  const isOpen = officeState === "OPEN";

  return (
    <GlassCard className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`flex size-9 items-center justify-center rounded-full ${isOpen ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {isOpen ? <RadioTower className="size-4" /> : <Radio className="size-4" />}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold tracking-tight">Teja&apos;s AI Office</p>
            <Badge variant={isOpen ? "default" : "outline"}>{isOpen ? "OPEN" : "CLOSED"}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{runnerActivity.message}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono text-[0.65rem] tracking-wide uppercase">
          Mode: SIMULATED
        </Badge>
        <Badge variant="secondary" className="font-mono text-[0.65rem] tracking-wide uppercase">
          $0 live AI spend
        </Badge>
        <Button asChild size="sm">
          <Link href="/office/projects/new">
            <Plus className="size-3.5" />
            Start New Project
          </Link>
        </Button>
        {isOpen ? (
          <ActionButton action={closeOfficeAction} variant="outline" size="sm">
            Close Office
          </ActionButton>
        ) : (
          <ActionButton action={openOfficeAction} variant="outline" size="sm">
            Open Office
          </ActionButton>
        )}
      </div>
    </GlassCard>
  );
}
