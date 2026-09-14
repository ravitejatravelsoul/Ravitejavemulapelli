"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Localhost convenience: the standalone runner (`npm run ai-office:runner`)
 * mutates project/task state directly in SQLite from a separate process, so
 * the `revalidatePath` calls in `app/office/actions/**` — which only fire
 * from this app's own Server Actions — never see those changes. Without
 * this, the owner would have to manually reload to watch a project move
 * through PENDING → IN_PROGRESS → DONE. A plain poll is deliberately chosen
 * over WebSockets/SSE: this is a single-owner local tool, not a multi-user
 * realtime app.
 *
 * Fires an immediate `router.refresh()` on mount, not just on the interval
 * — a real reliability defect found during the first Claude LIVE pilot: the
 * Next.js App Router's client-side Router Cache reuses whatever RSC payload
 * was last rendered for a route on browser back/forward navigation (Next's
 * own docs: "Pages are not cached by default but are reused during browser
 * back/forward navigation... invalidated with... router.refresh"). Since
 * this page's real data changes from a background process the browser has
 * no way to know about, landing on it via back/forward — or even a fresh
 * mount before the first interval tick — could show a stale snapshot from
 * much earlier in the session (e.g. progress from right after project
 * creation) until the *next* poll corrected it. Refreshing immediately on
 * mount closes that window instead of waiting up to `intervalMs`.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    router.refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
