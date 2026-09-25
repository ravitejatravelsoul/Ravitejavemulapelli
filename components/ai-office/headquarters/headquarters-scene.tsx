"use client";
import { stepVisualMotion } from "@/lib/ai-office/headquarters/visual-motion";
import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type {
  HeadquartersState,
  HeadquartersAgent,
} from "@/lib/ai-office/headquarters/world-state";
import {
  ROLE_STATIONS,
  visualDefinition,
  liveSample,
  type HandoffPlayback,
} from "@/lib/ai-office/headquarters/presentation";
import {
  presentationStatus,
  playbackProgress,
  playbackPhase,
  dagStatus,
} from "@/lib/ai-office/headquarters/experience";
import { Bot, Core } from "../world-prototype/world-characters";
import { Block, Ring, Sign } from "../world-prototype/world-surfaces";
import type { Vec3 } from "../world-prototype/world-campus";
const OFFLINE_TIME = { current: null };
function Equipment({ motif, color }: { motif: string; color: string }) {
  const material = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={0.16}
      metalness={0.5}
      roughness={0.35}
    />
  );
  if (motif === "shield")
    return (
      <mesh position={[0.43, -0.13, 0.25]} rotation={[0, 0, Math.PI]}>
        <circleGeometry args={[0.23, 5]} />
        {material}
      </mesh>
    );
  if (motif === "database")
    return (
      <group position={[-0.45, 0, 0]}>
        {[0, 0.1, 0.2].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[0.13, 0.13, 0.075, 16]} />
            {material}
          </mesh>
        ))}
      </group>
    );
  if (motif === "launch")
    return (
      <group position={[0.45, 0, 0]}>
        <mesh>
          <coneGeometry args={[0.12, 0.3, 12]} />
          {material}
        </mesh>
        <mesh position={[0, -0.19, 0]}>
          <cylinderGeometry args={[0.08, 0.12, 0.14, 12]} />
          {material}
        </mesh>
      </group>
    );
  if (motif === "tools")
    return (
      <group position={[-0.45, 0, 0.2]} rotation={[0, 0, -0.4]}>
        <Block
          position={[0, -0.08, 0]}
          size={[0.06, 0.35, 0.05]}
          color={color}
        />
        <mesh position={[0, 0.14, 0]}>
          <torusGeometry args={[0.095, 0.028, 8, 16, Math.PI * 1.6]} />
          {material}
        </mesh>
      </group>
    );
  if (motif === "scan" || motif === "test")
    return (
      <group position={[-0.48, 0.22, 0.06]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.18, 0.025, 8, 24]} />
          {material}
        </mesh>
        {motif === "test" && (
          <Block
            position={[0, -0.07, 0]}
            size={[0.035, 0.2, 0.035]}
            color={color}
          />
        )}
      </group>
    );
  if (motif === "palette")
    return (
      <group position={[0.45, 0.1, 0.1]}>
        {["#df91b5", "#8ecfbb", "#a5c5ef"].map((c, i) => (
          <mesh key={c} position={[i * 0.065, Math.sin(i) * 0.12, 0]}>
            <sphereGeometry args={[0.065, 12, 8]} />
            <meshStandardMaterial color={c} />
          </mesh>
        ))}
      </group>
    );
  if (motif === "command" || motif === "network")
    return (
      <group position={[0, 0.68, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            position={[
              Math.cos((i * Math.PI) / 2) * 0.25,
              0,
              Math.sin((i * Math.PI) / 2) * 0.25,
            ]}
          >
            <octahedronGeometry args={[0.07]} />
            {material}
          </mesh>
        ))}
        <Ring position={[0, 0, 0]} radius={0.25} tube={0.012} color={color} />
        {motif === "command" && (
          <Ring
            position={[0, 0.13, 0]}
            radius={0.18}
            tube={0.014}
            color={color}
          />
        )}
      </group>
    );
  return (
    <group position={[-0.5, 0.05, 0.12]}>
      <Block position={[0, 0, 0]} size={[0.36, 0.28, 0.03]} color="#1b3946" />
      {[0, 1, 2].map((i) => (
        <Block
          key={i}
          position={[
            motif === "diff" ? (i % 2 ? 0.06 : -0.06) : 0,
            0.08 - i * 0.07,
            0.025,
          ]}
          size={[motif === "plan" ? 0.14 : 0.25, 0.025, 0.012]}
          color={motif === "diff" ? (i % 2 ? "#d9a68a" : "#8ad6bd") : color}
        />
      ))}
    </group>
  );
}

