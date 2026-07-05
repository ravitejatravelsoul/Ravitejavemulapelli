"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { TocEntry } from "@/lib/toc";

/**
 * Scrollspy TOC — highlights whichever heading is currently in the reading
 * viewport via IntersectionObserver. `activeId` starts `null` on both server
 * and client (no heading is "active" before the browser has measured
 * anything), so there's nothing here for hydration to disagree about.
 */
export function TableOfContents({ entries }: { entries: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;
    const headings = entries
      .map((entry) => document.getElementById(entry.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (observedEntries) => {
        const visible = observedEntries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <nav aria-label="Table of contents">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        On this page
      </p>
      <ul className="mt-4 space-y-2.5 border-l border-border/70">
        {entries.map((entry) => {
          const isActive = entry.id === activeId;
          return (
            <li
              key={entry.id}
              className="relative"
              style={{ paddingLeft: entry.level === 3 ? "2rem" : "1rem" }}
            >
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute top-0 -left-px h-full w-px bg-primary transition-all"
                />
              ) : null}
              <a
                href={`#${entry.id}`}
                className={cn(
                  "text-sm transition-colors",
                  isActive
                    ? "font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
