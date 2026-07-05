import { cn } from "@/lib/utils";

/**
 * Slow-drifting mesh-gradient backdrop. Pure CSS (no JS/motion runtime
 * needed) — two blurred blobs animating on the compositor thread, frozen by
 * the site-wide `prefers-reduced-motion` rule in globals.css.
 */
export function AnimatedGradient({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      <div className="animate-blob-a absolute top-[-10%] left-[8%] h-[420px] w-[420px] rounded-full bg-primary/25 blur-[110px]" />
      <div className="animate-blob-b absolute top-[5%] right-[5%] h-[380px] w-[380px] rounded-full bg-accent-2/20 blur-[110px]" />
    </div>
  );
}
