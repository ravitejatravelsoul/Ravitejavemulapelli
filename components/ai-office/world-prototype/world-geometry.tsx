"use client";
import { OperationalWorld } from "./world-mode";
import { useContext, memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WALLS, demoBot, type Vec3 } from "./world-model";
import {
  Block,
  Glass,
  Ring,
  Sign,
  Screen,
  Plant,
  Console,
  Reflections,
  palette,
} from "./world-surfaces";
import { Bot, Core, Transfer } from "./world-characters";
import {
  OFFICE_WORLD,
  VISUAL_AGENTS,
  roomPosition,
  moduleWalls,
  type RoomDefinition,
  type WorkstationDefinition,
  type PlacedAgent,
} from "./world-campus";
import { CityEnvironment } from "./world-city";

function StoneFloor() {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const x = c.getContext("2d")!;
    x.fillStyle = "#c8c8bf";
    x.fillRect(0, 0, 512, 512);
    let seed = 37;
    for (let i = 0; i < 24000; i++) {
      seed = (seed * 16807) % 2147483647;
      const px = seed % 512;
      seed = (seed * 16807) % 2147483647;
      const py = seed % 512;
      x.fillStyle = i % 2 ? "#aaaaa609" : "#ffffff16";
      x.fillRect(px, py, 2, 1);
    }
    x.strokeStyle = "#7b858329";
    x.lineWidth = 1;
    x.strokeRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 9);
    t.anisotropy = 4;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh
      position={[0, -0.005, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[34, 36]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.36}
        metalness={0.12}
        envMapIntensity={0.45}
      />
    </mesh>
  );
}
function Architecture() {
  return (
    <group>
      <StoneFloor />
      {[-12, 12].map((x) => (
        <Block
          key={x}
          position={[x, 0.006, 4.8]}
          size={[9.7, 0.009, 8.6]}
          color="#a4ada8"
          roughness={0.7}
        />
      ))}
      {[-12, 12].map((x) => (
        <Block
          key={x}
          position={[x, 0.006, -5.7]}
          size={[9.7, 0.009, 10.2]}
          color="#a9b5b5"
          roughness={0.6}
        />
      ))}
      {/* Two elevated galleries frame the open central volume. They are scenic only. */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <Block
            position={[side * 12, 4.6, -0.5]}
            size={[10, 0.34, 34]}
            color={palette.ivory}
          />
          <Block
            position={[side * 11.9, 4.4, -0.5]}
            size={[9.4, 0.04, 33]}
            color="#75817f"
            roughness={0.8}
          />
          <Block
            position={[side * 7.06, 4.4, -0.5]}
            size={[0.05, 0.035, 33]}
            color="#f2d9b9"
            glow={0.8}
          />
          <Glass
            position={[side * 7.08, 5.35, -0.5]}
            size={[0.06, 1.15, 33]}
            opacity={0.13}
          />
          <Block
            position={[side * 7.08, 5.95, -0.5]}
            size={[0.06, 0.055, 33]}
            color={palette.metal}
          />
          {[-14, -6, 3, 12].map((z) => (
            <group key={z}>
              <Block
                position={[side * 15, 6.55, z]}
                size={[0.09, 3.5, 0.12]}
                color={palette.metal}
              />
              <Glass
                position={[side * 13, 6.45, z]}
                size={[4, 3.2, 0.05]}
                opacity={0.1}
              />
              <Block
                position={[side * 12, 4.95, z + 0.9]}
                size={[3.4, 0.24, 0.9]}
                color={palette.dark}
                rounded
              />
              <Block
                position={[side * 12, 5.75, z + 1.1]}
                size={[2.8, 0.03, 0.025]}
                color="#b6dfdf"
                glow={0.7}
              />
            </group>
          ))}
          {[-15.8, -7.5, 0.5, 8.5, 16].map((z) => (
            <group key={z}>
              <Block
                position={[side * 16.75, 4.2, z]}
                size={[0.22, 8.4, 0.24]}
                color={palette.ivory}
              />
              <Block
                position={[side * 7.1, 2.2, z]}
                size={[0.16, 4.4, 0.16]}
                color={palette.ivory}
              />
            </group>
          ))}
          <Block
            position={[side * 12, 8.45, 0]}
            size={[10, 0.28, 36]}
            color={palette.ivory}
          />
          <Block
            position={[side * 12, 8.29, 0]}
            size={[0.09, 0.025, 34]}
            color="#fce9d2"
            glow={0.8}
          />
        </group>
      ))}
      {/* High skylight coffers; the center remains transparent to daylight. */}
      {[-16, -12, -8, -4, 0, 4, 8, 12, 16].map((z) => (
        <group key={z}>
          <Block
            position={[0, 8.35, z]}
            size={[14, 0.3, 0.17]}
            color={palette.ivory}
          />
          <Block
            position={[0, 8.17, z]}
            size={[12, 0.02, 0.055]}
            color="#fff4e3"
            glow={0.7}
          />
        </group>
      ))}
      <Glass position={[0, 8.55, 0]} size={[14, 0.04, 36]} opacity={0.08} />
      {WALLS.map((w, i) => {
        const outer = i < 4,
          height = outer ? 8.4 : 4.2;
        return (
          <group key={i}>
            <Block
              position={[w.x, 0.08, w.z]}
              size={[w.w, 0.16, w.d]}
              color={palette.metal}
            />
            <Glass
              position={[w.x, height / 2, w.z]}
              size={[w.w, height - 0.25, w.d * 0.3]}
              opacity={outer ? 0.08 : 0.12}
            />
            <Block
              position={[w.x, height, w.z]}
              size={[w.w, 0.12, w.d]}
              color={palette.ivory}
            />
            {!outer && (
              <Block
                position={[w.x, 1.1, w.z]}
                size={[w.w, 0.016, w.d * 0.4]}
                color="#ced8d3"
              />
            )}
          </group>
        );
      })}
      {/* Curved suspended canopy gives the atrium its recognizable silhouette. */}
      {[5.1, 5.45, 5.8].map((r, i) => (
        <Ring
          key={r}
          position={[0, 6.6 + i * 0.22, 0]}
          radius={r}
          tube={i === 1 ? 0.16 : 0.045}
          color={i === 1 ? palette.ivory : "#dac9af"}
        />
      ))}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Block
            position={[s * 5.8, 0.012, 3]}
            size={[0.024, 0.01, 22]}
            color="#a7b9b4"
          />
          <Block
            position={[s * 6.3, 0.018, 3]}
            size={[0.025, 0.01, 22]}
            color="#f6e6ce"
            glow={0.5}
          />
        </group>
      ))}
      {[-12, 12].flatMap((x) =>
        [-7, 7].map((z) => (
          <group key={x + ":" + z}>
            <Block
              position={[x, 4.36, z]}
              size={[5.6, 0.06, 0.055]}
              color="#fbedd4"
              glow={0.9}
            />
            <Block
              position={[x, 4.36, z + 1]}
              size={[5.6, 0.06, 0.055]}
              color="#fbedd4"
              glow={0.9}
            />
          </group>
        )),
      )}
    </group>
  );
}
function Globe({ active }: { active: boolean }) {
  const group = useRef<THREE.Group>(null);
  const dots = useMemo(() => {
    const points = [];
    for (let i = 0; i < 1700; i++) {
      const y = 1 - (2 * i) / 1699,
        r = Math.sqrt(1 - y * y),
        a = i * 2.39996;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      if (Math.sin(x * 9 + z * 4) + Math.cos(y * 8 - z * 6) > -0.2)
        points.push(x * 1.12, y * 1.12, z * 1.12);
    }
    return new Float32Array(points);
  }, []);
  useFrame((_, dt) => {
    if (group.current && active) group.current.rotation.y += dt * 0.075;
  });
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[1.09, 40, 24]} />
        <meshPhysicalMaterial
          color="#237575"
          transparent
          opacity={0.35}
          roughness={0.12}
          metalness={0.55}
          depthWrite={false}
        />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dots, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#398f99"
          size={0.025}
          transparent
          opacity={0.8}
        />
      </points>
      {[0, Math.PI / 3, (Math.PI * 2) / 3].map((a) => (
        <Ring
          key={a}
          radius={1.13}
          tube={0.004}
          rotation={[0, a, 0]}
          color="#7abbbc"
        />
      ))}
      <Ring radius={1.13} tube={0.006} />
      <Core scale={1.1} active={active} />
    </group>
  );
}
function Atrium({ active }: { active: boolean }) {
  const orbit = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (orbit.current && active) orbit.current.rotation.y += dt * 0.08;
  });
  return (
    <group>
      <mesh
        position={[0, 0.012, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <ringGeometry args={[2.35, 4.25, 96]} />
        <meshStandardMaterial color="#7c8d8e" metalness={0.4} roughness={0.4} />
      </mesh>
      {[2.34, 3.9, 4.25].map((r) => (
        <Ring
          key={r}
          position={[0, 0.026, 0]}
          radius={r}
          tube={0.012}
          color={r === 3.9 ? "#e8d4b6" : "#8aafae"}
        />
      ))}
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.25, 2.3, 0.4, 96]} />
        <meshStandardMaterial color="#dddcd2" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.66, 0]} castShadow>
        <cylinderGeometry args={[1.45, 1.9, 0.72, 96]} />
        <meshStandardMaterial
          color={palette.dark}
          metalness={0.8}
          roughness={0.22}
        />
      </mesh>
      <mesh position={[0, 1.02, 0]}>
        <cylinderGeometry args={[1.56, 1.5, 0.12, 96]} />
        <meshStandardMaterial
          color="#a0b4b2"
          metalness={0.85}
          roughness={0.27}
        />
      </mesh>
      <Ring position={[0, 1.09, 0]} radius={1.47} tube={0.016} />
      <group position={[0, 2.8, 0]}>
        <Globe active={active} />
      </group>
      <group ref={orbit} position={[0, 2.8, 0]}>
        <Ring radius={1.65} rotation={[1.15, 0, 0.35]} tube={0.012} />
        <Ring
          radius={1.85}
          rotation={[1.9, 0, -0.25]}
          color="#b7c5c2"
          tube={0.01}
        />
        <mesh position={[1.85, 0, 0]}>
          <sphereGeometry args={[0.04, 12, 8]} />
          <meshBasicMaterial color="#e5ffff" />
        </mesh>
      </group>
      <Sign
        position={[0, 0.68, 1.86]}
        text="ORCHESTRATOR"
        sub="SHARED INTELLIGENCE / VISUAL CORE"
        color="#d7e7e3"
        width={2.4}
        height={0.5}
      />
      <Screen
        position={[0, 1.03, 1.48]}
        rotation={[-0.8, 0, 0]}
        kind="overview"
        scale={0.47}
      />
      <pointLight
        position={[0, 2.4, 0]}
        color="#7cd6d1"
        intensity={6}
        distance={6}
      />
    </group>
  );
}
function Topology({ active, color }: { active: boolean; color: string }) {
  const root = useRef<THREE.Group>(null);
  const nodes = useMemo(
    () =>
      [
        [0, 0.4, 0],
        [-0.6, 0, -0.1],
        [0.6, 0, -0.1],
        [-0.8, -0.45, 0.1],
        [0, -0.45, 0.15],
        [0.8, -0.45, 0.1],
      ] as Vec3[],
    [],
  );
  const lines = useMemo(
    () =>
      new Float32Array(
        [
          [0, 1],
          [0, 2],
          [1, 3],
          [1, 4],
          [2, 4],
          [2, 5],
        ].flatMap(([a, b]) => [...nodes[a], ...nodes[b]]),
      ),
    [nodes],
  );
  useFrame((_, dt) => {
    if (root.current && active) root.current.rotation.y += dt * 0.13;
  });
  return (
    <group ref={root}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.65} />
      </lineSegments>
      {nodes.map((p, i) => (
        <mesh key={i} position={p}>
          <octahedronGeometry args={[0.095]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.25}
            metalness={0.5}
            roughness={0.3}
          />
        </mesh>
      ))}
    </group>
  );
}
function Station({
  room,
  station,
  agent,
  time,
  active,
}: {
  room: RoomDefinition;
  station: WorkstationDefinition;
  agent?: PlacedAgent;
  time: React.RefObject<number | null>;
  active: boolean;
}) {
  const operational = useContext(OperationalWorld);
  const b = agent ?? {
      color: room.visualTheme.accent,
      home: roomPosition(OFFICE_WORLD, room, station.dock),
    },
    arch = station.kind === "architecture",
    position = roomPosition(OFFICE_WORLD, room, station.position),
    reactive = useRef<THREE.Group>(null),
    scan = useRef<THREE.Mesh>(null),
    light = useRef<THREE.PointLight>(null),
    clock = useRef(0);
  useFrame((_, dt) => {
    if (active) clock.current += dt;
    const working = agent
      ? demoBot(agent.id, time.current).state === "WORKING"
      : false;
    if (reactive.current) {
      const target = working ? 1 : 0.88;
      reactive.current.scale.y = THREE.MathUtils.damp(
        reactive.current.scale.y,
        target,
        3,
        dt,
      );
      reactive.current.position.y = Math.sin(clock.current * 0.7) * 0.014;
    }
    if (light.current) light.current.intensity = working ? 7 : 1.4;
    if (scan.current) {
      scan.current.visible = working;
      scan.current.position.y = 1.45 + ((clock.current * 0.22) % 1.3);
    }
  });
  return (
    <group>
      <group position={position} rotation={[0, station.rotation, 0]}>
        <Console position={[0, 0, 0]} />
        <group ref={reactive}>
          <mesh ref={scan} position={[0, 1.45, -0.255]} visible={false}>
            <planeGeometry args={[3.05, 0.012]} />
            <meshBasicMaterial color={b.color} transparent opacity={0.65} />
          </mesh>
          <Screen
            position={[0, 2.12, -0.27]}
            scale={1.2}
            kind={
              arch
                ? "blueprint"
                : station.kind === "planning"
                  ? "planning"
                  : "code"
            }
            color={b.color}
          />
          <Screen
            position={[-2.05, 1.9, 0.08]}
            rotation={[0, 0.32, 0]}
            scale={0.49}
            kind={arch ? "overview" : "planning"}
            color={b.color}
          />
          <Screen
            position={[2.05, 1.9, 0.08]}
            rotation={[0, -0.32, 0]}
            scale={0.49}
            kind={arch ? "blueprint" : "code"}
            color={b.color}
          />
          <Glass
            position={[0, 2.13, -0.32]}
            size={[3.5, 2, 0.02]}
            opacity={0.1}
          />
          {arch && (
            <group position={[0, 3.28, -0.2]}>
              <Topology color={b.color} active={active} />
              <Ring radius={0.47} tube={0.006} color={b.color} />
            </group>
          )}
        </group>
        <pointLight
          ref={light}
          position={[0, 2, 0.7]}
          color={b.color}
          intensity={1.4}
          distance={5}
        />
        <Block
          position={[0, 0.1, 0]}
          size={[4.5, 0.06, 1.2]}
          color={palette.metal}
          rounded
        />
      </group>
      <mesh
        position={[b.home[0], position[1] + 0.025, b.home[2]]}
        receiveShadow
      >
        <cylinderGeometry args={[0.68, 0.73, 0.05, 48]} />
        <meshStandardMaterial
          color="#9aaaa8"
          metalness={0.65}
          roughness={0.36}
        />
      </mesh>
      <Ring
        position={[b.home[0], position[1] + 0.06, b.home[2]]}
        radius={0.58}
        tube={0.008}
        color={b.color}
      />
      {agent && !operational && (
        <Bot id={agent.id} time={time} active={active} />
      )}
    </group>
  );
}
function GreenWall() {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 240; i++) {
      const x = -14.5 + (i % 24) * 0.22,
        y = 1.25 + Math.floor(i / 24) * 0.22;
      matrix.compose(
        new THREE.Vector3(x, y, 16.93 + Math.sin(i * 2) * 0.07),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(i, 0, i * 0.7)),
        new THREE.Vector3(0.17, 0.15, 0.08),
      );
      ref.current!.setMatrixAt(i, matrix);
      ref.current!.setColorAt(
        i,
        new THREE.Color(
          i % 3 === 0 ? "#72865a" : i % 2 ? "#345647" : "#4c6d4b",
        ),
      );
    }
    ref.current!.instanceMatrix.needsUpdate = true;
    ref.current!.computeBoundingSphere();
    if (ref.current!.instanceColor)
      ref.current!.instanceColor.needsUpdate = true;
  }, []);
  return (
    <group>
      <Block
        position={[-12, 2.1, 17.1]}
        size={[5.6, 2.75, 0.2]}
        color="#3d5646"
        rounded
      />
      <instancedMesh ref={ref} args={[undefined, undefined, 240]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
    </group>
  );
}
function Lounge({
  position,
  rotation = 0,
}: {
  position: Vec3;
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Block
        position={[0, 0.29, 0]}
        size={[2.6, 0.18, 1.15]}
        color={palette.dark}
        rounded
      />
      <Block
        position={[0, 0.53, 0.05]}
        size={[2.5, 0.32, 1.05]}
        color="#b6b0a0"
        rounded
        roughness={0.95}
      />
      <Block
        position={[0, 0.88, -0.44]}
        size={[2.5, 0.68, 0.22]}
        color="#b6b0a0"
        rounded
        roughness={0.95}
      />
      {[-1, 1].map((s) => (
        <Block
          key={s}
          position={[s * 1.25, 0.7, 0]}
          size={[0.18, 0.48, 1.08]}
          color="#8b745b"
          rounded
          roughness={0.7}
        />
      ))}
    </group>
  );
}
function Reception() {
  return (
    <group>
      <Sign
        position={[0, 4, 8.835]}
        text="TEJA’S AI OFFICE"
        sub="AUTONOMOUS ENGINEERING HEADQUARTERS / LEVEL 50"
        width={6.5}
        height={0.95}
      />
      <Block
        position={[0, 4.03, 8.76]}
        size={[7.5, 1.4, 0.12]}
        color={palette.ivory}
        rounded
      />
      <Block
        position={[0, 4.74, 8.76]}
        size={[7, 0.025, 0.14]}
        color="#e5cfac"
        glow={0.6}
      />
      <GreenWall />
      <group position={[-5.9, 0, 13.2]} rotation={[0, Math.PI / 2, 0]}>
        <Block
          position={[0, 2.3, 0]}
          size={[2.4, 2.1, 0.07]}
          color={palette.ivory}
          rounded
        />
        <Sign
          position={[0, 3.05, 0.045]}
          text="THE CAMPUS"
          sub="TEJA’S AI OFFICE"
          width={2}
          height={0.42}
        />
        {OFFICE_WORLD.floors.map((floor, i) => (
          <Sign
            key={floor.id}
            position={[0, 2.65 - i * 0.36, 0.045]}
            text={floor.name.toUpperCase()}
            sub={floor.playable ? "YOU ARE HERE" : "FUTURE OPERATIONS"}
            width={2.1}
            height={0.32}
          />
        ))}
      </group>
      <Console position={[-12, 0, 15]} width={4.9} />
      <Sign
        position={[-12, 0.58, 15.63]}
        text="T / WELCOME"
        sub="PEOPLE + AI — A BRIGHTER TOMORROW"
        width={3.9}
        height={0.62}
        color="#c1d5d1"
      />
      <Screen
        position={[-12, 2.5, 16.72]}
        rotation={[0, Math.PI, 0]}
        kind="overview"
        scale={0.9}
      />
      <Lounge position={[12, 0, 15.7]} />
      <Lounge position={[15.5, 0, 13.6]} rotation={-Math.PI / 2} />
      <mesh position={[12, 0.013, 14.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.8, 48]} />
        <meshStandardMaterial color="#a9ada6" roughness={1} />
      </mesh>
      <Plant position={[15.6, 0, 10]} />
      <Plant position={[-15.6, 0, 10]} />
      <Sign
        position={[12, 2.8, 17.75]}
        rotation={[0, Math.PI, 0]}
        text="A BRIGHTER TOMORROW"
        sub="HUMAN AMBITION. SHARED INTELLIGENCE."
        width={5.5}
        height={0.65}
      />
    </group>
  );
}
function Infrastructure({ active }: { active: boolean }) {
  const operational = useContext(OperationalWorld);
  const pulses = useRef<THREE.Group>(null),
    elapsed = useRef(0);
  useFrame((_, dt) => {
    if (active) elapsed.current += dt;
    if (pulses.current)
      pulses.current.position.y = Math.sin(elapsed.current * 0.6) * 0.12;
  });
  return (
    <group>
      <Sign
        position={[12, 3.75, -10.78]}
        color="#d5e0db"
        text="04 / INFRASTRUCTURE"
        sub={operational ? "OFFICE ENGINEER / MODEL LAB" : "OFFICE ENGINEER / FUTURE HOME"}
        width={4.6}
        height={0.62}
      />
      {[10, 13, 15.7].map((x, i) => (
        <group key={x} position={[x, 0, -7.5]}>
          <Block
            position={[0, 0.16, 0]}
            size={[1.6, 0.32, 2.4]}
            color={palette.ivory}
            rounded
          />
          <Block
            position={[0, 2.95, 0]}
            size={[1.6, 0.12, 2.4]}
            color={palette.metal}
            rounded
          />
          <Glass
            position={[0, 1.62, 0]}
            size={[1.52, 2.6, 2.3]}
            opacity={0.18}
          />
          {[-0.73, 0.73].map((s) => (
            <Block
              key={s}
              position={[s, 1.55, 1.15]}
              size={[0.065, 2.7, 0.065]}
              color={palette.metal}
            />
          ))}
          {[0, 1, 2, 3, 4, 5].map((j) => (
            <group key={j}>
              <Block
                position={[0, 0.55 + j * 0.38, 0]}
                size={[1.25, 0.22, 1.85]}
                color="#394e57"
                rounded
              />
              <Block
                position={[0, 0.55 + j * 0.38, 0.94]}
                size={[0.82, 0.015, 0.02]}
                color="#74dace"
                glow={0.5}
              />
            </group>
          ))}
          <Sign
            position={[0, 2.77, 1.17]}
            text={"NODE / 0" + (i + 1)}
            width={1.2}
            height={0.23}
          />
        </group>
      ))}
      <group ref={pulses}>
        {[10, 13, 15.7].map((x) => (
          <Block
            key={x}
            position={[x, 1.6, -6.3]}
            size={[0.06, 1.6, 0.01]}
            color="#aeede2"
            glow={0.6}
          />
        ))}
      </group>
      <Block
        position={[12.8, 0.018, -5.9]}
        size={[6.3, 0.015, 0.023]}
        color="#73aba8"
        glow={0.4}
      />
      <Sign
        position={[12, 3.32, -10.76]}
        color="#d5e0db"
        text="QUIETLY POWERING POSSIBILITY"
        width={3.5}
        height={0.32}
      />
    </group>
  );
}
function OwnerRoom() {
  return (
    <group>
      {" "}
      {/* Oak slats and panoramic display distinguish the human owner's suite. */}
      <Block
        position={[0, 1.9, -17.85]}
        size={[8.2, 3.8, 0.12]}
        color="#937e65"
        roughness={0.8}
      />
      {Array.from({ length: 19 }, (_, i) => (
        <Block
          key={i}
          position={[-3.9 + i * 0.435, 1.9, -17.74]}
          size={[0.07, 3.8, 0.08]}
          color="#b19a79"
          roughness={0.7}
        />
      ))}
      <Screen position={[0, 2.15, -17.57]} kind="overview" scale={1.72} wide />
      <Sign
        position={[0, 4, -17.57]}
        text="TEJA / OWNER COMMAND"
        sub="HUMAN VISION. AMPLIFIED."
        width={5.3}
        height={0.63}
      />
      <Console position={[0, 0, -15]} width={4.9} />
      <Lounge position={[4.5, 0, -15.8]} rotation={-Math.PI / 2} />
      <Plant position={[-5.8, 0, -16.8]} scale={1.15} />
    </group>
  );
}
function DeliveryRoom({ active }: { active: boolean }) {
  const operational = useContext(OperationalWorld);
  return (
    <group>
      {" "}
      <Block
        position={[12, 0.008, -14.5]}
        size={[9.8, 0.015, 6.7]}
        color="#435259"
        roughness={0.48}
      />
      <Block
        position={[12, 2, -17.84]}
        size={[9.8, 4, 0.15]}
        color="#34434b"
        roughness={0.6}
      />
      <Sign
        position={[12, 3.45, -17.7]}
        text="THE DELIVERY COLLECTION"
        sub={
          operational
            ? "VERIFIED DELIVERIES / OWNER ARCHIVE"
            : "DEMO PROJECTS / A GALLERY OF POSSIBILITY"
        }
        color="#e2e1d5"
        width={5.8}
        height={0.75}
      />
      {[10, 13, 15.7].map((x, i) => (
        <group key={x}>
          <Block
            position={[x, 0.53, -15]}
            size={[1.4, 1.06, 1.4]}
            color="#657576"
            metalness={0.65}
            roughness={0.3}
            rounded
          />
          <Block
            position={[x, 1.07, -15]}
            size={[1.44, 0.05, 1.44]}
            color={palette.ivory}
            rounded
          />
          <Glass
            position={[x, 1.8, -15]}
            size={[1.25, 1.45, 1.25]}
            opacity={0.13}
          />
          {!operational && (
            <Core
              position={[x, 1.8, -15]}
              scale={1.15}
              color={["#e6c48d", "#8ee1d4", "#9fc9f5"][i]}
              active={active}
            />
          )}
          <Ring
            position={[x, 1.11, -15]}
            radius={0.48}
            tube={0.009}
            color="#d8c6a5"
          />
          <Sign
            position={[x, 0.63, -14.29]}
            text={operational ? "DELIVERY VAULT" : "DEMO PROJECT 0" + (i + 1)}
            sub={operational ? "VERIFIED PROJECTS ONLY" : "VISUAL COLLECTION"}
            width={1.18}
            height={0.3}
            color="#e2e7df"
          />
          <Block
            position={[x, 4.32, -15]}
            size={[0.8, 0.03, 0.8]}
            color="#f6e6cf"
            glow={0.8}
          />
        </group>
      ))}
    </group>
  );
}
function ExpansionRoom() {
  const operational = useContext(OperationalWorld);
  return (
    <group>
      {" "}
      <Sign
        position={[-12, 3.6, -17.7]}
        text={operational ? "QUALITY / SECURITY / REVIEW" : "FUTURE OPERATIONS"}
        sub={operational ? "QA LAB / SECURITY OPERATIONS" : "DESIGN STUDIO / QA LAB / SECURITY OPERATIONS"}
        width={5.6}
        height={0.75}
      />
      <Sign
        position={[-12, 2.95, -17.7]}
        text={operational ? "CODE REVIEW" : "CODE REVIEW  ·  RELEASE BAY"}
        sub="CONNECTED CAMPUS / FLOORS 47–49"
        width={4.6}
        height={0.55}
      />
      {[-14, -10].map((x) => (
        <group key={x}>
          <Block
            position={[x, 0.28, -15]}
            size={[2, 0.55, 2]}
            color={palette.ivory}
            rounded
          />
          <Ring
            position={[x, 0.57, -15]}
            radius={0.64}
            tube={0.013}
            color="#a1b8b1"
          />
          <Glass
            position={[x, 1.65, -15]}
            size={[1.7, 2.1, 1.7]}
            opacity={0.045}
          />
        </group>
      ))}
      {[-14, -10].map((x) => (
        <group key={x}>
          <Block
            position={[x - 1.15, 1.7, -17.35]}
            size={[0.1, 3.4, 0.14]}
            color={palette.metal}
          />
          <Block
            position={[x + 1.15, 1.7, -17.35]}
            size={[0.1, 3.4, 0.14]}
            color={palette.metal}
          />
          <Block
            position={[x, 3.4, -17.35]}
            size={[2.4, 0.1, 0.14]}
            color={palette.ivory}
          />
          <Glass
            position={[x, 1.65, -17.34]}
            size={[2.15, 3.25, 0.05]}
            opacity={0.15}
          />
          <Block
            position={[x, 1.3, -17.28]}
            size={[0.03, 0.4, 0.045]}
            color={palette.metal}
          />
        </group>
      ))}
    </group>
  );
}
function Workshop({
  room,
  time,
  active,
}: {
  room: RoomDefinition;
  time: React.RefObject<number | null>;
  active: boolean;
}) {
  return (
    <group>
      {room.workstations.map((station) => (
        <Station
          key={station.id}
          room={room}
          station={station}
          agent={VISUAL_AGENTS.find((a) => a.stationId === station.id)}
          time={time}
          active={active}
        />
      ))}
      <Sign
        position={roomPosition(OFFICE_WORLD, room, room.signage.position)}
        rotation={[0, room.signage.rotation, 0]}
        text={room.name.toUpperCase()}
        sub={room.signage.subtitle}
        color="#d5e0db"
        width={4.6}
        height={0.62}
      />
    </group>
  );
}
/** Existing authored furnishings are reusable templates positioned by the room registry. */
const ROOM_TEMPLATES = {
  reception: { origin: [0, 0, 14] as Vec3, render: () => <Reception /> },
  command: {
    origin: [0, 0, 0] as Vec3,
    render: (active: boolean) => <Atrium active={active} />,
  },
  owner: { origin: [0, 0, -14.5] as Vec3, render: () => <OwnerRoom /> },
  infrastructure: {
    origin: [12, 0, -5.5] as Vec3,
    render: (active: boolean) => <Infrastructure active={active} />,
  },
  delivery: {
    origin: [12, 0, -14.5] as Vec3,
    render: (active: boolean) => <DeliveryRoom active={active} />,
  },
  expansion: {
    origin: [-12, 0, -14.5] as Vec3,
    render: () => <ExpansionRoom />,
  },
};
function RoomRenderer({
  room,
  time,
  active,
}: {
  room: RoomDefinition;
  time: React.RefObject<number | null>;
  active: boolean;
}) {
  if (room.template === "workshop")
    return <Workshop room={room} time={time} active={active} />;
  if (room.template === "module")
    return (
      <>
        <group position={roomPosition(OFFICE_WORLD, room, [0, 0, 0])}>
          <Block
            position={[0, -0.06, 0]}
            size={[room.dimensions[0], 0.12, room.dimensions[2]]}
            color={palette.floor}
          />
          {moduleWalls(room).map((wall, index) => (
            <Glass
              key={index}
              position={[wall.x, wall.height! / 2, wall.z]}
              size={[wall.w, wall.height!, wall.d]}
            />
          ))}
        </group>
        <Workshop room={room} time={time} active={active} />
      </>
    );
  const template = ROOM_TEMPLATES[room.template],
    origin = roomPosition(OFFICE_WORLD, room, [0, 0, 0]);
  return (
    <group position={origin.map((v, i) => v - template.origin[i]) as Vec3}>
      {template.render(active)}
    </group>
  );
}
export const Environment = memo(function Environment({
  time,
  active,
  cityHigh,
  operational = false,
}: {
  operational?: boolean;
  cityHigh: boolean;
  time: React.RefObject<number | null>;
  active: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#c2d3d7"]} />
      <fog attach="fog" args={["#cbdce2", 180, 1400]} />
      <Reflections />
      <hemisphereLight args={["#e3f1fa", "#716857", 0.95]} />
      <ambientLight intensity={0.22} />
      <directionalLight
        position={[13, 22, 7]}
        intensity={2}
        color="#fff0d6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-normalBias={0.045}
        shadow-bias={-0.0003}
        shadow-radius={3}
      />
      <directionalLight
        position={[-15, 9, -12]}
        intensity={0.45}
        color="#c4e6ef"
      />
      <Architecture />
      {OFFICE_WORLD.rooms
        .filter((r) => r.floorId === OFFICE_WORLD.activeFloor)
        .map((room) => (
          <RoomRenderer key={room.id} room={room} time={time} active={active} />
        ))}
      {!operational && <Transfer time={time} active={active} />}
      <CityEnvironment active={active} high={cityHigh} />
    </>
  );
});
