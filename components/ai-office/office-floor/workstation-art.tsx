import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { OfficeAgentVisualStatus } from "@/lib/ai-office/dashboard/office-floor-data";

/**
 * A hand-illustrated desk + chair + synthetic character + monitor, drawn
 * entirely in flat-illustration SVG (no external art, no raster assets to
 * ship) — the primary visual representation of an AI role, replacing the
 * earlier icon+card treatment. Every role gets a different monitor-screen
 * motif and a small desk-side prop so the workstation reads as that role
 * before anyone reads its label. Colors are fixed to a dark, warm/cool
 * "office at night" palette regardless of the site's light/dark theme —
 * the Living Office is deliberately always cinematic.
 */

const DESK = "#241f33";
const DESK_TOP = "#342c4a";
const MONITOR_BEZEL = "#100e17";
const CHAIR = "#1c1926";
const HEAD = "#c9cfdc";
const HEAD_SHADOW = "#a9b0c2";
const NEUTRAL_LINE = "rgba(255,255,255,0.35)";
const NEUTRAL_LINE_DIM = "rgba(255,255,255,0.16)";

type ScreenFn = () => React.ReactNode;
type PropFn = () => React.ReactNode;

/** Small role-specific mockup drawn inside the monitor, local coords 0..78 x 0..40. */
const SCREEN_CONTENT: Record<string, ScreenFn> = {
  orchestrator: () => (
    <>
      <rect x="2" y="2" width="34" height="16" rx="2" fill="currentColor" opacity="0.35" />
      <rect x="40" y="2" width="34" height="16" rx="2" fill="currentColor" opacity="0.22" />
      <rect x="2" y="22" width="34" height="16" rx="2" fill="currentColor" opacity="0.22" />
      <rect x="40" y="22" width="34" height="16" rx="2" fill="currentColor" opacity="0.35" />
    </>
  ),
  "product-owner": () => (
    <>
      {[0, 1, 2].map((c) =>
        [0, 1].map((r) => (
          <rect key={`${c}-${r}`} x={2 + c * 26} y={2 + r * 20} width="22" height="16" rx="2" fill="currentColor" opacity={(c + r) % 2 === 0 ? 0.4 : 0.2} />
        )),
      )}
    </>
  ),
  "research-agent": () => (
    <>
      <circle cx="68" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      <line x1="72" y1="12" x2="76" y2="16" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x="2" y={3 + i * 9} width={50 - i * 8} height="4" rx="2" fill={NEUTRAL_LINE_DIM} />
      ))}
    </>
  ),
  "solution-architect": () => (
    <>
      <line x1="10" y1="10" x2="38" y2="10" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <line x1="38" y1="10" x2="38" y2="30" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <line x1="38" y1="30" x2="66" y2="30" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <line x1="38" y1="10" x2="66" y2="10" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <circle cx="10" cy="10" r="4" fill="currentColor" opacity="0.6" />
      <circle cx="38" cy="10" r="4" fill="currentColor" opacity="0.6" />
      <circle cx="66" cy="10" r="4" fill="currentColor" opacity="0.6" />
      <circle cx="38" cy="30" r="4" fill="currentColor" opacity="0.6" />
      <circle cx="66" cy="30" r="4" fill="currentColor" opacity="0.6" />
    </>
  ),
  "ui-ux-agent": () => (
    <>
      <rect x="2" y="2" width="46" height="36" rx="2" fill="none" stroke={NEUTRAL_LINE_DIM} strokeWidth="1.5" />
      <rect x="6" y="6" width="20" height="10" rx="1.5" fill="currentColor" opacity="0.4" />
      <rect x="6" y="20" width="38" height="4" rx="2" fill={NEUTRAL_LINE_DIM} />
      <rect x="6" y="28" width="26" height="4" rx="2" fill={NEUTRAL_LINE_DIM} />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx={58 + i * 6} cy="10" r="3" fill="currentColor" opacity={0.3 + i * 0.15} />
      ))}
    </>
  ),
  "frontend-developer": () => (
    <>
      <rect x="0" y="0" width="78" height="8" rx="2" fill="rgba(255,255,255,0.08)" />
      <circle cx="4" cy="4" r="1.4" fill={NEUTRAL_LINE} />
      <circle cx="9" cy="4" r="1.4" fill={NEUTRAL_LINE} />
      <circle cx="14" cy="4" r="1.4" fill={NEUTRAL_LINE} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={4 + (i % 2) * 4} y={13 + i * 6} width={30 - i * 4} height="3" rx="1.5" fill="currentColor" opacity={i % 2 === 0 ? 0.55 : 0.3} />
      ))}
    </>
  ),
  "backend-developer": () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <text x="2" y={9 + i * 8} fontSize="7" fill="currentColor" opacity="0.55" fontFamily="monospace">
            &gt;
          </text>
          <rect x="9" y={5 + i * 8} width={42 - i * 6} height="3" rx="1.5" fill={NEUTRAL_LINE_DIM} />
        </g>
      ))}
      <ellipse cx="66" cy="10" rx="9" ry="3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <path d="M57 10v14a9 3 0 0 0 18 0V10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
    </>
  ),
  "qa-agent": () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="2" y={2 + i * 9} width="7" height="7" rx="1.5" fill={i === 2 ? "#e0625f" : "currentColor"} opacity={i === 2 ? 0.85 : 0.5} />
          {i !== 2 && (
            <path d={`M3.5 ${5.5 + i * 9} L4.7 ${6.7 + i * 9} L7 ${4 + i * 9}`} stroke="#0b0a12" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
          <rect x="13" y={3.5 + i * 9} width={52 - i * 6} height="4" rx="2" fill={NEUTRAL_LINE_DIM} />
        </g>
      ))}
    </>
  ),
  "security-reviewer": () => (
    <>
      <path d="M39 2 L58 8 V20 C58 30 50 36 39 39 C28 36 20 30 20 20 V8 Z" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.65" />
      <path d="M31 20 l6 6 12 -14" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.85" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "code-reviewer": () => (
    <>
      {[0, 1, 2].map((i) => (
        <rect key={`p-${i}`} x="4" y={3 + i * 12} width={38 - i * 4} height="4" rx="2" fill="#6fbf8a" opacity="0.65" />
      ))}
      {[0, 1].map((i) => (
        <rect key={`m-${i}`} x="46" y={7 + i * 12} width={28 - i * 6} height="4" rx="2" fill="#d9756f" opacity="0.65" />
      ))}
    </>
  ),
  "release-agent": () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="2" y={3 + i * 8} width="7" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
          <rect x="13" y={4.5 + i * 8} width={48 - i * 5} height="4" rx="2" fill={NEUTRAL_LINE_DIM} />
        </g>
      ))}
      <path d="M66 4 l6 10 -6 4 -6 -4z" fill="currentColor" opacity="0.75" />
    </>
  ),
};

