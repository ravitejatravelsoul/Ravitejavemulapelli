"use client";
import { useEffect, useRef, useState } from "react";
import type { HeadquartersState } from "@/lib/ai-office/headquarters/world-state";
/** Read-only polling, one in-flight request, conditional bytes and no hidden-tab backlog. */
export function useWorldState(project?: string) {
  const [state, setState] = useState<HeadquartersState | null>(null),
    [error, setError] = useState(""),
    [refreshedAt, setRefreshedAt] = useState(0);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>,
      etag = "",
      busy = false;
    const controller = new AbortController();
    async function poll() {
      if (!alive || busy || document.hidden) return;
      busy = true;
      let delay = 1500;
      try {
        const response = await fetch(
          "/office/headquarters-state" +
            (project ? "?project=" + encodeURIComponent(project) : ""),
          {
            cache: "no-store",
            headers: etag ? { "If-None-Match": etag } : {},
            signal: controller.signal,
          },
        );
        if (response.status !== 304) {
          if (!response.ok)
            throw Error(
              response.status === 401
                ? "Session expired. Return to Classic Office to sign in."
                : "Office state is unavailable.",
            );
          const next: HeadquartersState = await response.json();
          etag = response.headers.get("etag") ?? "";
          currentMode = next.mode;
          delay = next.mode === "remote" ? 10000 : 1500;
          if (alive)
            setState((previous) => {
              if (!previous) return next;
              next.agents = next.agents.map((a) => {
                const old = previous.agents.find((b) => a.roleId === b.roleId);
                return old && JSON.stringify(old) === JSON.stringify(a)
                  ? old
                  : a;
              });
              return next;
            });
        } else delay = currentMode === "remote" ? 10000 : 1500;
        if (alive) {
          setError("");
          setRefreshedAt(Date.now());
        }
      } catch {
        if (alive && !controller.signal.aborted) {
          setError("State unavailable — showing last observed data.");
          delay = 5000;
        }
      } finally {
        busy = false;
        if (alive) timer = setTimeout(poll, delay);
      }
    }
    let currentMode = "local";
    refresh.current = () => {
      clearTimeout(timer);
      void poll();
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) {
        etag = "";
        void poll();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [project]);
  return { state, error, refreshedAt, refresh: () => refresh.current() };
}
