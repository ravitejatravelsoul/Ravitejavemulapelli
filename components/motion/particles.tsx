import { cn } from "@/lib/utils";

/**
 * Fixed (non-random) positions — this renders on the server, so anything
 * seeded from `Math.random()` would mismatch on hydration. Pure CSS
 * animation (`.particle-float`), no JS runtime needed.
 */
const PARTICLES = [
  { left: "6%", top: "18%", size: 5, delay: "0s", duration: "9s", x: "10px", y: "-18px", color: "primary" },
  { left: "18%", top: "72%", size: 3, delay: "1.1s", duration: "11s", x: "-8px", y: "-22px", color: "accent-2" },
  { left: "32%", top: "10%", size: 4, delay: "2.3s", duration: "8s", x: "12px", y: "-16px", color: "primary" },
  { left: "46%", top: "82%", size: 5, delay: "0.5s", duration: "10s", x: "-10px", y: "-20px", color: "accent-2" },
  { left: "58%", top: "30%", size: 3, delay: "3s", duration: "12s", x: "8px", y: "-24px", color: "primary" },
  { left: "71%", top: "58%", size: 5, delay: "1.7s", duration: "9.5s", x: "-12px", y: "-18px", color: "primary" },
  { left: "84%", top: "20%", size: 3, delay: "0.3s", duration: "10.5s", x: "10px", y: "-22px", color: "accent-2" },
  { left: "92%", top: "70%", size: 4, delay: "2.1s", duration: "8.5s", x: "-8px", y: "-16px", color: "primary" },
  { left: "12%", top: "44%", size: 3, delay: "3.4s", duration: "11.5s", x: "12px", y: "-20px", color: "accent-2" },
  { left: "53%", top: "8%", size: 4, delay: "1.4s", duration: "9s", x: "-10px", y: "-18px", color: "primary" },
  { left: "77%", top: "88%", size: 5, delay: "2.6s", duration: "10s", x: "8px", y: "-22px", color: "accent-2" },
  { left: "38%", top: "54%", size: 3, delay: "0.8s", duration: "8.8s", x: "-12px", y: "-16px", color: "primary" },
] as const;

/**
 * Soft ambient drift, not decorative dots — small blurred glow points, each
 * with a randomized-looking (but fixed, server-safe) drift direction and its
 * own duration/delay so the field never reads as one repeating loop.
 */
export function Particles({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      {PARTICLES.map((p, index) => (
        <span
          key={index}
          className={cn(
            "particle-float absolute rounded-full",
            p.color === "primary" ? "bg-primary/70" : "bg-accent-2/70",
          )}
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            animationDelay: p.delay,
            animationDuration: p.duration,
            boxShadow: `0 0 ${p.size * 3}px ${p.size}px color-mix(in oklch, var(--${p.color}) 35%, transparent)`,
            ["--particle-x" as string]: p.x,
            ["--particle-y" as string]: p.y,
          }}
        />
      ))}
    </div>
  );
}
