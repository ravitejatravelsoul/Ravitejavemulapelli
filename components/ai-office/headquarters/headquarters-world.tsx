"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorldExperience from "../world-prototype/world-experience";
import { HeadquartersScene } from "./headquarters-scene";
import { HeadquartersPanel } from "./headquarters-panel";
import { useWorldState } from "./use-world-state";
import {
  greeting,
  ROLE_STATIONS,
  liveSample,
  latestTransition,
  handoffPath,
  type HandoffPlayback,
} from "@/lib/ai-office/headquarters/presentation";
import type { Vec3 } from "../world-prototype/world-campus";
const DESTINATIONS = [
  { id: "terminal:command", label: "Command Core" },
  { id: "terminal:owner", label: "Owner Command" },
  { id: "office-engineer", label: "Infrastructure" },
  { id: "terminal:models", label: "Model Lab" },
  { id: "terminal:delivery", label: "Delivery Vault" },
];
export default function HeadquartersWorld() {
  const [project, setProject] = useState<string | undefined>(() =>
      typeof location !== "undefined"
        ? (new URLSearchParams(location.search).get("project") ?? undefined)
        : undefined,
    ),
    [motion, setMotion] = useState(true),
    [transition, setTransition] = useState("");
  const { state, error, refreshedAt, refresh } = useWorldState(project),
    play = useRef<HandoffPlayback | null>(null),
    seen = useRef(new Set<string>()),
    lastProject = useRef<string | undefined>(undefined),
    synced = useRef(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setMotion(!document.hidden && !media.matches);
      if (document.hidden) {
        play.current = null;
        synced.current = false;
      }
    };
    update();
    document.addEventListener("visibilitychange", update);
    media.addEventListener("change", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      media.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    const changed = lastProject.current !== state.project?.id;
    const enabled =
      synced.current &&
      !changed &&
      motion &&
      !error &&
      state.office.state === "OPEN" &&
      state.project?.status !== "PAUSED";
    const event = latestTransition(
      state.transitions,
      seen.current,
      Date.now(),
      enabled,
    );
    if (!enabled) {
      play.current = null;
      queueMicrotask(() => setTransition(""));
    } else if (
      event &&
      (!play.current || Date.now() - play.current.startedAt > 12000)
    ) {
      const path = handoffPath(event);
      if (path) {
        play.current = { event, path, startedAt: Date.now() };
        queueMicrotask(() => setTransition(event.id));
      }
    }
    lastProject.current = state.project?.id;
    synced.current = true;
  }, [state, motion, error]);
  const selectProject = useCallback((id: string) => {
    setProject(id);
    history.replaceState(
      null,
      "",
      "/office/headquarters?project=" + encodeURIComponent(id),
    );
  }, []);
  const animate =
    motion &&
    !error &&
    state?.office.state === "OPEN" &&
    state.project?.status !== "PAUSED";
  const actors = useMemo(() => {
    const result: Record<string, { name: string; position: () => Vec3 }> = {};
    for (const a of state?.agents ?? [])
      if (ROLE_STATIONS[a.roleId])
        result[a.roleId] = {
          name: a.name,
          position: () =>
            liveSample(a, play.current, Date.now(), !!animate).position,
        };
    result["office-engineer"] = {
      name: "Office Engineer",
      position: () => ROLE_STATIONS["office-engineer"].home,
    };
    for (const [id, name, p] of [
      ["terminal:command", "Command Core", [0, 1.4, 6]],
      ["terminal:owner", "Owner Command", [0, 1.4, -13]],
      ["terminal:models", "Model Lab", [15.4, 1.4, -3]],
      ["terminal:delivery", "Delivery Vault", [12, 1.4, -17]],
    ] as [string, string, Vec3][])
      result[id] = { name, position: () => p };
    return result;
  }, [state?.agents, animate]);
  if (!state)
    return (
      <section role="status" style={{ padding: 40 }}>
        <h1>Connecting to the headquarters</h1>
        <p>{error || "Reading authoritative Office state…"}</p>
        <a href="/office">Classic Office</a>
      </section>
    );
  return (
    <WorldExperience
      headquarters={{
        greeting: greeting(new Date(refreshedAt).getHours()),
        closed: state.office.state === "CLOSED",
        transition,
        actors,
        scene: (
          <HeadquartersScene state={state} play={play} animate={!!animate} />
        ),
        panel: (id, close) => (
          <HeadquartersPanel
            key={id}
            id={id}
            state={state}
            close={close}
            refresh={refresh}
            selectProject={selectProject}
            stale={!!error}
            asOf={refreshedAt}
          />
        ),
        destinations: DESTINATIONS,
        status:
          (state.project?.title ?? "No project selected") +
          " · " +
          state.office.state +
          " · " +
          state.office.runner,
        notice: error
          ? "STALE — LAST OBSERVED STATE"
          : state.mode === "remote"
            ? "REMOTE SNAPSHOT"
            : state.approvals.length
              ? state.approvals.length + " OWNER DECISIONS"
              : "LIVE · " + new Date(refreshedAt).toLocaleTimeString(),
      }}
    />
  );
}
