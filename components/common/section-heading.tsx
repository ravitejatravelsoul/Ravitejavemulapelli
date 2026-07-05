import { cn } from "@/lib/utils";
import { RevealText } from "@/components/motion/reveal-text";
import { FadeIn } from "@/components/motion/fade-in";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
  /** Use "h1" when this is a page's primary heading (one per page); defaults to "h2" for in-page section titles. */
  as?: "h1" | "h2";
  /** Animate on mount instead of on scroll-into-view — pass for every page-level "h1" usage so the heading is never gated behind an IntersectionObserver callback. */
  eager?: boolean;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
  as = "h2",
  eager = false,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow ? (
        <FadeIn eager={eager}>
          <p className="mb-3 font-mono text-sm font-medium tracking-wide text-primary uppercase">
            {eyebrow}
          </p>
        </FadeIn>
      ) : null}
      <RevealText
        as={as}
        text={title}
        eager={eager}
        className="block text-balance text-[clamp(1.875rem,4vw,2.75rem)] leading-[1.15] font-semibold tracking-tight"
      />
      {description ? (
        <FadeIn eager={eager} delay={0.15}>
          <p className="mt-5 text-pretty text-lg text-muted-foreground">{description}</p>
        </FadeIn>
      ) : null}
    </div>
  );
}
