import { Lock } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";

/**
 * The one section on this page that must never be softened or cut —
 * the explicit ownership/privacy disclosure required by
 * docs/ai-office/01-product-spec.md §4.1.
 */
export function OwnershipBanner() {
  return (
    <GlassCard className="glass-strong flex flex-col items-center gap-4 border-primary/20 py-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Lock className="size-5" />
      </div>
      <p className="max-w-xl text-pretty text-lg leading-relaxed font-medium">
        Teja&apos;s AI Office is a privately operated workspace belonging to Raviteja Vemulapelli.
      </p>
      <p className="max-w-lg text-pretty text-sm text-muted-foreground">
        It is not a public product or service. There is no public signup and no guest access —
        only the owner can operate it.
      </p>
    </GlassCard>
  );
}
