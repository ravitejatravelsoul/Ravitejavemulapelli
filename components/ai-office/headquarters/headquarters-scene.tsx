"use client";
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
const LiveActor = memo(function LiveActor({
  agent,
  play,
  animate,
}: {
  agent: HeadquartersAgent;
  play: React.RefObject<HandoffPlayback | null>;
  animate: boolean;
}) {
  const definition = useMemo(() => visualDefinition(agent), [agent]);
  const label = useRef<THREE.Group>(null);
  useFrame(() => {
    if (label.current) {
      const p = liveSample(agent, play.current, Date.now(), animate).position;
      label.current.position.set(p[0], p[1] + 0.95, p[2]);
    }
  });
  if (!definition) return null;
  const color = ["FAILED", "BLOCKED"].includes(agent.status)
    ? "#efb094"
    : agent.status === "PAUSED"
      ? "#a5afb0"
      : definition.color;
  return (
    <>
      <Bot
        id={agent.roleId}
        definition={definition}
        time={OFFLINE_TIME}
        active={animate}
        sampleFrame={() => liveSample(agent, play.current, Date.now(), animate)}
        equipment={
          <Equipment motif={ROLE_STATIONS[agent.roleId].motif} color={color} />
        }
      />
      <group ref={label}>
        <Sign
          position={[0, 0, 0]}
          text={agent.name.toUpperCase()}
          sub={
            agent.status + (agent.attempt ? " / ATTEMPT " + agent.attempt : "")
          }
          width={2.35}
          height={0.45}
          color="#304d56"
        />
      </group>
      <Ring
        position={[definition.home[0], 0.08, definition.home[2]]}
        radius={0.55}
        tube={0.012}
        color={color}
      />
    </>
  );
});
/** A persisted transition alone drives this visual core; no lifecycle callbacks. */
function HandoffCore({
  play,
  animate,
}: {
  play: React.RefObject<HandoffPlayback | null>;
  animate: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    const p = play.current,
      group = root.current;
    if (!group) return;
    const t = p ? (Date.now() - p.startedAt) / 12000 : -1;
    group.visible = !!(animate && p && t >= 0.5 && t < 0.65);
    if (!group.visible || !p) return;
    const from = p.path.at(-1)!,
      to = ROLE_STATIONS[p.event.toRole].home;
    const f = Math.min(1, (t - 0.5) / 0.08);
    group.position.set(
      from[0] + (to[0] - from[0]) * f,
      from[1] + (to[1] - from[1]) * f + 0.25 * Math.sin(f * Math.PI),
      from[2] + (to[2] - from[2]) * f,
    );
    group.scale.setScalar(t > 0.58 ? Math.max(0, 1 - (t - 0.58) / 0.07) : 1);
  });
  return (
    <group ref={root} visible={false}>
      <Core scale={0.65} color="#e4ca91" active={animate} />
    </group>
  );
}
export const HeadquartersScene = memo(function HeadquartersScene({
  state,
  play,
  animate,
}: {
  state: HeadquartersState;
  play: React.RefObject<HandoffPlayback | null>;
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
      <HandoffCore play={play} animate={animate} />
      {[...state.agents, engineer].map((a) => (
        <LiveActor key={a.roleId} agent={a} play={play} animate={animate} />
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
              color={
                n.status === "DONE"
                  ? "#80d6b8"
                  : n.status === "IN_PROGRESS"
                    ? "#e9ce98"
                    : n.status === "FAILED" || n.status === "BLOCKED"
                      ? "#ed997f"
                      : "#8eabb8"
              }
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
          <Core
            position={[[10, 13, 15.7][i], 1.8, -15]}
            scale={0.95}
            active={animate}
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
        sub={
          state.approvals.length
            ? state.approvals.length + " OWNER DECISIONS REQUIRED"
            : "NO PENDING OWNER DECISIONS"
        }
        width={5.1}
        height={0.6}
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
