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
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
