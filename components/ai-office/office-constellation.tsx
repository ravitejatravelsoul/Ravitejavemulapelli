import { cn } from "@/lib/utils";

/**
 * Decorative hero backdrop — a fixed "department network" of nodes and
 * connecting lines, evoking a private digital headquarters without
 * depicting any real system internals. Server-rendered, fixed coordinates
 * (no `Math.random()`, matching the hydration-safety approach already used
 * by `Particles`), pure CSS animation via the existing `.breathe-glow` /
 * `.line-pulse` utilities — no new keyframes, no JS, and the site-wide
 * `prefers-reduced-motion` rule in globals.css freezes it automatically.
 */

const NODES = [
  { x: 60, y: 60 },
  { x: 220, y: 30 },
  { x: 380, y: 70 },
  { x: 520, y: 40 },
  { x: 100, y: 190 },
  { x: 300, y: 150 },
  { x: 460, y: 200 },
  { x: 560, y: 160 },
  { x: 200, y: 260 },
  { x: 420, y: 270 },
] as const;

const LINES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [0, 4],
  [1, 5],
  [2, 5],
  [3, 6],
  [3, 7],
  [4, 5],
  [5, 6],
  [6, 7],
  [4, 8],
  [5, 8],
  [5, 9],
  [6, 9],
];

export function OfficeConstellation({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 620 320"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
      preserveAspectRatio="xMidYMid slice"
    >
      <g className="stroke-primary/25" strokeWidth={1}>
        {LINES.map(([fromIndex, toIndex], index) => {
          const from = NODES[fromIndex];
          const to = NODES[toIndex];
          return (
            <line
              key={`${fromIndex}-${toIndex}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="line-pulse"
              style={{ animationDelay: `${(index % 6) * 0.6}s` }}
            />
          );
        })}
      </g>
      {NODES.map((node, index) => (
        <circle
          key={index}
          cx={node.x}
          cy={node.y}
          r={index % 3 === 0 ? 5 : 3.5}
          className={cn("breathe-glow", index % 2 === 0 ? "fill-primary" : "fill-accent-2")}
          style={{ animationDelay: `${(index % 5) * 0.7}s`, transformOrigin: `${node.x}px ${node.y}px` }}
        />
      ))}
    </svg>
  );
}
