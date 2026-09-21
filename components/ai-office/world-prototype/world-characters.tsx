"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { BOTS, demoBot, type BotId, type Vec3 } from "./world-model";
import { Block, Ring, Screen, palette } from "./world-surfaces";
export function Bot({
  id,
  time,
  active,
}: {
  id: BotId;
  time: React.RefObject<number | null>;
  active: boolean;
}) {
  const root = useRef<THREE.Group>(null),
    body = useRef<THREE.Group>(null),
    arms = useRef<THREE.Group>(null),
    carry = useRef<THREE.Group>(null),
    ring = useRef<THREE.Group>(null);
  const elapsed = useRef(0),
    last = useRef(new THREE.Vector3(...BOTS[id].home)),
    yaw = useRef(BOTS[id].workRotation);
  const b = BOTS[id];
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    root.current?.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
  }, []);
  useFrame((_, dt) => {
    if (!root.current || !body.current) return;
    const sample = demoBot(id, time.current);
    const p = sample.position;
    root.current.position.set(...p);
    if (active) elapsed.current += dt;
    body.current.position.y = active
      ? Math.sin(elapsed.current * 1.9 + id.length) * 0.035
      : 0;
    const dx = p[0] - last.current.x,
      dz = p[2] - last.current.z;
    if (Math.hypot(dx, dz) > 0.001) yaw.current = Math.atan2(dx, dz);
    else if (sample.state === "WORKING") yaw.current = b.workRotation;
    else if (sample.state === "HANDOFF" || sample.state === "INTERACTING") {
      const other =
        id === "product"
          ? "architect"
          : id === "developer"
            ? "architect"
            : (time.current ?? 0) < 25
              ? "product"
              : "developer";
      const target = demoBot(other, time.current).position;
      yaw.current = Math.atan2(target[0] - p[0], target[2] - p[2]);
    }
    if (
      sample.state === "IDLE" &&
      Math.hypot(camera.position.x - p[0], camera.position.z - p[2]) < 4
    ) {
      yaw.current = Math.atan2(
        camera.position.x - p[0],
        camera.position.z - p[2],
      );
    }
    const difference = Math.atan2(
      Math.sin(yaw.current - root.current.rotation.y),
      Math.cos(yaw.current - root.current.rotation.y),
    );
    root.current.rotation.y += difference * Math.min(1, dt * 6);
    last.current.set(...p);
    if (arms.current)
      arms.current.rotation.x =
        sample.state === "INTERACTING"
          ? -0.65
          : sample.state === "HANDOFF"
            ? -0.45
            : sample.state === "WORKING"
              ? -0.25 + Math.sin(elapsed.current * 5) * 0.13
              : 0;
    if (ring.current && active) ring.current.rotation.z += dt * 0.35;
    if (carry.current) carry.current.visible = sample.carry;
  });
  return (
    <group ref={root} position={b.home}>
      <ContactShadow time={time} id={id} />
      <group ref={body}>
        {/* Separate ceramic head, graphite chassis and articulated manipulators. */}
        <mesh position={[0, 0.14, 0]} scale={[0.43, 0.32, 0.35]}>
          <sphereGeometry args={[1, 32, 20]} />
          <meshPhysicalMaterial
            color="#e9ebe6"
            metalness={0.34}
            roughness={0.22}
            clearcoat={0.7}
          />
        </mesh>
        <mesh position={[0, 0.15, 0.21]} scale={[0.355, 0.195, 0.19]}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshPhysicalMaterial
            color="#0c1d27"
            metalness={0.35}
            roughness={0.2}
            clearcoat={0.5}
            envMapIntensity={0.45}
          />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.145, 0.165, 0.406]}>
            <mesh>
              <circleGeometry
                args={[b.variant === "analyst" ? 0.055 : 0.04, 24]}
              />
              <meshBasicMaterial color={b.color} />
            </mesh>
            <mesh position={[0.006, 0.008, 0.003]}>
              <circleGeometry args={[0.019, 16]} />
              <meshBasicMaterial color="#eafcff" />
            </mesh>
          </group>
        ))}
        <Block
          position={[0, 0.065, 0.389]}
          size={[0.07, 0.012, 0.007]}
          color={b.color}
          glow={0.6}
          rounded
        />
        <mesh position={[0, -0.21, -0.035]} scale={[0.3, 0.32, 0.255]}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshStandardMaterial
            color="#3e4e56"
            metalness={0.8}
            roughness={0.27}
          />
        </mesh>
        <RoundedBox
          position={[0, -0.23, 0.15]}
          args={[0.36, 0.29, 0.16]}
          radius={0.07}
          smoothness={3}
        >
          <meshStandardMaterial
            color="#d4ddd8"
            metalness={0.35}
            roughness={0.35}
          />
        </RoundedBox>
        <Block
          position={[0, -0.19, 0.235]}
          size={[0.17, 0.022, 0.013]}
          color={b.color}
          glow={0.8}
        />
        <Ring
          position={[0, -0.49, 0]}
          radius={0.18}
          tube={0.024}
          color={b.color}
        />
        <mesh position={[0, -0.48, 0]}>
          <cylinderGeometry args={[0.23, 0.16, 0.11, 32]} />
          <meshStandardMaterial
            color={palette.dark}
            metalness={0.8}
            roughness={0.25}
          />
        </mesh>
        <group ref={arms}>
          {[-1, 1].map((s) => (
            <group
              key={s}
              position={[s * 0.35, -0.15, 0]}
              rotation={[0, 0, s * 0.28]}
            >
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.09, 0.09, 0.1, 24]} />
                <meshStandardMaterial
                  color={palette.metal}
                  metalness={0.85}
                  roughness={0.2}
                />
              </mesh>
              <RoundedBox
                position={[0, -0.12, 0.015]}
                args={[0.09, 0.24, 0.1]}
                radius={0.035}
                smoothness={2}
              >
                <meshStandardMaterial
                  color="#e0e6df"
                  metalness={0.4}
                  roughness={0.28}
                />
              </RoundedBox>
              <mesh position={[0, -0.25, 0.03]}>
                <sphereGeometry args={[0.065, 16, 10]} />
                <meshStandardMaterial color={palette.dark} metalness={0.7} />
              </mesh>
              <Block
                position={[0, -0.25, 0.125]}
                size={[0.08, 0.065, 0.2]}
                rounded
                color={palette.metal}
              />
              {[-1, 1].map((j) => (
                <Block
                  key={j}
                  position={[j * 0.035, -0.25, 0.25]}
                  size={[0.018, 0.065, 0.08]}
                  color={b.color}
                  rounded
                />
              ))}
            </group>
          ))}
        </group>
        {b.variant === "planner" && (
          <group position={[-0.55, 0.04, 0.16]} rotation={[0, -0.25, 0]}>
            <Screen
              position={[0, 0, 0]}
              kind="planning"
              color={b.color}
              scale={0.16}
            />
          </group>
        )}
        {b.variant === "analyst" && (
          <group ref={ring} position={[0, 0.16, -0.07]} rotation={[0.2, 0, 0]}>
            <Ring
              radius={0.53}
              tube={0.008}
              rotation={[0, 0, 0]}
              color={b.color}
            />
            {[0, 1, 2].map((i) => (
              <mesh
                key={i}
                position={[
                  Math.cos(i * 2.1) * 0.53,
                  Math.sin(i * 2.1) * 0.53,
                  0,
                ]}
              >
                <octahedronGeometry args={[0.05]} />
                <meshBasicMaterial color={b.color} />
              </mesh>
            ))}
          </group>
        )}
        {b.variant === "builder" && (
          <>
            <Block
              position={[0, -0.2, -0.29]}
              size={[0.3, 0.32, 0.14]}
              color={palette.metal}
              rounded
            />
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.4, 0.13, 0]}
                rotation={[0, 0, Math.PI / 2]}
              >
                <cylinderGeometry args={[0.09, 0.09, 0.08, 24]} />
                <meshStandardMaterial
                  color={b.color}
                  metalness={0.7}
                  roughness={0.3}
                />
              </mesh>
            ))}
          </>
        )}
        <group ref={carry} position={[0, -0.05, 0.68]}>
          <Core color={b.color} scale={0.65} active={active} />
        </group>
      </group>
    </group>
  );
}
function ContactShadow({
  id,
  time,
}: {
  id: BotId;
  time: React.RefObject<number | null>;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 32);
    g.addColorStop(0, "#182b3580");
    g.addColorStop(1, "#182b3500");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    if (mesh.current) {
      const p = demoBot(id, time.current).position;
      const home = BOTS[id].home;
      mesh.current.position.y =
        -p[1] +
        (Math.hypot(p[0] - home[0], p[2] - home[2]) < 0.8 ? 0.083 : 0.035);
    }
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.6, 1.6]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}
export function Core({
  position = [0, 0, 0],
  color = palette.cyan,
  scale = 1,
  active = true,
}: {
  position?: Vec3;
  color?: string;
  scale?: number;
  active?: boolean;
}) {
  const inner = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (inner.current && active) {
      inner.current.rotation.y += dt * 0.6;
      inner.current.rotation.z += dt * 0.19;
    }
  });
  return (
    <group position={position} scale={scale}>
      <RoundedBox args={[0.48, 0.48, 0.48]} radius={0.035} smoothness={2}>
        <meshPhysicalMaterial
          color="#b8eded"
          transparent
          opacity={0.16}
          roughness={0.1}
          metalness={0.2}
          clearcoat={1}
          depthWrite={false}
        />
      </RoundedBox>
      <mesh>
        <boxGeometry args={[0.49, 0.49, 0.49]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.4} />
      </mesh>
      <group ref={inner}>
        <mesh>
          <octahedronGeometry args={[0.17]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.65}
            metalness={0.6}
            roughness={0.2}
          />
        </mesh>
        <mesh rotation={[0.4, 0.3, 0]}>
          <icosahedronGeometry args={[0.25, 0]} />
          <meshBasicMaterial
            color={color}
            wireframe
            transparent
            opacity={0.7}
          />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh
            key={i}
            position={[
              Math.sin(i * 2.4) * 0.19,
              Math.cos(i * 1.7) * 0.19,
              Math.sin(i) * 0.19,
            ]}
          >
            <sphereGeometry args={[0.012, 6, 4]} />
            <meshBasicMaterial color="#f2ffff" />
          </mesh>
        ))}
      </group>
    </group>
  );
}
export function Transfer({
  time,
  active,
}: {
  time: React.RefObject<number | null>;
  active: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!root.current) return;
    const t = time.current ?? -1;
    root.current.visible = (t >= 15 && t < 18) || (t >= 38 && t < 41);
    if (!root.current.visible) return;
    const first = t < 18,
      f = (t - (first ? 15 : 38)) / 3,
      a = demoBot(first ? "product" : "architect", t).position,
      b = demoBot(first ? "architect" : "developer", t).position;
    const distance = Math.hypot(b[0] - a[0], b[2] - a[2]),
      nx = (b[0] - a[0]) / distance,
      nz = (b[2] - a[2]) / distance;
    const smooth = f * f * (3 - 2 * f);
    root.current.position.set(
      a[0] + nx * 0.68 + (b[0] - a[0] - nx * 1.36) * smooth,
      a[1] + (b[1] - a[1]) * smooth - 0.05 + Math.sin(f * Math.PI) * 0.12,
      a[2] + nz * 0.68 + (b[2] - a[2] - nz * 1.36) * smooth,
    );
    root.current.rotation.y = f * Math.PI;
  });
  return (
    <group ref={root} visible={false}>
      <Core color="#b4f4e4" scale={0.65} active={active} />
      <Ring radius={0.23} tube={0.005} />
    </group>
  );
}
