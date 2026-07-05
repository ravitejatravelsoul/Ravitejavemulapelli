import { cn } from "@/lib/utils";

interface SectionDividerProps {
  variant?: "line" | "curve";
  className?: string;
}

/** Restrained section break — a gradient hairline by default, or a soft curved seam. No motion; this is a visual-rhythm tool, not an animation. */
export function SectionDivider({ variant = "line", className }: SectionDividerProps) {
  if (variant === "curve") {
    return (
      <div aria-hidden className={cn("relative h-16 w-full overflow-hidden", className)}>
        <svg
          viewBox="0 0 1440 64"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <path
            d="M0,32 C360,64 1080,0 1440,32 L1440,64 L0,64 Z"
            fill="var(--border)"
            fillOpacity="0.4"
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        "mx-auto h-px w-full max-w-6xl bg-gradient-to-r from-transparent via-border to-transparent",
        className,
      )}
    />
  );
}