/** A small desk-side prop, drawn to the left of the desk, local coords ~0..22 x 0..40. */
const SIDE_PROP: Record<string, PropFn> = {
  orchestrator: () => (
    <>
      <rect x="2" y="6" width="18" height="12" rx="2" fill={MONITOR_BEZEL} />
      <rect x="4" y="8" width="14" height="8" rx="1" fill="currentColor" opacity="0.3" />
    </>
  ),
  "product-owner": () => (
    <>
      <rect x="3" y="10" width="9" height="9" rx="1" fill="currentColor" opacity="0.55" transform="rotate(-6 7 14)" />
      <rect x="10" y="14" width="9" height="9" rx="1" fill="currentColor" opacity="0.35" transform="rotate(5 14 18)" />
    </>
  ),
  "research-agent": () => (
    <>
      <rect x="2" y="14" width="18" height="5" rx="1" fill={NEUTRAL_LINE_DIM} />
      <rect x="3" y="9" width="16" height="5" rx="1" fill={NEUTRAL_LINE_DIM} />
      <rect x="4" y="4" width="14" height="5" rx="1" fill="currentColor" opacity="0.45" />
    </>
  ),
  "solution-architect": () => (
    <rect x="2" y="4" width="18" height="24" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
  ),
  "ui-ux-agent": () => (
    <>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={6 + i * 6} cy="14" r="4" fill="currentColor" opacity={0.3 + i * 0.2} />
      ))}
    </>
  ),
  "frontend-developer": () => (
    <>
      <ellipse cx="11" cy="26" rx="9" ry="3" fill="rgba(0,0,0,0.25)" />
      <path d="M6 24c0-8 10-8 10 0" fill="#3c6e4f" opacity="0.8" />
      <rect x="8" y="22" width="6" height="6" fill="#5a4632" />
    </>
  ),
  "backend-developer": () => (
    <>
      <rect x="2" y="2" width="18" height="26" rx="2" fill={MONITOR_BEZEL} />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx="6" cy={6 + i * 6} r="1.4" fill={i === 1 ? "#e0625f" : "#6fbf8a"} opacity="0.85" />
      ))}
    </>
  ),
  "qa-agent": () => (
    <>
      <circle cx="9" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.6" />
      <line x1="14" y1="15" x2="20" y2="21" stroke="currentColor" strokeWidth="2.5" opacity="0.6" strokeLinecap="round" />
    </>
  ),
  "security-reviewer": () => (
    <path d="M11 2 L20 6 V14 C20 21 16 25 11 27 C6 25 2 21 2 14 V6 Z" fill="currentColor" opacity="0.3" />
  ),
  "code-reviewer": () => (
    <>
      <rect x="3" y="2" width="16" height="22" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <path d="M7 12l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "release-agent": () => <path d="M11 2 L19 22 L11 17 L3 22Z" fill="currentColor" opacity="0.6" />,
};

