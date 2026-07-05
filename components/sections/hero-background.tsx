import { AnimatedGradient } from "@/components/motion/animated-gradient";
import { MouseSpotlight } from "@/components/motion/mouse-spotlight";
import { Particles } from "@/components/motion/particles";

/**
 * Layered hero backdrop: gradient mesh + a soft secondary blob, a very slow
 * drifting depth-fog wash, and the ambient particle field + cursor spotlight
 * already used elsewhere. Everything here is pure CSS animation
 * (compositor-only transforms/opacity) — no per-frame JS.
 */
export function HeroBackground() {
  return (
    <>
      <AnimatedGradient />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="animate-blob-a absolute bottom-[-15%] left-[35%] h-[360px] w-[360px] rounded-full bg-accent-2/10 blur-[130px]" />
        <div
          className="fog-drift absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 45%, color-mix(in oklch, var(--primary) 6%, transparent), transparent 70%)",
          }}
        />
      </div>
      <Particles className="hidden sm:block" />
      <MouseSpotlight className="-z-10" />
    </>
  );
}
