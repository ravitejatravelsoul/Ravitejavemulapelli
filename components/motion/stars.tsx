import { cn } from "@/lib/utils";

/**
 * Tiny fixed twinkle points — deliberately distinct from `Particles`: stars
 * twinkle in place (opacity only), particles drift (position + opacity).
 * Two different motions read as two different depth layers rather than one
 * busier version of the same effect. Fixed positions (no `Math.random()`)
 * so server and client markup match exactly.
 */
const STARS = [
  { left: "3%", top: "12%", delay: "0s" },
  { left: "9%", top: "48%", delay: "0.6s" },
  { left: "15%", top: "78%", delay: "1.4s" },
  { left: "22%", top: "24%", delay: "2.1s" },
  { left: "28%", top: "62%", delay: "0.3s" },
  { left: "36%", top: "8%", delay: "1.8s" },
  { left: "41%", top: "88%", delay: "0.9s" },
  { left: "48%", top: "36%", delay: "2.6s" },
  { left: "55%", top: "68%", delay: "1.1s" },
  { left: "61%", top: "18%", delay: "0.4s" },
  { left: "67%", top: "52%", delay: "2.2s" },
  { left: "73%", top: "82%", delay: "1.6s" },
  { left: "79%", top: "30%", delay: "0.7s" },
  { left: "85%", top: "64%", delay: "2.9s" },
  { left: "91%", top: "14%", delay: "1.3s" },
  { left: "95%", top: "46%", delay: "0.2s" },
  { left: "12%", top: "92%", delay: "2.4s" },
  { left: "64%", top: "94%", delay: "1.9s" },
  { left: "33%", top: "40%", delay: "3.1s" },
  { left: "88%", top: "88%", delay: "0.5s" },
] as const;

export function Stars({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {STARS.map((star, index) => (
        <span
          key={index}
          className="star-twinkle absolute size-[3px] rounded-full bg-foreground"
          style={{ left: star.left, top: star.top, animationDelay: star.delay }}
        />
      ))}
    </div>
  );
}
