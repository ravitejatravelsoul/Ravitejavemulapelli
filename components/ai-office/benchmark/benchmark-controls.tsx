"use client";

import { ActionButton } from "@/components/ai-office/action-button";
import { runBenchmarkAction, generateRecommendedRoutingAction } from "@/app/office/actions/benchmark";
import { applyRecommendedRoutingAction } from "@/app/office/actions/model-routing";

export function BenchmarkControls({ hasResults }: { hasResults: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton
        action={runBenchmarkAction}
        variant="default"
        size="sm"
        successMessage="Benchmark complete — results below."
        confirmMessage="This runs all 6 scenarios against every installed local model, one at a time. On a CPU-only machine this can take several minutes. Continue?"
      >
        Run Benchmark
      </ActionButton>
      <ActionButton action={generateRecommendedRoutingAction} variant="outline" size="sm" successMessage="Recommendation generated." disabled={!hasResults}>
        Generate Recommendation
      </ActionButton>
      <ActionButton
        action={applyRecommendedRoutingAction}
        variant="outline"
        size="sm"
        successMessage="Recommended routing applied — AUTO mode now uses it."
        confirmMessage="Apply the current recommended routing? This changes what AUTO mode uses for every project going forward."
      >
        Apply Recommended Routing
      </ActionButton>
    </div>
  );
}
