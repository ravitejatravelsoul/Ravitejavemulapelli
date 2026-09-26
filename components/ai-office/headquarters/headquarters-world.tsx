"use client";
import { useCallback, useMemo, useState } from "react";
import WorldExperience from "../world-prototype/world-experience";
import { HeadquartersScene } from "./headquarters-scene";
import { HeadquartersPanel } from "./headquarters-panel";
import { useHeadquartersExperience } from "./use-headquarters-experience";
import styles from "./headquarters-panel.module.css";
import { useWorldState } from "./use-world-state";
import {
  ROLE_STATIONS,
  liveSample,
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
  );
  const { state, error, refreshedAt, refresh } = useWorldState(project);
  const experience = useHeadquartersExperience(state, error);
  const { play, resting, boss, acknowledgments, motion, view, bubble, notice } =
    experience;
  const { speech } = experience;
  const selectProject = useCallback((id: string) => {
    setProject(id);
    history.replaceState(
      null,
      "",
      "/office?project=" + encodeURIComponent(id),
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
            liveSample(a, play.current, Date.now(), !!animate, resting.current)
              .position,
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
  }, [state?.agents, animate, play, resting]);
  if (!state)
    return (
      <section role="status" style={{ padding: 40 }}>
        <h1>Connecting to the headquarters</h1>
        <p>{error || "Reading authoritative Office state…"}</p>
        <a href="/office/classic">Classic Office</a>
      </section>
    );
  return (
    <WorldExperience
      headquarters={{
        closed: state.office.state === "CLOSED",
        transition: view.id,
        boss,
        onNear: experience.onNear,
        cinematic: experience.watch,
        cameraSample: experience.cameraSample,
        stopWatching: experience.stopWatching,
        watchHandoff: experience.startWatching,
        hud: (
          <>
            <aside
              className={styles.voiceControls}
              aria-label="Office voice"
              data-testid="office-voice"
              data-status={speech.view.status}
              data-speaker={speech.view.briefing?.role ?? ""}
            >
              <button onClick={speech.toggle} aria-pressed={speech.enabled}>
                VOICE: {speech.enabled ? "ON" : "OFF"}
              </button>
              <button onClick={speech.stop} disabled={!speech.view.briefing}>
                Stop Speaking
              </button>
              <small>
                {speech.view.status === "unavailable"
                  ? "Local voice unavailable — subtitles remain available."
                  : speech.view.status === "speaking"
                    ? "Speaking · " +
                      (state.agents.find(
                        (a) => a.roleId === speech.view.briefing?.role,
                      )?.name ?? "Office Engineer")
                    : "Local browser voice"}
              </small>
            </aside>
            {speech.view.briefing && (
              <aside
                className={styles.bubble}
                role="status"
                data-testid="speech-subtitle"
                data-role={speech.view.briefing.role}
                data-revision={speech.view.briefing.revision}
              >
                {speech.view.briefing.text}
              </aside>
            )}
            <span
              hidden
              data-testid="visual-playback"
              data-current={view.id}
              data-pending={view.pending}
              data-completed={view.completed}
              data-phase={view.phase}
              data-position={JSON.stringify(view.position)}
              data-detours={view.detours}
              data-blocked-ms={view.blockedMs}
              data-remote={view.remote}
            />
            {view.id && (
              <aside
                className={styles.eventCue}
                data-testid="handoff-cue"
                data-transition={view.id}
                data-phase={view.phase}
                data-pending={view.pending}
              >
                <small>
                  {view.id.startsWith("delivery:")
                    ? "DELIVERY VERIFIED"
                    : view.id.startsWith("remediation:")
                      ? "REMEDIATION IN PROGRESS"
                      : "HANDOFF IN PROGRESS"}
                </small>
                <strong>
                  {state.agents.find((a) => a.roleId === view.fromRole)?.name} →{" "}
                  {view.id.startsWith("delivery:")
                    ? "Delivery Vault"
                    : state.agents.find((a) => a.roleId === view.toRole)?.name}
                </strong>
                <span>
                  {view.phase.toLowerCase()}
                  {view.remote
                    ? " · Sending core from a safe position"
                    : view.held
                      ? " · Owner nearby — keeping personal space"
                      : ""}
                </span>
                <button
                  onClick={
                    experience.watch
                      ? experience.stopWatching
                      : experience.startWatching
                  }
                >
                  {experience.watch ? "Return to Boss" : "Watch"}
                </button>
              </aside>
            )}
            {notice && (
              <aside
                className={styles.notice}
                role="status"
                data-testid="world-notice"
              >
                <b>{notice.title}</b>
                <span>{notice.detail}</span>
              </aside>
            )}
            {bubble && !experience.watch && !speech.view.briefing && (
              <aside
                className={styles.bubble}
                role="status"
                data-testid="proximity-briefing"
                data-role={bubble.role}
                data-revision={bubble.revision}
              >
                {bubble.text}
                <small>E · Open full workspace briefing</small>
              </aside>
            )}
          </>
        ),
        actors,
        scene: (
          <HeadquartersScene
            state={state}
            play={play}
            resting={resting}
            animate={!!animate}
            boss={boss}
            acknowledgments={acknowledgments}
            speaking={speech.speaking}
          />
        ),
        panel: (id, close) => (
          <HeadquartersPanel
            key={id}
            id={id}
            state={state}
            close={() => {
              speech.stop();
              close();
            }}
            speech={speech}
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
