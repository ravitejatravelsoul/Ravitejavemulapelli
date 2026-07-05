"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

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
 * SSR-safe reduced-motion check for props that structurally change what
 * gets rendered (e.g. `style={reduced ? undefined : {...}}`).
 * `useSyncExternalStore`'s `getServerSnapshot` is used for both the actual
 * server render AND the client's first render before hydration completes —
 * that's the API's own guarantee — so it's always `false` until hydration
 * finishes, then updates to the real OS-level value. `motion/react`'s own
 * `useReducedMotion` can resolve synchronously to that value on the
 * client's first render, which is fine for values that only affect
 * animation *behavior* but causes a hydration warning for anything that
 * changes the rendered style/prop shape.
 */
export function useSafeReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
