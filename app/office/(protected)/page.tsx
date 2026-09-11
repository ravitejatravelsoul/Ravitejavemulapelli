import { Construction } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";

/**
 * Deliberate placeholder, not a dashboard. Per the Phase 1 + minimal Phase
 * 2 checkpoint (docs/ai-office/11-implementation-phases.md Phase 2, task 1),
 * this page only needs to prove the session boundary works end to end — the
 * populated dashboard (office status, budget, live activity feed, agent
 * workstations) is out of scope until Phase 3+ has real data to show. No
 * project, task, or budget data is faked here — an empty state is more
 * honest than a mocked one that could be mistaken for real.
 */
export default function OfficeHomePage() {
  return (
    <div className="mx-auto max-w-lg text-center">
      <GlassCard>
        <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
          <Construction className="size-5" />
        </div>
        <h1 className="mt-5 text-lg font-semibold tracking-tight">You&apos;re signed in.</h1>
        <p className="mt-3 text-pretty text-sm text-muted-foreground">
          This is a placeholder landing screen — not the real dashboard. The office status board,
          project workspace, and agent activity feed are built in later phases. Nothing shown here
          represents real project data.
        </p>
      </GlassCard>
    </div>
  );
}
