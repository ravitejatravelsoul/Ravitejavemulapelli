"use client";
/* eslint-disable react-hooks/immutability -- R3F owns mutable camera objects; useFrame advances an explicitly shared ref, never React state. */
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Environment } from "./world-geometry";
import { OperationalWorld } from "./world-mode";
import type { Vec3 } from "./world-campus";
import { OFFICE_WORLD } from "./world-campus";
import {
  BOTS,
  SPAWN,
  DEMO_DURATION,
  demoBot,
  demoChapter,
  movePlayer,
  type BotId,
} from "./world-model";
import styles from "./world.module.css";
export type HeadquartersBridge = {
  greeting?: string;
  boss?: RefObject<Vec3>;
  onNear?: (id: string | null) => void;
  cinematic?: boolean;
  cameraSample?: () => { position: Vec3; target: Vec3 } | null;
  stopWatching?: () => void;
  watchHandoff?: () => void;
  hud?: ReactNode;
  closed?: boolean;
  transition?: string;
  actors: Record<string, { name: string; position: () => Vec3 }>;
  scene: ReactNode;
  panel: (id: string, close: () => void) => ReactNode;
  status: string;
  notice: string;
  destinations: { id: string; label: string }[];
};
type Runtime = {
  headquarters?: HeadquartersBridge;
  time: RefObject<number | null>;
  reset: number;
  play: number;
  paused: boolean;
  visible: boolean;
  entered: boolean;
  sensitivity: number;
  reduced: boolean;
  interacting: boolean;
};
type Telemetry = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  fps: number;
  draws: number;
  triangles: number;
  time: number | null;
  near: BotId | null;
};
class WorldBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className={styles.error}>
        <h1>3D view unavailable</h1>
        <p>
          This prototype needs WebGL 2 and hardware acceleration. You can safely
          return to the Office.
        </p>
        <a href="/office">Exit 3D Office</a>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Player({
  runtime,
  onTelemetry,
  onInteract,
  onReady,
}: {
  runtime: Runtime;
  onTelemetry: (t: Telemetry) => void;
  onInteract: (id: BotId) => void;
  onReady: () => void;
}) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>()),
    look = useRef({ yaw: 0, pitch: 0 }),
    velocity = useRef(new THREE.Vector2()),
    last = useRef({ play: 0, reset: 0 }),
    sample = useRef({ elapsed: 0, frames: 0 }),
    nearest = useRef<BotId | null>(null),
    params = useRef(runtime),
    savedBoss = useRef<{
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      yaw: number;
      pitch: number;
    } | null>(null);
  useEffect(() => {
    params.current = runtime;
  }, [runtime]);
  useEffect(() => {
    camera.position.set(...SPAWN);
    camera.rotation.order = "YXZ";
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    onReady();
  }, [camera, gl, onReady]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape") params.current.headquarters?.stopWatching?.();
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (!params.current.entered || params.current.interacting) return;
      if (e.code === "KeyV" && !e.repeat) {
        params.current.headquarters?.watchHandoff?.();
        return;
      }
      if (params.current.headquarters?.cinematic) return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ShiftLeft",
          "ShiftRight",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(e.code) &&
        document.pointerLockElement === gl.domElement
      ) {
        e.preventDefault();
        keys.current.add(e.code);
      }
      if (
        e.code === "KeyE" &&
        !e.repeat &&
        nearest.current &&
        document.pointerLockElement === gl.domElement
      ) {
        keys.current.clear();
        onInteract(nearest.current);
        document.exitPointerLock();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => {
      keys.current.clear();
      velocity.current.set(0, 0);
    };
    const mouse = (e: MouseEvent) => {
      if (
        document.pointerLockElement !== gl.domElement ||
        params.current.headquarters?.cinematic
      )
        return;
      look.current.yaw -= e.movementX * params.current.sensitivity;
      look.current.pitch = THREE.MathUtils.clamp(
        look.current.pitch - e.movementY * params.current.sensitivity,
        -1.25,
        1.25,
      );
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    document.addEventListener("mousemove", mouse);
    document.addEventListener("pointerlockchange", clear);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      document.removeEventListener("mousemove", mouse);
      document.removeEventListener("pointerlockchange", clear);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      if (document.pointerLockElement === gl.domElement)
        document.exitPointerLock();
    };
  }, [gl, onInteract]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.15);
    const cinematic = runtime.headquarters?.cinematic
      ? runtime.headquarters.cameraSample?.()
      : null;
    if (cinematic) {
      if (!savedBoss.current)
        savedBoss.current = {
          position: camera.position.clone(),
          quaternion: camera.quaternion.clone(),
          ...look.current,
        };
      keys.current.clear();
      velocity.current.set(0, 0);
      camera.position.lerp(
        new THREE.Vector3(...cinematic.position),
        Math.min(1, delta * 8),
      );
      camera.lookAt(...cinematic.target);
      runtime.headquarters?.onNear?.(null);
      return;
    }
    if (savedBoss.current) {
      camera.position.copy(savedBoss.current.position);
      camera.quaternion.copy(savedBoss.current.quaternion);
      look.current = {
        yaw: savedBoss.current.yaw,
        pitch: savedBoss.current.pitch,
      };
      savedBoss.current = null;
    }
    if (runtime.headquarters?.boss)
      runtime.headquarters.boss.current = [
        camera.position.x,
        camera.position.y,
        camera.position.z,
      ];
    if (runtime.reset !== last.current.reset) {
      last.current.reset = runtime.reset;
      camera.position.set(...SPAWN);
      look.current = { yaw: 0, pitch: 0 };
      velocity.current.set(0, 0);
    }
    if (runtime.play !== last.current.play) {
      last.current.play = runtime.play;
      runtime.time.current = 0;
    }
    if (runtime.visible && !runtime.paused && runtime.time.current !== null)
      runtime.time.current = Math.min(DEMO_DURATION, runtime.time.current + dt);
    if (
      document.pointerLockElement === gl.domElement &&
      runtime.visible &&
      !runtime.interacting
    ) {
      const k = keys.current;
      look.current.yaw +=
        ((k.has("ArrowLeft") ? 1 : 0) - (k.has("ArrowRight") ? 1 : 0)) * dt;
      look.current.pitch = THREE.MathUtils.clamp(
        look.current.pitch +
          ((k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0)) * dt,
        -1.25,
        1.25,
      );
      let x = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0),
        z = (k.has("KeyS") ? 1 : 0) - (k.has("KeyW") ? 1 : 0);
      const length = Math.hypot(x, z) || 1;
      x /= length;
      z /= length;
      const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? 4.3 : 2.6;
      const vx =
          (x * Math.cos(look.current.yaw) + z * Math.sin(look.current.yaw)) *
          speed,
        vz =
          (-x * Math.sin(look.current.yaw) + z * Math.cos(look.current.yaw)) *
          speed;
      velocity.current.x = THREE.MathUtils.damp(velocity.current.x, vx, 10, dt);
      velocity.current.y = THREE.MathUtils.damp(velocity.current.y, vz, 10, dt);
      const p = movePlayer(
        camera.position.x,
        camera.position.z,
        velocity.current.x * dt,
        velocity.current.y * dt,
      );
      const clear = (x: number, z: number) =>
        Object.keys(runtime.headquarters?.actors ?? BOTS)
          .filter((id) => !id.startsWith("terminal:"))
          .every((id) => {
            const b =
              runtime.headquarters?.actors[id]?.position() ??
              demoBot(id, runtime.time.current).position;
            return Math.hypot(b[0] - x, b[2] - z) > 0.82;
          });
      if (clear(p[0], p[1])) camera.position.set(p[0], 1.7, p[1]);
    }
    camera.rotation.set(look.current.pitch, look.current.yaw, 0, "YXZ");
    let closest: BotId | null = null,
      best = 2.6;
    for (const id of Object.keys(runtime.headquarters?.actors ?? BOTS)) {
      const p =
          runtime.headquarters?.actors[id]?.position() ??
          demoBot(id, runtime.time.current).position,
        d = Math.hypot(p[0] - camera.position.x, p[2] - camera.position.z);
      if (d < best) {
        best = d;
        closest = id;
      }
    }
    nearest.current = closest;
    sample.current.elapsed += delta;
    sample.current.frames++;
    if (sample.current.elapsed > 0.25) {
      runtime.headquarters?.onNear?.(
        runtime.entered && !runtime.interacting ? closest : null,
      );
      onTelemetry({
        x: camera.position.x,
        z: camera.position.z,
        yaw: look.current.yaw,
        pitch: look.current.pitch,
        fps: Math.round(sample.current.frames / sample.current.elapsed),
        draws: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        time: runtime.time.current,
        near: closest,
      });
      sample.current = { elapsed: 0, frames: 0 };
    }
  });
  return null;
}
function deviceCapability(): "checking" | "desktop" | "mobile" | "unsupported" {
  if (typeof window === "undefined") return "checking";
  if (matchMedia("(pointer: coarse)").matches) return "mobile";
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (!context) return "unsupported";
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return "desktop";
  } catch {
    return "unsupported";
  }
}
// Stable callbacks keep input listeners and the camera's initial position scoped to mount.
export default function WorldExperience({
  headquarters,
}: { headquarters?: HeadquartersBridge } = {}) {
  const [ready, setReady] = useState(false),
    [entered, setEntered] = useState(false),
    [locked, setLocked] = useState(false),
    [visible, setVisible] = useState(true),
    [paused, setPaused] = useState(false),
    [reduced, setReduced] = useState(false),
    [sensitivity, setSensitivity] = useState(0.0018),
    [quality, setQuality] = useState("auto"),
    [device] = useState(deviceCapability),
    [autoHigh] = useState(
      () =>
        typeof navigator !== "undefined" &&
        navigator.hardwareConcurrency >= 8 &&
        ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
          4) >= 8,
    ),
    [reset, setReset] = useState(0),
    [play, setPlay] = useState(0),
    [info, setInfo] = useState<BotId | null>(null),
    [hint, setHint] = useState(""),
    [map, setMap] = useState(false);
  const time = useRef<number | null>(null),
    host = useRef<HTMLDivElement>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>({
    x: 0,
    z: 15,
    yaw: 0,
    pitch: 0,
    fps: 0,
    draws: 0,
    triangles: 0,
    time: null,
    near: null,
  });
  const onReady = useCallback(() => setReady(true), []),
    onInteract = useCallback((id: BotId) => setInfo(id), []);
  useEffect(() => {
    const locked = () => setLocked(!!document.pointerLockElement),
      visibility = () => setVisible(document.visibilityState === "visible"),
      motion = matchMedia("(prefers-reduced-motion: reduce)"),
      change = () => setReduced(motion.matches);
    change();
    document.addEventListener("pointerlockchange", locked);
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", change);
    return () => {
      document.removeEventListener("pointerlockchange", locked);
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", change);
    };
  }, []);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.pointerLockElement) document.exitPointerLock();
        setInfo(null);
        setMap(false);
      }
      if (e.key === "Tab" && host.current) {
        const items = [
          ...host.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a,input,select",
          ),
        ].filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !host.current.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !host.current.contains(document.activeElement))
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, []);
  async function enter() {
    setEntered(true);
    setInfo(null);
    setMap(false);
    setHint("");
    try {
      const canvas = host.current?.querySelector("canvas");
      if (!canvas?.requestPointerLock) throw Error();
      await canvas.requestPointerLock();
    } catch {
      setHint(
        "Mouse capture was blocked. Open this localhost URL in Chrome or Edge, then select Enter Office again.",
      );
    }
  }
  // The render callback forwards close to an event handler; it never invokes it.
  /* eslint-disable react-hooks/refs */
  const operationalPanel =
    info && headquarters
      ? headquarters.panel(info, () => {
          setInfo(null);
          void enter();
        })
      : null;
  /* eslint-enable react-hooks/refs */
  const runtime: Runtime = {
    headquarters,
    time,
    reset,
    play,
    paused,
    visible,
    entered,
    sensitivity,
    reduced,
    interacting: info !== null,
  };
  if (device !== "desktop")
    return (
      <div className={styles.world}>
        <section className={styles.error}>
          <p className={styles.eyebrow}>TEJA’S AI OFFICE / WORLD STUDY 02</p>
          <h1>
            {device === "checking"
              ? "Preparing the headquarters…"
              : device === "unsupported"
                ? "3D view unavailable"
                : "A world best explored on desktop."}
          </h1>
          <p>
            {device === "checking"
              ? "Checking browser capabilities."
              : device === "unsupported"
                ? "This prototype needs WebGL 2. Enable hardware acceleration in your browser, or return to the Office."
                : "Use a laptop or desktop with a keyboard and mouse to walk through this 3D prototype."}
          </p>
          <a href="/office">Return to Office</a>
        </section>
      </div>
    );
  return (
    <div
      className={styles.world}
      ref={host}
      data-testid="world-prototype"
      data-ready={ready}
      data-office-closed={headquarters?.closed || undefined}
      data-transition={headquarters?.transition ?? ""}
      data-cinematic={!!headquarters?.cinematic}
      data-locked={locked}
      data-player-x={telemetry.x.toFixed(2)}
      data-player-z={telemetry.z.toFixed(2)}
      data-yaw={telemetry.yaw.toFixed(3)}
      data-pitch={telemetry.pitch.toFixed(3)}
      data-demo-time={telemetry.time?.toFixed(1) ?? "idle"}
      data-near={telemetry.near ?? ""}
    >
      <OperationalWorld.Provider value={!!headquarters}>
        <WorldBoundary>
          <Canvas
            shadows
            dpr={
              quality === "high"
                ? [1, 1.5]
                : quality === "auto" && autoHigh
                  ? [1, 1.25]
                  : [1, 1]
            }
            frameloop={visible ? "always" : "never"}
            camera={{ position: SPAWN, fov: 65, near: 0.08, far: 2200 }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            fallback={
              <div className={styles.error}>
                WebGL is unavailable. <a href="/office">Return to Office</a>
              </div>
            }
          >
            <Environment
              time={time}
              operational={!!headquarters}
              active={visible && !paused && !reduced}
              cityHigh={quality === "high" || (quality === "auto" && autoHigh)}
            />
            {headquarters?.scene}
            <Player
              runtime={runtime}
              onTelemetry={setTelemetry}
              onInteract={onInteract}
              onReady={onReady}
            />
          </Canvas>
        </WorldBoundary>
      </OperationalWorld.Provider>
      <header className={styles.header}>
        <div>
          <b>T /</b>
          <span>
            TEJA’S AI OFFICE<small>THE NEXUS · LEVEL 50</small>
          </span>
        </div>
        <a
          href="/office"
          onClick={() => {
            if (document.pointerLockElement) document.exitPointerLock();
          }}
        >
          Exit 3D Office ↗
        </a>
      </header>
      <div className={styles.badge}>
        {headquarters ? "LIVE HEADQUARTERS" : "VISUAL PROTOTYPE"}{" "}
        <span>{headquarters?.notice ?? "NO LIVE DATA"}</span>
      </div>
      {!entered && (
        <section className={styles.welcome}>
          <p className={styles.eyebrow}>A PLACE FOR IDEAS TO BECOME REAL.</p>
          <h1>
            Step inside
            <br />
            the next office.
          </h1>
          <p>
            An autonomous engineering headquarters.
            <br />
            Human ambition. Shared intelligence.
          </p>
          <button disabled={!ready} onClick={enter}>
            {ready ? "ENTER OFFICE →" : "INITIALIZING WORLD…"}
          </button>
          <small>
            Desktop exploration · keyboard + mouse
            <br />
            {headquarters
              ? "Persisted Office state. Walking and briefings use no AI calls."
              : "All activity and displays are visual demonstrations."}
          </small>
        </section>
      )}
      {entered && !locked && !info && !headquarters?.cinematic && (
        <section className={styles.menu}>
          <span className={styles.eyebrow}>MOUSE RELEASED</span>
          <h2>Take your time.</h2>
          <button onClick={enter}>Resume exploration →</button>
          {!headquarters && (
            <button
              onClick={() => {
                setPlay((p) => p + 1);
                setPaused(false);
                void enter();
              }}
            >
              Play office demo
            </button>
          )}
          {headquarters?.destinations.map((d) => (
            <button key={d.id} onClick={() => setInfo(d.id)}>
              {d.label}
            </button>
          ))}
          {!headquarters && (
            <button onClick={() => setPaused((p) => !p)}>
              {headquarters
                ? paused
                  ? "Resume visual motion"
                  : "Pause visual motion"
                : paused
                  ? "Resume demo & ambience"
                  : "Pause demo & ambience"}
            </button>
          )}
          <button
            onClick={() => {
              setReset((r) => r + 1);
              void enter();
            }}
          >
            Reset position
          </button>
          <button onClick={() => setMap((m) => !m)}>Floor directory</button>
          <label>
            Mouse sensitivity
            <input
              aria-label="Mouse sensitivity"
              type="range"
              min="0.0007"
              max="0.004"
              step="0.0001"
              value={sensitivity}
              onChange={(e) => setSensitivity(Number(e.target.value))}
            />
          </label>
          <label>
            Render quality
            <select
              aria-label="Render quality"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="balanced">Balanced</option>
              <option value="high">High resolution</option>
            </select>
          </label>
        </section>
      )}
      {locked && !headquarters?.cinematic && (
        <>
          <div className={styles.crosshair} />
          {telemetry.near && (
            <div className={styles.interact}>
              <span>
                {!telemetry.near.startsWith("terminal:")
                  ? headquarters?.greeting
                  : ""}{" "}
              </span>
              <kbd>E</kbd> {headquarters ? "Talk to / inspect" : "Meet"}{" "}
              {headquarters?.actors[telemetry.near]?.name ??
                BOTS[telemetry.near]?.name}
            </div>
          )}
        </>
      )}
      {entered && !info && headquarters?.hud}
      {operationalPanel}
      {info && !headquarters && (
        <section
          className={styles.info}
          role="dialog"
          aria-modal="true"
          aria-label="Prototype agent"
        >
          <p className={styles.eyebrow}>
            {BOTS[info].callSign} / PROTOTYPE CHARACTER
          </p>
          <h2>{BOTS[info].name}</h2>
          <dl>
            <dt>Status</dt>
            <dd>{demoBot(info, telemetry.time).state}</dd>
            <dt>Current activity</dt>
            <dd>
              {telemetry.time === null
                ? "Waiting at the workstation"
                : BOTS[info].activity}
            </dd>
            <dt>Model</dt>
            <dd>Prototype · no AI connected</dd>
          </dl>
          <button
            autoFocus
            onClick={() => {
              setInfo(null);
              void enter();
            }}
          >
            Close & resume
          </button>
        </section>
      )}
      {map && !locked && (
        <aside className={styles.map}>
          <p className={styles.eyebrow}>HEADQUARTERS / DIRECTORY</p>
          <div>
            {OFFICE_WORLD.rooms
              .filter((r) => r.floorId === OFFICE_WORLD.activeFloor)
              .sort(
                (a, b) =>
                  a.position[2] - b.position[2] ||
                  a.position[0] - b.position[0],
              )
              .map((room) => (
                <span key={room.id}>{room.name}</span>
              ))}
          </div>
          <p>
            Rooms open off the central atrium.
            <br />
            Follow the floor light strips.
          </p>
        </aside>
      )}
      <footer className={styles.footer}>
        <div>
          <span className={styles.eyebrow}>
            {headquarters
              ? "OWNER / LIVE OFFICE"
              : telemetry.time === null
                ? "EXPLORATION / VISUAL ONLY"
                : "OFFICE DEMO / VISUAL ONLY"}
          </span>
          <strong aria-live="polite">
            {headquarters?.status ?? demoChapter(telemetry.time)}
          </strong>
          {telemetry.time !== null && (
            <progress max={DEMO_DURATION} value={telemetry.time} />
          )}
        </div>
        <p>
          <kbd>WASD</kbd> Move <kbd>SHIFT</kbd> Faster <kbd>E</kbd> Interact{" "}
          <kbd>ESC</kbd> Menu
          <br />
          <small>
            Mouse / arrow keys · look around{" "}
            {reduced ? "· reduced ambient motion" : ""}
          </small>
        </p>
        <span className={styles.metrics} data-testid="world-performance">
          {telemetry.fps} FPS · {telemetry.draws} draws
          <br />
          {Math.round(telemetry.triangles / 1000)}k triangles
        </span>
      </footer>
      {hint && (
        <p className={styles.notice} role="alert">
          {hint}
        </p>
      )}
    </div>
  );
}
