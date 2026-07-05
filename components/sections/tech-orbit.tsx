import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OrbitNode {
  icon: LucideIcon;
  label: string;
}

interface TechOrbitProps {
  nodes: OrbitNode[];
  size: number;
  className?: string;
  /** Merged with the computed width/height — lets the caller fluidly scale the ring (e.g. `transform: scale(...)`) while node math stays keyed to `size`. */
  style?: React.CSSProperties;
}

/**
 * A slow, continuously rotating ring of small icon badges around a fixed
 * radius — purely decorative "ambient tech" framing for the hero portrait.
 * Each badge counter-rotates against the ring so the icon itself always
 * stays upright. Pure CSS animation (`.orbit-spin` / `.orbit-counter-spin`
 * in globals.css) rather than a Framer Motion `animate` prop — the global
 * `prefers-reduced-motion` rule freezes it uniformly with no client/server
 * branching, which avoids a hydration mismatch that a `shouldReduceMotion`
 * conditional on `animate` would otherwise introduce (the server can't know
 * the client's media query, so it always renders as if motion is enabled).
 */
export function TechOrbit({ nodes, size, className, style }: TechOrbitProps) {
  const radius = size / 2;

  return (
    <div
      aria-hidden
      className={cn("orbit-spin pointer-events-none absolute", className)}
      style={{ width: size, height: size, ...style }}
    >
      {nodes.map((node, index) => {
        const angle = (index / nodes.length) * 360;
        const rad = (angle * Math.PI) / 180;
        const x = radius + radius * Math.cos(rad);
        const y = radius + radius * Math.sin(rad);
        const Icon = node.icon;

        return (
          <div
            key={node.label}
            className="orbit-counter-spin glass-strong absolute flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-primary"
            style={{ left: x, top: y }}
          >
            <Icon className="size-4" />
          </div>
        );
      })}
    </div>
  );
}
