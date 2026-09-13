import { ClipboardList, Search, Network, Palette, Code2, Server, Bug, ShieldCheck, GitPullRequest, Rocket, Crown, type LucideIcon } from "lucide-react";

/**
 * One consistent visual identity per agent role — an icon + an accent hue
 * (real oklch colors, matched to the app's existing palette range) so the
 * 11 workstations read as distinct AI employees at a glance instead of
 * identical gray cards. Hues are spread ~25-40deg apart around the wheel
 * and kept at the same moderate lightness/chroma the rest of the app uses,
 * per the "restrained accents, not neon cyberpunk" visual language.
 */
export interface RoleVisual {
  icon: LucideIcon;
  accent: string;
}

export const ROLE_VISUALS: Record<string, RoleVisual> = {
  orchestrator: { icon: Crown, accent: "oklch(0.64 0.19 280)" },
  "product-owner": { icon: ClipboardList, accent: "oklch(0.78 0.14 75)" },
  "research-agent": { icon: Search, accent: "oklch(0.72 0.12 230)" },
  "solution-architect": { icon: Network, accent: "oklch(0.66 0.17 300)" },
  "ui-ux-agent": { icon: Palette, accent: "oklch(0.72 0.15 340)" },
  "frontend-developer": { icon: Code2, accent: "oklch(0.75 0.13 205)" },
  "backend-developer": { icon: Server, accent: "oklch(0.7 0.15 50)" },
  "qa-agent": { icon: Bug, accent: "oklch(0.7 0.17 150)" },
  "security-reviewer": { icon: ShieldCheck, accent: "oklch(0.58 0.1 255)" },
  "code-reviewer": { icon: GitPullRequest, accent: "oklch(0.68 0.15 320)" },
  "release-agent": { icon: Rocket, accent: "oklch(0.78 0.14 95)" },
};

const FALLBACK: RoleVisual = { icon: Crown, accent: "oklch(0.64 0.19 280)" };

export function getRoleVisual(roleId: string): RoleVisual {
  return ROLE_VISUALS[roleId] ?? FALLBACK;
}
