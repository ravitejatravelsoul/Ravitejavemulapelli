import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";

/**
 * Shown instead of a page's real content in Remote Mode, for the small
 * set of capabilities that are genuinely local-machine-only (Ollama,
 * office-wide incident history, Twilio telephony) — never faked or
 * silently hidden. Keeps the page at its normal nav location per the
 * unified-shell requirement: Remote Mode shows an honest "unavailable
 * here" state rather than a second, different Office product.
 */
export function LocalOnlyNotice({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
          Local Only
        </Badge>
      </div>
      <GlassCard className="p-4 text-sm text-muted-foreground">
        <p>{reason}</p>
        <p className="mt-2">This runs from your local machine — switch to Local Mode (unset AI_OFFICE_EXECUTION_MODE) to use it.</p>
      </GlassCard>
    </div>
  );
}
