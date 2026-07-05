"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

/**
 * Same `useSyncExternalStore` trick as `useSafeReducedMotion`: `false` for
 * the server render AND the client's first render (that's the API's own
 * guarantee), `true` from the next render on — without a `setState` call
 * inside a `useEffect`, which `react-hooks/set-state-in-effect` flags.
 * Used to gate rendering anything that depends on client-only state (like
 * `next-themes`' `resolvedTheme`) so there's nothing to reconcile on
 * hydration.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