function StationActivity({
  agent,
  animate,
}: {
  agent: HeadquartersAgent;
  animate: boolean;
}) {
  const group = useRef<THREE.Group>(null),
    scan = useRef<THREE.Group>(null);
  const style = presentationStatus(agent.status),
    home = ROLE_STATIONS[agent.roleId].home;
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.scale.setScalar(
      style.active && animate ? 1 + Math.sin(t * 2) * 0.04 : 1,
    );
    if (scan.current) {
      scan.current.rotation.z =
        agent.status === "THINKING" && animate ? t * 0.4 : 0;
      scan.current.position.y =
        agent.status === "TESTING" && animate ? Math.sin(t * 2.3) * 0.22 : 0;
    }
  });
  return (
    <group ref={group} position={[home[0], 1.7, home[2] - 0.5]}>
      <Ring
        position={[0, -1.55, 0]}
        radius={0.65}
        tube={style.active ? 0.028 : 0.013}
        color={style.color}
      />
      <group ref={scan}>
        {agent.status === "THINKING" ? (
          <>
            <Ring position={[0, 0.1, 0]} radius={0.34} color={style.color} />
            {[-1, 1].map((i) => (
              <mesh key={i} position={[i * 0.3, 0.1, 0]}>
                <octahedronGeometry args={[0.07]} />
                <meshBasicMaterial color={style.color} />
              </mesh>
            ))}
          </>
        ) : agent.status === "TESTING" ? (
          <>
            <Block
              position={[0, 0, 0]}
              size={[0.75, 0.025, 0.5]}
              color={style.color}
              glow={0.8}
            />
            <Ring position={[0, 0, 0]} radius={0.42} color={style.color} />
          </>
        ) : agent.status === "REVIEWING" ? (
          <>
            {[-1, 1].map((i) => (
              <group key={i} position={[i * 0.25, 0.15, 0]}>
                <Block
                  position={[0, 0, 0]}
                  size={[0.4, 0.35, 0.025]}
                  color="#173541"
                />
                {[-1, 0, 1].map((j) => (
                  <Block
                    key={j}
                    position={[0, j * 0.08, 0.03]}
                    size={[0.25, 0.018, 0.012]}
                    color={style.color}
                    glow={0.5}
                  />
                ))}
              </group>
            ))}
          </>
        ) : agent.status === "RETRYING" ? (
          <Core
            position={[0, 0.1, 0]}
            scale={0.55}
            color={style.color}
            active={animate}
          />
        ) : style.warning ? (
          <mesh position={[0, 0.1, 0]}>
            <ringGeometry args={[0.18, 0.23, 3]} />
            <meshBasicMaterial color={style.color} side={THREE.DoubleSide} />
          </mesh>
        ) : style.active ? (
          <>
            {[0, 1, 2].map((i) => (
              <Block
                key={i}
                position={[i * 0.18 - 0.18, 0.1 + i * 0.08, 0]}
                size={[0.1, 0.24, 0.035]}
                color={style.color}
                glow={0.7}
              />
            ))}
          </>
        ) : (
          <Ring
            position={[0, -0.2, 0]}
            radius={0.22}
            tube={0.012}
            color={style.color}
          />
        )}
      </group>
    </group>
  );
}
const LiveActor = memo(function LiveActor({
  agent,
  play,
  resting,
  animate,
  boss,
  acknowledgments,
}: {
  agent: HeadquartersAgent;
  play: React.RefObject<HandoffPlayback | null>;
  resting: React.RefObject<Record<string, Vec3>>;
  animate: boolean;
  boss: React.RefObject<Vec3>;
  acknowledgments: React.RefObject<Map<string, number>>;
}) {
  const definition = useMemo(() => visualDefinition(agent), [agent]),
    label = useRef<THREE.Group>(null);
  useFrame(() => {
    if (label.current) {
      const p = liveSample(
        agent,
        play.current,
        Date.now(),
        animate,
        resting.current,
      ).position;
      label.current.position.set(p[0], 0.32, p[2] + 0.8);
    }
  });
  if (!definition) return null;
  const color = presentationStatus(agent.status).color;
  return (
    <>
      <Bot
        id={agent.roleId}
        definition={definition}
        time={OFFLINE_TIME}
        active={animate}
        sampleFrame={() =>
          liveSample(agent, play.current, Date.now(), animate, resting.current)
        }
        equipment={
          <Equipment motif={ROLE_STATIONS[agent.roleId].motif} color={color} />
        }
        attention={() => {
          const now = Date.now(),
            p = play.current,
            sample = liveSample(agent, p, now, animate, resting.current),
            phase = p ? playbackPhase(p, now) : "";
          if (animate && p && phase === "TRANSFER") {
            if (agent.roleId === p.event.toRole)
              return {
                target: liveSample(
                  { roleId: p.event.fromRole, status: "IDLE" },
                  p,
                  now,
                  true,
                ).position,
                acknowledge: true,
              };
            if (agent.roleId === p.event.fromRole)
              return {
                target: ROLE_STATIONS[p.event.toRole]?.home ?? [10, 1.8, -15],
                acknowledge: false,
              };
          }
          if (
            agent.roleId === "office-engineer" &&
            ["WORKING", "REVIEWING"].includes(agent.status)
          )
            return { target: [13, 1.5, -7.5], acknowledge: false };
          const near =
            Math.hypot(
              boss.current[0] - sample.position[0],
              boss.current[2] - sample.position[2],
            ) < 2.6;
          return {
            target: near && sample.state !== "FLOATING" ? boss.current : null,
            acknowledge:
              near &&
              animate &&
              (acknowledgments.current.get(agent.roleId) ?? 0) > now,
          };
        }}
      />
      <group ref={label}>
        <Sign
          position={[0, 0, 0]}
          text={agent.name.toUpperCase()}
          sub={agent.status + (agent.attempt ? " / " + agent.attempt : "")}
          width={1.7}
          height={0.28}
          color="#536b71"
        />
      </group>
      <StationActivity agent={agent} animate={animate} />
    </>
  );
});
/** Personal-space holds affect only visual time. The runner is never delayed. */
function HandoffCore({
  play: playRef,
  resting,
  animate,
  boss,
}: {
  play: React.RefObject<HandoffPlayback | null>;
  resting: React.RefObject<Record<string, Vec3>>;
  animate: boolean;
  boss: React.RefObject<Vec3>;
}) {
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    const p = playRef.current;
    if (animate && p)
      stepVisualMotion(p, boss.current, Date.now(), resting.current);
  }, -2);
  useFrame(() => {
    const now = Date.now(),
      p = playRef.current,
      group = root.current;
    if (!group) return;
    const t = p ? playbackProgress(p, now) : -1;
    group.visible = !!(animate && p && t >= 0.42 && t < 0.62);
    if (!group.visible || !p) return;
    const from = p.motion?.transferFrom ?? p.path.at(-1)!,
      to = ROLE_STATIONS[p.event.toRole]?.home ?? [10, 1.8, -15];
    const f = Math.min(1, (t - 0.42) / 0.2),
      horizontal = p.motion?.remote
        ? Math.max(0, Math.min(1, (f - 0.25) * 2))
        : f,
      dx = to[0] - from[0],
      dz = to[2] - from[2],
      length = Math.hypot(dx, dz) || 1;
    group.position.set(
      from[0] +
        (dx / length) * (p.motion?.remote ? 0 : 0.6) +
        (dx - (dx / length) * (p.motion?.remote ? 0 : 0.6)) * horizontal,
      p.motion?.remote
        ? f < 0.25
          ? from[1] + (4.5 - from[1]) * f * 4
          : f > 0.75
            ? 4.5 + (to[1] - 4.5) * (f - 0.75) * 4
            : 4.5
        : from[1] + (to[1] - from[1]) * f + 0.25 * Math.sin(f * Math.PI),
      from[2] +
        (dz / length) * (p.motion?.remote ? 0 : 0.6) +
        (dz - (dz / length) * (p.motion?.remote ? 0 : 0.6)) * horizontal,
    );
    group.scale.setScalar(1);
    group.children[0].visible = p.event.type !== "REMEDIATION";
    group.children[1].visible = p.event.type === "REMEDIATION";
  });
  return (
    <group ref={root} visible={false}>
      <group>
        <Core scale={0.8} color="#e5c78f" active={animate} />
      </group>
      <group>
        <Core scale={0.8} color="#e49b64" active={animate} />
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <torusGeometry args={[0.38, 0.025, 6, 4]} />
          <meshStandardMaterial
            color="#e49b64"
            emissive="#e49b64"
            emissiveIntensity={0.5}
          />
        </mesh>
      </group>
    </group>
  );
}
function VerifiedCore({
  id,
  position,
  play,
  animate,
}: {
  id: string;
  position: Vec3;
  play: React.RefObject<HandoffPlayback | null>;
  animate: boolean;
}) {
  const root = useRef<THREE.Group>(null),
    signal = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (root.current) {
      const p = play.current;
      if (signal.current) {
        const receiving = !!(
          animate &&
          p?.event.type === "DELIVERY" &&
          p.event.projectId === id &&
          playbackProgress(p, Date.now()) >= 0.42 &&
          playbackProgress(p, Date.now()) < 0.62
        );
        signal.current.visible = receiving;
        signal.current.scale.setScalar(1 + 0.08 * Math.sin(Date.now() / 140));
      }
      root.current.visible = !(
        p?.event.type === "DELIVERY" &&
        p.event.projectId === id &&
        playbackProgress(p, Date.now()) < 0.62
      );
    }
  });
  return (
    <>
      <mesh
        ref={signal}
        visible={false}
        position={[position[0], 1.12, position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.48, 0.65, 32]} />
        <meshBasicMaterial
          color="#c6f5dd"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group ref={root}>
        <Core position={position} scale={0.95} active={animate} />
      </group>
    </>
  );
}
export const HeadquartersScene = memo(function HeadquartersScene({
  state,
  play,
  resting,
  animate,
  boss,
  acknowledgments,
}: {
  state: HeadquartersState;
  boss: React.RefObject<Vec3>;
  acknowledgments: React.RefObject<Map<string, number>>;
  play: React.RefObject<HandoffPlayback | null>;
  resting: React.RefObject<Record<string, Vec3>>;
  animate: boolean;
}) {
  const engineer: HeadquartersAgent = {
    roleId: "office-engineer",
    name: "Office Engineer",
    status:
      state.office.health === "REPAIRING"
        ? "WORKING"
        : state.office.health === "ESCALATED"
          ? "BLOCKED"
          : state.office.health === "HEALTHY"
            ? "IDLE"
            : "REVIEWING",
    taskId: null,
    task: null,
    lastCompletedTask: null,
    provider: null,
    model: null,
    attempt: 0,
    maxAttempts: null,
    blocker: null,
    waitingOn: [],
    runs: [],
    tokens: 0,
    costUsd: null,
  };
  const nodes = state.tasks.slice(0, 24),
    point = (i: number): Vec3 => [
      -1.7 + (i % 6) * 0.68,
      3.2 + Math.floor(i / 6) * 0.4,
      -0.1,
    ];
  return (
    <>
      <HandoffCore
        play={play}
        resting={resting}
        animate={animate}
        boss={boss}
      />
      {[...state.agents, engineer].map((a) => (
        <LiveActor
          key={a.roleId}
          agent={a}
          play={play}
          resting={resting}
          animate={animate}
          boss={boss}
          acknowledgments={acknowledgments}
        />
      ))}
      <Sign
        position={[0, 2.25, 3.1]}
        text={state.project?.title ?? "COMMAND CORE"}
        sub={
          state.project
            ? state.project.completed +
              " / " +
              state.project.total +
              " TASKS COMPLETE"
            : "NO PROJECT SELECTED"
        }
        width={3.8}
        height={0.65}
      />
      {nodes.map((n, i) => (
        <group key={n.id}>
          <mesh position={point(i)}>
            <octahedronGeometry args={[0.09]} />
            <meshBasicMaterial
              color={presentationStatus(dagStatus(n.visualStatus)).color}
            />
          </mesh>
          {n.dependsOn.map((id) => {
            const j = nodes.findIndex((t) => t.id === id);
            return j < 0 ? null : (
              <Line
                key={id}
                points={[point(j), point(i)]}
                color="#8bd4cb"
                lineWidth={1}
              />
            );
          })}
        </group>
      ))}
      {state.deliveries.slice(0, 3).map((d, i) => (
        <group key={d.id}>
          <VerifiedCore
            id={d.id}
            position={[[10, 13, 15.7][i], 1.8, -15]}
            play={play}
            animate={animate}
          />
          <Sign
            position={[[10, 13, 15.7][i], 2.7, -14.5]}
            text={d.title}
            sub="VERIFIED"
            width={2.2}
            height={0.5}
          />
        </group>
      ))}
      <Sign
        position={[-12, 3.8, -11.4]}
        text="QUALITY / SECURITY / REVIEW"
        sub={
          state.agents.filter(
            (a) =>
              ["qa-agent", "security-reviewer", "code-reviewer"].includes(
                a.roleId,
              ) && ["TESTING", "REVIEWING", "RETRYING"].includes(a.status),
          ).length + " ACTIVE"
        }
        width={5.7}
        height={0.6}
      />
      <Sign
        position={[0, 3.5, -11.2]}
        text="OWNER COMMAND"
        sub={`${state.office.activeProjects} PROJECTS / ${state.office.health} / ${state.approvals.length} APPROVALS`}
        width={5.1}
        height={0.6}
      />
      <Sign
        position={[0, 2.65, -11.2]}
        text={`BUDGET $${state.budget.remainingUsd.toFixed(2)} REMAINING`}
        sub={`${state.incidents.filter((i) => i.status !== "RESOLVED").length} OPEN INCIDENTS`}
        width={3.5}
        height={0.5}
        color={state.approvals.length ? "#d8ba81" : "#abc8be"}
      />
      <Sign
        position={[12, 3.3, -4.8]}
        text="INFRASTRUCTURE / MODEL LAB"
        sub={state.office.health + " / " + state.office.runner}
        width={4.5}
        height={0.6}
      />
    </>
  );
});
