import Image from "next/image";
import { cn } from "@/lib/utils";

const gradients = [
  "from-primary/35 via-accent-2/20 to-transparent",
  "from-accent-2/35 via-primary/15 to-transparent",
  "from-primary/25 via-transparent to-accent-2/30",
  "from-accent-2/20 via-transparent to-primary/35",
];

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];

interface ProjectCoverProps {
  title: string;
  coverImage?: string;
  index?: number;
  className?: string;
  /** Set on the single above-the-fold usage per page (the case-study hero cover) so it's not lazy-loaded as an LCP candidate. */
  priority?: boolean;
}

/**
 * Renders the real cover media when one exists; otherwise a deliberate
 * gradient panel with the project's initial — a designed placeholder, not a
 * broken-image state, until real screenshots/diagrams/demos are added.
 * Video files get a native `<video>` element; GIFs skip Next's image
 * optimizer (which flattens animated GIFs to a static frame) via
 * `unoptimized` so the animation actually plays.
 */
export function ProjectCover({
  title,
  coverImage,
  index = 0,
  className,
  priority = false,
}: ProjectCoverProps) {
  if (coverImage) {
    const isVideo = VIDEO_EXTENSIONS.some((ext) => coverImage.toLowerCase().endsWith(ext));
    const isGif = coverImage.toLowerCase().endsWith(".gif");

    if (isVideo) {
      return (
        <div className={cn("relative aspect-video overflow-hidden rounded-xl border border-border/70", className)}>
          <video
            src={coverImage}
            autoPlay
            muted
            loop
            playsInline
            className="size-full object-cover"
          >
            <track kind="captions" />
          </video>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/10"
          />
        </div>
      );
    }

    return (
      <div className={cn("relative aspect-video overflow-hidden rounded-xl border border-border/70", className)}>
        <Image
          src={coverImage}
          alt={`${title} cover`}
          fill
          unoptimized={isGif}
          priority={priority}
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          sizes="(min-width: 1024px) 33vw, 100vw"
        />
        {/* Subtle top-down wash so a badge/ribbon placed over the cover (e.g. "Featured") stays legible regardless of how bright the underlying screenshot is. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/10"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-gradient-to-br transition-transform duration-500 ease-out group-hover:scale-105",
        gradients[index % gradients.length],
        className,
      )}
    >
      <span className="font-mono text-6xl font-semibold text-foreground/15 transition-transform duration-500 ease-out group-hover:scale-110">
        {title.charAt(0)}
      </span>
    </div>
  );
}
