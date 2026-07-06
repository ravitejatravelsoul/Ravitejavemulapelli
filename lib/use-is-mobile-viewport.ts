"use client";

import { useSyncExternalStore } from "react";

// Matches the `lg` breakpoint the hero (and the rest of the site) already
// uses to split mobile/desktop layouts — same source of truth as the CSS.
const QUERY = "(max-width: 1023px)";

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

/**
 * Same `useSyncExternalStore` pattern as `useSafeReducedMotion`: `false` for
 * the server render and the client's first render (avoids any hydration
 * mismatch), the real value from the next render on — and, critically,
 * re-subscribes to `matchMedia` changes, so resizing across the breakpoint
 * updates live instead of only being checked once on mount.
 */
export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
