import { PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { stripPlaceholderPrefix } from "@/lib/placeholder";

/** Dashed "draft" treatment for body-copy placeholders — reads as an intentional to-do, not broken content. */
export function PlaceholderNote({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-start gap-2 rounded-xl border border-dashed border-primary/35 bg-primary/[0.06] px-4 py-3 text-sm text-muted-foreground italic",
        className,
      )}
    >
      <PenLine className="mt-0.5 size-3.5 shrink-0 text-primary/70" />
      {stripPlaceholderPrefix(text)}
    </span>
  );
}

/** Small pill marking display-weight text (headlines) as a draft, without shrinking the type. */
export function DraftBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary/40 bg-primary/[0.06] px-2.5 py-1 font-mono text-[10px] font-medium tracking-wide text-primary/80 uppercase",
        className,
      )}
    >
      <PenLine className="size-3" />
      Draft — replace me
    </span>
  );
}
