"use client";
import { useOfficeSpeech } from "./use-office-speech";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HeadquartersState } from "@/lib/ai-office/headquarters/world-state";
import {
  advanceVisualQueue,
  emptyVisualQueue,
  meaningfulNotices,
  shouldGreet,
  briefSignature,
  proximityBriefing,
  engineerBriefing,
  playbackPhase,
  playbackProgress,
  cinematicPose,
  type WorldNotice,
} from "@/lib/ai-office/headquarters/experience";
import {
  liveSample,
  type HandoffPlayback,
} from "@/lib/ai-office/headquarters/presentation";
import type { Vec3 } from "../world-prototype/world-campus";
export function useHeadquartersExperience(
  state: HeadquartersState | null,
  error: string,
) {
  const speech = useOfficeSpeech();
  const { speak, stop, leave } = speech;
  const play = useRef<HandoffPlayback | null>(null),
    resting = useRef<Record<string, Vec3>>({}),
    boss = useRef<Vec3>([0, 1.7, 15]),
    near = useRef<string | null>(null),
    greetings = useRef(new Map<string, { at: number; signature: string }>()),
    acknowledgments = useRef(new Map<string, number>()),
    queue = useRef(emptyVisualQueue()),
    completed = useRef(""),
    noticeSeen = useRef(new Set<string>()),
    current = useRef({ state, error });
  const [motion, setMotion] = useState(true),
    [watch, setWatch] = useState(false),
    [view, setView] = useState({
      id: "",
      phase: "",
      pending: 0,
      held: false,
      fromRole: "",
      toRole: "",
      completed: "",
      position: [0, 0, 0] as Vec3,
      detours: 0,
      blockedMs: 0,
      remote: false,
    }),
    [notice, setNotice] = useState<WorldNotice | null>(null),
    [bubble, setBubble] = useState<{
      role: string;
      text: string;
      revision: string;
      until: number;
    } | null>(null);
  useEffect(() => {
    current.current = { state, error };
  }, [state, error]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let project: string | undefined,
      observedRevision = "",
      noticeUntil = 0,
      resumeAfter = 0;
    const visibility = () => {
      if (document.hidden) {
        resumeAfter = Date.now();
        queue.current = emptyVisualQueue();
        play.current = null;
        near.current = null;
        stop();
      }
      setMotion(!document.hidden && !media.matches);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", visibility);
    const timer = setInterval(() => {
      const now = Date.now();
      const { state: s, error: e } = current.current;
      if (!s) return;
      const enabled =
        !document.hidden &&
        !media.matches &&
        !e &&
        s.office.state === "OPEN" &&
        s.project?.status !== "PAUSED";
      if (project !== s.project?.id) {
        queue.current = emptyVisualQueue();
        completed.current = "";
        stop();
        noticeSeen.current.clear();
        greetings.current.clear();
        acknowledgments.current.clear();
        project = s.project?.id;
        observedRevision = "";
        setBubble(null);
      }
      const p = play.current;
      let held = p?.motion?.held ?? false;
      if (enabled && p && !p.motion) {
        const sample = liveSample(
          { roleId: p.event.fromRole, status: "IDLE" },
          p,
          now,
          true,
        );
        held =
          Math.hypot(
            sample.position[0] - boss.current[0],
            sample.position[2] - boss.current[2],
          ) < 1.15;
      }
      // Consume hidden/reconnect history through the first fresh server snapshot.
      if (resumeAfter) {
        queue.current.initialized = false;
        if (!document.hidden && s.observedAt >= resumeAfter) resumeAfter = 0;
      }
      if (p?.motion?.phase === "DONE") completed.current = p.event.id;
      queue.current.current = play.current;
      const first = !queue.current.initialized;
      queue.current = advanceVisualQueue(
        queue.current,
        s.transitions.filter(
          (e) =>
            e.type !== "DELIVERY" ||
            s.deliveries.some(
              (d) => d.id === e.projectId && d.status === "VERIFIED",
            ),
        ),
        now,
        enabled,
      );
      play.current = queue.current.current;
      if (p && p.event.id !== play.current?.event.id) setWatch(false);
      const next = {
        id: play.current?.event.id ?? "",
        phase: play.current ? playbackPhase(play.current, now) : "",
        pending: queue.current.pending.length,
        held,
        fromRole: play.current?.event.fromRole ?? "",
        toRole: play.current?.event.toRole ?? "",
        completed: completed.current,
        position: [...(play.current?.motion?.position ?? [0, 0, 0])] as Vec3,
        detours: play.current?.motion?.detours ?? 0,
        blockedMs: play.current?.motion?.blockedMs ?? 0,
        remote: play.current?.motion?.remote ?? false,
      };
      setView((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
      if (!play.current || !enabled) setWatch(false);
      if (observedRevision !== s.revision) {
        const notices = meaningfulNotices(s);
        const fresh = notices.filter(
          (n) =>
            !noticeSeen.current.has(n.id) && n.at <= now && now - n.at < 60000,
        );
        notices.forEach((n) => noticeSeen.current.add(n.id));
        while (noticeSeen.current.size > 512)
          noticeSeen.current.delete(noticeSeen.current.values().next().value!);
        if (!first && !document.hidden && !e && fresh.length) {
          setNotice(fresh[0]);
          noticeUntil = now + 8000;
        }
        observedRevision = s.revision;
      }
      if (now > noticeUntil || document.hidden) setNotice(null);
      if (near.current === "office-engineer" && !document.hidden && !e) {
        const role = "office-engineer",
          signature = JSON.stringify([
            s.project?.id,
            s.office.health,
            s.office.runner,
          ]);
        if (shouldGreet(greetings.current.get(role), signature, now)) {
          greetings.current.set(role, { at: now, signature });
          const text = engineerBriefing(s, new Date(now).getHours());
          speak({ role, text, revision: s.revision, priority: 1 });
          setBubble({ role, text, revision: s.revision, until: now + 8000 });
        } else setBubble((old) => (old && old.until < now ? null : old));
        return;
      }
      const a = s.agents.find((a) => a.roleId === near.current);
      if (!a || document.hidden || e) {
        if (document.hidden || e) stop();
        setBubble(null);
        return;
      }
      const signature = briefSignature(a, s.project?.id);
      if (shouldGreet(greetings.current.get(a.roleId), signature, now)) {
        greetings.current.set(a.roleId, { at: now, signature });
        acknowledgments.current.set(a.roleId, now + 1600);
        const text = proximityBriefing(a, s, new Date(now).getHours());
        speak({ role: a.roleId, text, revision: s.revision, priority: 1 });
        setBubble({
          role: a.roleId,
          text,
          revision: s.revision,
          until: now + 8000,
        });
      } else
        setBubble((old) =>
          old && (old.until < now || old.role !== a.roleId) ? null : old,
        );
    }, 250);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", visibility);
    };
  }, [speak, stop]);
  const onNear = useCallback(
    (id: string | null) => {
      near.current = id;
      leave(id);
    },
    [leave],
  );
  const cameraSample = useCallback(
    () => (play.current ? cinematicPose(play.current, Date.now()) : null),
    [],
  );
  const stopWatching = useCallback(() => setWatch(false), []);
  const startWatching = () => {
    if (play.current) {
      if (document.pointerLockElement) document.exitPointerLock();
      setBubble(null);
      stop();
      setWatch(true);
    }
  };
  return {
    speech,
    play,
    resting,
    boss,
    acknowledgments,
    motion,
    view,
    notice,
    bubble,
    onNear,
    watch,
    startWatching,
    stopWatching,
    cameraSample,
    progress: playbackProgress,
  };
}