const DEFAULT_SCREEN: ScreenFn = () => <rect x="2" y="2" width="74" height="36" rx="3" fill="currentColor" opacity="0.25" />;
const DEFAULT_PROP: PropFn = () => null;

const ACTIVE_STATUSES: OfficeAgentVisualStatus[] = ["WORKING", "THINKING", "REVIEWING"];

export function WorkstationArt({
  roleId,
  accent,
  status,
  dim = false,
  className,
}: {
  roleId: string;
  accent: string;
  status: OfficeAgentVisualStatus;
  /** True when the whole office is closed / this role has no bearing on the current project. */
  dim?: boolean;
  className?: string;
}) {
  const screen = SCREEN_CONTENT[roleId] ?? DEFAULT_SCREEN;
  const sideProp = SIDE_PROP[roleId] ?? DEFAULT_PROP;
  const isActive = !dim && ACTIVE_STATUSES.includes(status);
  const isTyping = !dim && status === "WORKING";
  const isReviewing = !dim && status === "REVIEWING";
  const isBlocked = !dim && status === "BLOCKED";
  const isDone = !dim && status === "DONE";
  const glowOpacity = dim ? 0.05 : status === "IDLE" || status === "WAITING" || status === "PAUSED" ? 0.18 : isActive ? 0.55 : 0.3;

  return (
    <div style={{ "--role-accent": accent, color: accent } as CSSProperties} className={cn("relative", className)}>
      <svg viewBox="0 0 200 175" className={cn("h-full w-full overflow-visible", dim && "grayscale")} aria-hidden="true">
        <defs>
          <radialGradient id={`glow-${roleId}`} cx="50%" cy="35%" r="60%">
            <stop offset="0%" stopColor={accent} stopOpacity={glowOpacity} />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ambient desk-light pool */}
        <ellipse cx="100" cy="65" rx="95" ry="85" fill={`url(#glow-${roleId})`} />

        {/* floor shadow */}
        <ellipse cx="100" cy="163" rx="66" ry="8" fill="rgba(0,0,0,0.35)" />

        {/* side prop */}
        <g transform="translate(4, 100)" opacity={dim ? 0.35 : 0.9}>
          {sideProp()}
        </g>

        {/* desk legs */}
        <rect x="42" y="148" width="5" height="15" fill={DESK} opacity="0.9" />
        <rect x="153" y="148" width="5" height="15" fill={DESK} opacity="0.9" />

        {/* chair — peeks out behind the character's shoulders */}
        <rect x="74" y="44" width="52" height="72" rx="16" fill={CHAIR} />

        {/* character: head clearly above the monitor, torso/legs behind desk+screen */}
        <g style={{ transformOrigin: "100px 100px" }}>
          <rect x="78" y="40" width="44" height="80" rx="15" fill="currentColor" opacity={dim ? 0.4 : 0.92} />
          <circle cx="100" cy="26" r="16" fill={dim ? HEAD_SHADOW : HEAD} />
          <rect x="88" y="22" width="24" height="6" rx="3" fill="currentColor" opacity={isActive ? 1 : 0.6} className={isActive ? "animate-accent-glow-pulse" : undefined} />
        </g>

        {/* desk (sits in front of the character's midsection) */}
        <rect x="30" y="113" width="140" height="30" rx="7" fill={DESK} />
        <rect x="30" y="106" width="140" height="11" rx="4" fill={DESK_TOP} />

        {/* monitor stand + bezel — positioned so the head stays visible above it */}
        <rect x="94" y="99" width="12" height="9" fill={MONITOR_BEZEL} />
        <rect x="53" y="46" width="94" height="53" rx="7" fill={MONITOR_BEZEL} />
        <rect x="61" y="53" width="78" height="39" rx="3" fill="currentColor" opacity={dim ? 0.08 : 0.16} />

        {/* status-driven screen scan / block */}
        <g transform="translate(61,53)" opacity={dim ? 0.3 : 1}>
          {screen()}
          {isReviewing && (
            <rect x="0" y="0" width="78" height="4" rx="2" fill="currentColor" opacity="0.7" className="animate-scan-sweep" style={{ transformBox: "fill-box" }} />
          )}
        </g>

        {/* hands, resting on the desk in front of everything */}
        <rect x="60" y="107" width="20" height="9" rx="4.5" fill="currentColor" opacity={dim ? 0.4 : 0.85} className={isTyping ? "animate-typing-bounce" : undefined} />
        <rect
          x="120"
          y="107"
          width="20"
          height="9"
          rx="4.5"
          fill="currentColor"
          opacity={dim ? 0.4 : 0.85}
          className={isTyping ? "animate-typing-bounce" : undefined}
          style={isTyping ? { animationDelay: "0.3s" } : undefined}
        />

        {isBlocked && <circle cx="139" cy="46" r="7" fill="#e0625f" className="animate-accent-glow-pulse" />}
        {isDone && <circle cx="139" cy="46" r="7" fill="oklch(0.7 0.17 150)" className="animate-done-pulse" />}
      </svg>
    </div>
  );
}
