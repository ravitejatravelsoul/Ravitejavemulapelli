"use client";
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { WALLS, BOTS, demoBot, type BotId, type Vec3 } from "./world-model";
export const palette = {
  ivory: "#d6d2bd",
  dark: "#263c47",
  metal: "#536873",
  copper: "#a87c50",
  cyan: "#79dad5",
  floor: "#34464e",
};
export function Block({
  position,
  size,
  color = palette.dark,
  glow = 0,
  rotation = [0, 0, 0],
}: {
  position: Vec3;
  size: Vec3;
  color?: string;
  glow?: number;
  rotation?: Vec3;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={0.55}
        metalness={0.25}
        emissive={color}
        emissiveIntensity={glow}
      />
    </mesh>
  );
}
function Pillar({ x, z }: { x: number; z: number }) {
  return (
    <group>
      <Block
        position={[x, 2.3, z]}
        size={[0.28, 4.6, 0.28]}
        color={palette.ivory}
      />
      <Block
        position={[x, 2.3, z + 0.15]}
        size={[0.055, 3.4, 0.02]}
        color="#ffd5a2"
        glow={2}
      />
    </group>
  );
}
/** Original architectural typography baked into local canvas textures, not HTML labels. */
export function Sign({
  text,
  sub = "",
  position,
  width = 4,
  height = 1,
  color = "#dcefe7",
  rotation = [0, 0, 0],
}: {
  text: string;
  sub?: string;
  position: Vec3;
  width?: number;
  height?: number;
  color?: string;
  rotation?: Vec3;
}) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#12232b";
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = color;
    ctx.fillRect(36, 32, 5, 188);
    ctx.font = "500 60px Arial";
    ctx.fillText(text, 70, 116, 910);
    ctx.font = "24px monospace";
    ctx.fillStyle = "#a4b7b7";
    ctx.fillText(sub, 73, 177, 900);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, sub, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
function Screen({
  position,
  kind = "code",
  color = "#83e6df",
  scale = 1,
  rotation = [0, 0, 0],
}: {
  position: Vec3;
  kind?: string;
  color?: string;
  scale?: number;
  rotation?: Vec3;
}) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 768;
    c.height = 448;
    const x = c.getContext("2d")!;
    x.fillStyle = "#0d202b";
    x.fillRect(0, 0, 768, 448);
    x.fillStyle = color;
    x.font = "24px monospace";
    x.fillText("T / " + kind.toUpperCase() + "     ·     DEMO", 30, 44);
    x.strokeStyle = "#31505b";
    for (let i = 0; i < 9; i++) {
      x.beginPath();
      x.moveTo(25, 70 + i * 38);
      x.lineTo(740, 70 + i * 38);
      x.stroke();
    }
    if (kind === "blueprint" || kind === "overview") {
      for (let i = 0; i < 8; i++) {
        const px = 75 + (i % 4) * 175,
          py = 135 + Math.floor(i / 4) * 180;
        x.strokeStyle = color;
        x.strokeRect(px, py, 100, 65);
        x.beginPath();
        x.moveTo(px + 100, py + 32);
        x.lineTo(px + 160, py + 32);
        x.stroke();
        x.font = "15px monospace";
        x.fillText(
          ["INPUT", "DESIGN", "BUILD", "REVIEW"][i % 4],
          px + 8,
          py + 37,
        );
      }
    } else {
      const words =
        kind === "planning"
          ? [
              "01  DEFINE THE OPPORTUNITY",
              "02  UNDERSTAND THE OWNER",
              "03  ORGANIZE THE BRIEF",
              "04  PLAN THE NEXT STEP",
              "VISUAL STUDY / NOT LIVE",
            ]
          : [
              "const studio = {",
              '  purpose: "make something meaningful",',
              '  mode: "visual prototype",',
              '  workers: ["PIP", "ARC", "DEX"]',
              "};",
              "// original geometry · no execution",
            ];
      words.forEach((s, i) => {
        x.fillStyle = i % 2 ? color : "#d0ddd4";
        x.font = "19px monospace";
        x.fillText(s, 35, 112 + i * 42);
      });
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [kind, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Block
        position={[0, 0, -0.055]}
        size={[2.16, 1.31, 0.1]}
        color="#1b2a33"
      />
      <mesh>
        <planeGeometry args={[2.04, 1.19]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <Block position={[0, -0.77, -0.07]} size={[0.07, 0.3, 0.1]} />
    </group>
  );
}
export function Core({
  position = [0, 0, 0],
  color = palette.cyan,
  scale = 1,
}: {
  position?: Vec3;
  color?: string;
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <RoundedBox args={[0.32, 0.32, 0.32]} radius={0.035} smoothness={2}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.5}
          metalness={0.3}
          roughness={0.25}
        />
      </RoundedBox>
      <mesh>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.7} />
      </mesh>
      <mesh rotation={[0.5, 0.7, 0.3]}>
        <octahedronGeometry args={[0.35]} />
        <meshBasicMaterial color="#fff8d8" wireframe />
      </mesh>
    </group>
  );
}
function Atrium({ active }: { active: boolean }) {
  const rings = useRef<THREE.Group>(null),
    core = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (active) {
      if (rings.current) rings.current.rotation.y += dt * 0.13;
      if (core.current) {
        core.current.rotation.y += dt * 0.23;
        core.current.rotation.z = Math.sin(core.current.rotation.y) * 0.12;
      }
    }
  });
  return (
    <group>
      <mesh position={[0, 0.18, 0]} receiveShadow>
        <cylinderGeometry args={[2.75, 2.95, 0.36, 64]} />
        <meshStandardMaterial
          color="#253f48"
          metalness={0.6}
          roughness={0.35}
        />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[2.1, 2.35, 0.95, 48]} />
        <meshStandardMaterial
          color={palette.ivory}
          metalness={0.25}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, 1.25, 0]}>
        <cylinderGeometry args={[2.18, 2.18, 0.08, 64]} />
        <meshStandardMaterial
          color="#152d38"
          metalness={0.5}
          roughness={0.25}
        />
      </mesh>
      {[2.25, 2.8, 5.7].map((r, i) => (
        <mesh
          key={r}
          position={[0, i === 2 ? 4.5 : 0.04, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[r, 0.025, 6, 80]} />
          <meshBasicMaterial color={i === 2 ? "#ffe2b9" : palette.cyan} />
        </mesh>
      ))}
      <group ref={rings} position={[0, 2.6, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[Math.PI / 2 + i * 0.32, 0.4 * i, 0]}>
            <torusGeometry args={[1 + i * 0.25, 0.018, 6, 64]} />
            <meshBasicMaterial
              color={i === 1 ? "#e4bb83" : palette.cyan}
              transparent
              opacity={0.7}
            />
          </mesh>
        ))}
      </group>
      <group ref={core} position={[0, 2.6, 0]}>
        <Core scale={1.6} />
      </group>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <group
            key={i}
            position={[Math.sin(a) * 1.65, 1.8, Math.cos(a) * 1.65]}
          >
            <Core scale={0.22} color={i % 2 ? palette.cyan : "#eac390"} />
            <mesh rotation={[0, 0, a]}>
              <cylinderGeometry args={[0.012, 0.012, 0.65, 5]} />
              <meshBasicMaterial color={palette.cyan} />
            </mesh>
          </group>
        );
      })}
      <Sign
        position={[0, 0.82, 2.36]}
        width={2.5}
        height={0.55}
        text="ORCHESTRATOR"
        sub="COMMAND CORE / VISUAL STUDY"
      />
      <Sign
        position={[0, 4.08, -6.9]}
        width={5}
        text="THE NEXUS"
        sub="TEJA’S AUTONOMOUS ENGINEERING HEADQUARTERS"
        color="#edcfa8"
      />
    </group>
  );
}
function Station({ id }: { id: BotId }) {
  const bot = BOTS[id],
    x = bot.home[0],
    z = id === "architect" ? -8 : 7;
  // Bots dock on the clear side of desks. Screens face the room, with engineering reversed.
  return (
    <group>
      <Block
        position={[x, 0.96, z]}
        size={[4.8, 0.18, 1.3]}
        color={palette.ivory}
      />
      <Block
        position={[x, 0.82, z + 0.53]}
        size={[4.65, 0.06, 0.08]}
        color={bot.color}
        glow={1.4}
      />
      {[-1.9, 1.9].map((dx) => (
        <Block
          key={dx}
          position={[x + dx, 0.45, z]}
          size={[0.22, 0.9, 1.1]}
          color={palette.metal}
        />
      ))}
      <group
        position={[x, 1.76, z]}
        rotation={[0, id === "architect" ? 0 : Math.PI, 0]}
      >
        <Screen
          position={[0, 0, 0]}
          kind={
            id === "product"
              ? "planning"
              : id === "architect"
                ? "blueprint"
                : "code"
          }
          color={bot.color}
        />
        {id === "developer" && (
          <>
            <Screen
              position={[-1.55, 0, 0.35]}
              rotation={[0, 0.45, 0]}
              scale={0.6}
              color={bot.color}
            />
            <Screen
              position={[1.55, 0, 0.35]}
              rotation={[0, -0.45, 0]}
              scale={0.6}
              color={bot.color}
            />
          </>
        )}
        {id === "product" && (
          <Screen
            position={[1.75, 0.1, 0.25]}
            rotation={[0, -0.2, 0]}
            scale={0.55}
            kind="planning"
            color={bot.color}
          />
        )}
        {id === "architect" && (
          <group position={[1.5, 0.05, 0.15]}>
            <mesh>
              <icosahedronGeometry args={[0.5, 0]} />
              <meshBasicMaterial color={bot.color} wireframe />
            </mesh>
          </group>
        )}
      </group>
      <mesh position={[x, 0.02, bot.home[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.68, 0.73, 48]} />
        <meshBasicMaterial color={bot.color} />
      </mesh>
      <Block
        position={[x, 0.08, bot.home[2]]}
        size={[1.15, 0.13, 1.15]}
        color="#2d424b"
      />
    </group>
  );
}
function ServerRack({ x }: { x: number }) {
  return (
    <group position={[x, 0, -7.5]}>
      <Block position={[0, 1.45, 0]} size={[1.6, 2.9, 2.4]} color="#172c36" />
      {Array.from({ length: 9 }, (_, i) => (
        <group key={i}>
          <Block
            position={[0, 0.3 + i * 0.28, 1.21]}
            size={[1.35, 0.19, 0.025]}
            color="#3c5360"
          />
          {[0, 1, 2].map((j) => (
            <Block
              key={j}
              position={[-0.46 + j * 0.13, 0.3 + i * 0.28, 1.235]}
              size={[0.04, 0.035, 0.012]}
              color={j === 2 ? "#e6bc80" : "#6ed7bc"}
              glow={1.3}
            />
          ))}
        </group>
      ))}
      <Sign
        position={[0, 2.7, 1.225]}
        text="N / 0"
        sub="DEMO INFRASTRUCTURE"
        width={1.35}
        height={0.25}
      />
    </group>
  );
}
function Bot({
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
    yaw = useRef(id === "architect" ? Math.PI : 0);
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
    else if (sample.state === "WORKING")
      yaw.current = id === "architect" ? Math.PI : 0;
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
        sample.state === "WORKING" ? Math.sin(elapsed.current * 5) * 0.13 : 0;
    if (ring.current && active) ring.current.rotation.z += dt * 0.35;
    if (carry.current) carry.current.visible = sample.carry;
  });
  return (
    <group ref={root} position={b.home}>
      <group ref={body}>
        <RoundedBox
          args={
            id === "architect"
              ? [0.83, 0.6, 0.62]
              : id === "developer"
                ? [0.66, 0.65, 0.63]
                : [0.73, 0.65, 0.65]
          }
          radius={0.12}
          smoothness={3}
        >
          <meshStandardMaterial
            color={id === "developer" ? "#667184" : "#e6dec6"}
            metalness={0.45}
            roughness={0.32}
          />
        </RoundedBox>
        <RoundedBox
          position={[0, 0.04, 0.32]}
          args={[0.58, 0.28, 0.045]}
          radius={0.045}
          smoothness={2}
        >
          <meshStandardMaterial
            color="#0b202b"
            metalness={0.4}
            roughness={0.25}
          />
        </RoundedBox>
        {[-0.14, 0.14].map((x) => (
          <Block
            key={x}
            position={[x, 0.055, 0.35]}
            size={[id === "architect" ? 0.14 : 0.07, 0.06, 0.02]}
            color={b.color}
            glow={2}
          />
        ))}
        <Block
          position={[0, -0.17, 0.337]}
          size={[0.15, 0.018, 0.014]}
          color={b.color}
          glow={1}
        />
        <mesh position={[0, -0.37, 0]}>
          <cylinderGeometry args={[0.2, 0.12, 0.15, 16]} />
          <meshStandardMaterial color="#293e49" />
        </mesh>
        <mesh position={[0, -0.46, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.13, 0.022, 6, 20]} />
          <meshBasicMaterial color={b.color} />
        </mesh>
        <group ref={arms}>
          {[-1, 1].map((s) => (
            <group
              key={s}
              position={[s * 0.43, -0.08, 0]}
              rotation={[0, 0, s * 0.25]}
            >
              <Block
                position={[0, -0.07, 0]}
                size={[0.12, 0.32, 0.15]}
                color={palette.metal}
              />
              <mesh position={[0, -0.25, 0.1]}>
                <sphereGeometry args={[0.09, 10, 8]} />
                <meshStandardMaterial color={b.color} metalness={0.6} />
              </mesh>
              {id === "developer" && (
                <Block
                  position={[0, -0.22, 0.26]}
                  size={[0.06, 0.07, 0.34]}
                  color={palette.ivory}
                />
              )}
            </group>
          ))}
        </group>
        {id === "product" && (
          <>
            <Block
              position={[0.22, 0.43, 0]}
              size={[0.035, 0.28, 0.035]}
              color={palette.copper}
            />
            <mesh position={[0.22, 0.61, 0]}>
              <sphereGeometry args={[0.06, 12, 8]} />
              <meshBasicMaterial color={b.color} />
            </mesh>
            <Block
              position={[-0.55, 0.1, 0.14]}
              size={[0.18, 0.35, 0.045]}
              color={b.color}
              glow={0.4}
            />
            <Block
              position={[-0.58, 0.15, 0.07]}
              size={[0.18, 0.35, 0.025]}
              color="#61717b"
            />
          </>
        )}
        {id === "architect" && (
          <group ref={ring} rotation={[0.35, 0, 0]}>
            <mesh>
              <torusGeometry args={[0.59, 0.021, 6, 48]} />
              <meshStandardMaterial
                color={b.color}
                emissive={b.color}
                emissiveIntensity={0.4}
              />
            </mesh>
            <mesh position={[0.59, 0, 0]}>
              <octahedronGeometry args={[0.1]} />
              <meshBasicMaterial color={b.color} />
            </mesh>
          </group>
        )}
        {id === "developer" && (
          <>
            <Block
              position={[0, 0.37, -0.02]}
              size={[0.36, 0.09, 0.38]}
              color={palette.copper}
            />
            {[-1, 1].map((s) => (
              <Block
                key={s}
                position={[s * 0.38, 0.18, 0.22]}
                size={[0.1, 0.15, 0.13]}
                color={b.color}
                glow={0.3}
              />
            ))}
          </>
        )}
        <group ref={carry} position={[0, -0.05, 0.78]}>
          <Core color={b.color} scale={0.65} />
        </group>
      </group>
    </group>
  );
}
function Transfer({ time }: { time: React.RefObject<number | null> }) {
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!root.current) return;
    const t = time.current ?? -1;
    root.current.visible = (t >= 15 && t < 18) || (t >= 38 && t < 41);
    if (!root.current.visible) return;
    const first = t < 18,
      f = (t - (first ? 15 : 38)) / 3;
    const a = demoBot(first ? "product" : "architect", t).position,
      b = demoBot(first ? "architect" : "developer", t).position;
    root.current.position.set(
      a[0] + (b[0] - a[0]) * f,
      1.5 + Math.sin(f * Math.PI) * 0.32,
      a[2] + (b[2] - a[2]) * f + 0.4,
    );
    root.current.rotation.y = f * Math.PI * 2;
  });
  return (
    <group ref={root} visible={false}>
      <Core color="#ffe1a2" scale={0.8} />
    </group>
  );
}
function Ceiling() {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-17, -18);
    s.lineTo(17, -18);
    s.lineTo(17, 18);
    s.lineTo(-17, 18);
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 6.1, 0, Math.PI * 2, true);
    s.holes.push(hole);
    return s;
  }, []);
  return (
    <group>
      <mesh position={[0, 4.65, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color="#718080"
          emissive="#536563"
          emissiveIntensity={0.3}
          side={THREE.DoubleSide}
          roughness={0.85}
        />
      </mesh>
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <Block
              position={[0, 4.55, 5.7]}
              size={[0.08, 0.2, 1.1]}
              color={palette.copper}
            />
          </group>
        );
      })}
      {[-12, 12].flatMap((x) =>
        [-14, -6, 6, 14].map((z) => (
          <group key={x + ":" + z}>
            <Block
              position={[x, 4.4, z]}
              size={[3.8, 0.16, 0.55]}
              color={palette.ivory}
            />
            <Block
              position={[x, 4.3, z]}
              size={[3.6, 0.025, 0.4]}
              color="#ffdeb0"
              glow={1.4}
            />
          </group>
        )),
      )}
      {[-16.8, 16.8].flatMap((x) =>
        [-14, -8, -2, 4, 10, 16].map((z) => (
          <Block
            key={x + ":" + z}
            position={[x, 2, z]}
            size={[0.1, 3.8, 2.2]}
            color="#637477"
          />
        )),
      )}
    </group>
  );
}
export const Environment = memo(function Environment({
  time,
  active,
}: {
  time: React.RefObject<number | null>;
  active: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#596c7b"]} />
      <fog attach="fog" args={["#596c7b", 40, 100]} />
      <hemisphereLight args={["#dceeff", "#333633", 1.4]} />
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[8, 16, 10]}
        intensity={2}
        color="#ffe3b7"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-23}
        shadow-camera-right={23}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-bias={-0.001}
      />
      <pointLight
        position={[0, 4, 0]}
        intensity={24}
        distance={15}
        color="#83dbdc"
      />
      <Block
        position={[0, -0.18, 0]}
        size={[34, 0.35, 36]}
        color={palette.floor}
      />
      <Block
        position={[0, 0.005, 0]}
        size={[13.6, 0.015, 25]}
        color="#6b7b7b"
      />
      {Array.from({ length: 9 }, (_, i) => (
        <Block
          key={i}
          position={[-16 + i * 4, 0.017, 0]}
          size={[0.015, 0.01, 36]}
          color="#506267"
        />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <Block
          key={i}
          position={[0, 0.018, -16 + i * 4]}
          size={[34, 0.01, 0.015]}
          color="#506267"
        />
      ))}
      {[-6.4, 6.4].map((x) => (
        <Block
          key={x}
          position={[x, 0.025, 1]}
          size={[0.04, 0.015, 23]}
          color="#ffe0ac"
          glow={1.5}
        />
      ))}
      {WALLS.map((w, i) => (
        <group key={i}>
          {w.glass ? (
            <>
              <Block
                position={[w.x, 0.3, w.z]}
                size={[w.w, 0.6, w.d]}
                color={palette.ivory}
              />
              <mesh position={[w.x, 2, w.z]}>
                <boxGeometry args={[w.w, 2.8, w.d]} />
                <meshStandardMaterial
                  color="#b5e2e4"
                  transparent
                  opacity={0.12}
                  metalness={0.25}
                  roughness={0.12}
                  depthWrite={false}
                />
              </mesh>
              <Block
                position={[w.x, 3.48, w.z]}
                size={[w.w, 0.14, w.d]}
                color={palette.metal}
              />
            </>
          ) : (
            <>
              <Block
                position={[w.x, 0.35, w.z]}
                size={[w.w, 0.7, w.d]}
                color={palette.ivory}
              />
              <mesh position={[w.x, 2.55, w.z]}>
                <boxGeometry args={[w.w, 3.7, w.d]} />
                <meshStandardMaterial
                  color="#a8c7cc"
                  transparent
                  opacity={0.2}
                  depthWrite={false}
                  roughness={0.25}
                />
              </mesh>
              <Block
                position={[w.x, 4.5, w.z]}
                size={[w.w, 0.22, w.d]}
                color={palette.ivory}
              />
            </>
          )}
        </group>
      ))}
      {[-17, -7, 7, 17].flatMap((x) =>
        [-17, -11, 0, 11, 17].map((z) => (
          <Pillar key={x + ":" + z} x={x} z={z} />
        )),
      )}
      {[-10, 10].map((z) => (
        <group key={z}>
          <Block
            position={[0, 4.55, z]}
            size={[34, 0.2, 0.3]}
            color={palette.ivory}
          />
          <Block
            position={[0, 4.43, z]}
            size={[30, 0.035, 0.08]}
            color="#ffdfa6"
            glow={2}
          />
        </group>
      ))}
      <Ceiling />
      <Atrium active={active} />
      <mesh
        position={[0, 0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <ringGeometry args={[3, 5.7, 80]} />
        <meshStandardMaterial
          color="#526a71"
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Block
            position={[side * 4.8, 0.03, 9.4]}
            size={[1.2, 0.025, 3]}
            color="#8c8776"
          />
          <Block
            position={[side * 15.6, 0.35, 10]}
            size={[1.1, 0.7, 1.1]}
            color={palette.ivory}
          />
          <mesh position={[side * 15.6, 1.12, 10]}>
            <cylinderGeometry args={[0.035, 0.07, 1.2, 6]} />
            <meshStandardMaterial color="#685b40" />
          </mesh>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh
              key={i}
              position={[
                side * 15.6 + Math.sin(i * 2.4) * 0.35,
                1.4 + (i % 3) * 0.25,
                10 + Math.cos(i * 2.4) * 0.3,
              ]}
              scale={[0.4, 0.18, 0.3]}
              rotation={[i * 0.2, i, 0]}
            >
              <icosahedronGeometry args={[1, 1]} />
              <meshStandardMaterial
                color={i % 2 ? "#587865" : "#79917b"}
                roughness={0.85}
              />
            </mesh>
          ))}
        </group>
      ))}
      <Sign
        position={[0, 3.8, 10.7]}
        text="TEJA’S / AI OFFICE"
        sub="AUTONOMOUS ENGINEERING HEADQUARTERS"
        width={4.8}
        height={1}
        color="#f0d3a4"
      />
      <Block
        position={[-12, 0.6, 15]}
        size={[5, 1.2, 1.5]}
        color={palette.ivory}
      />
      <Sign
        position={[-12, 1, 15.76]}
        text="WELCOME / TEJA"
        sub="WORLD PROTOTYPE · VISUAL EXPERIENCE ONLY"
        width={4}
        height={0.6}
      />
      <Sign
        position={[-16.8, 2.7, 13]}
        rotation={[0, Math.PI / 2, 0]}
        text="THE DIRECTORY"
        sub="01 PRODUCT   /   02 ARCHITECTURE   /   03 ENGINEERING"
        width={5}
        height={1.2}
      />
      <Sign
        position={[-12, 3.1, 9.7]}
        rotation={[0, Math.PI, 0]}
        text="01 / PRODUCT & RESEARCH"
        sub="PIP · THE PLANNING STUDIO"
        width={5}
      />
      <Sign
        position={[-12, 3.1, -10.8]}
        text="02 / ARCHITECTURE LAB"
        sub="ARC · SYSTEMS, CONNECTIONS, POSSIBILITIES"
        width={5}
      />
      <Sign
        position={[12, 3.1, 9.7]}
        rotation={[0, Math.PI, 0]}
        text="03 / ENGINEERING"
        sub="DEX · THE BUILD BAY"
        width={5}
      />
      <Sign
        position={[12, 3.1, -10.8]}
        text="INFRASTRUCTURE"
        sub="OFFICE ENGINEER / FUTURE HOME"
        width={5}
      />
      <Sign
        position={[0, 3.95, -17.8]}
        text="TEJA / OWNER"
        sub="THE HUMAN AT THE CENTRE OF THE COMPANY"
        width={5}
      />
      <Screen position={[0, 2.1, -17.6]} kind="overview" scale={2} />
      <Block
        position={[0, 1, -15]}
        size={[5, 0.2, 1.5]}
        color={palette.ivory}
      />
      <Block position={[0, 0.45, -15]} size={[3, 0.9, 0.7]} />
      <Sign
        position={[12, 3.3, -17.8]}
        text="DELIVERY VAULT"
        sub="IDEAS BECOME THINGS / DEMO COLLECTION"
        width={5}
      />
      {[10, 13, 15.7].map((x, i) => (
        <group key={x}>
          <ServerRack x={x} />
          <Block
            position={[x, 0.5, -15]}
            size={[1.5, 1, 1.5]}
            color={palette.ivory}
          />
          <Core
            position={[x, 1.7, -15]}
            color={["#ffc284", "#81dad5", "#b4acfa"][i]}
            scale={1.6}
          />
          <Sign
            position={[x, 0.65, -14.24]}
            text={"DEMO / 0" + (i + 1)}
            sub="NOT A REAL PROJECT"
            width={1.2}
            height={0.35}
          />
        </group>
      ))}
      <Sign
        position={[-12, 3, -17.8]}
        text="NEXT / HORIZON"
        sub="DESIGN · QA · SECURITY · REVIEW · LAUNCH"
        width={5}
      />
      {[-14, -10].map((x) => (
        <group key={x}>
          <Block
            position={[x, 0.28, -15]}
            size={[2, 0.55, 2]}
            color={palette.ivory}
          />
          <mesh position={[x, 0.58, -15]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.6, 0.63, 32]} />
            <meshBasicMaterial color={palette.cyan} />
          </mesh>
        </group>
      ))}
      {(Object.keys(BOTS) as BotId[]).map((id) => (
        <group key={id}>
          <Station id={id} />
          <Bot id={id} time={time} active={active} />
        </group>
      ))}
      <Transfer time={time} />
      {/* Procedural skyline: original silhouettes, no external assets or textures. */}
      {Array.from({ length: 30 }, (_, i) => {
        const a = (i / 30) * Math.PI * 2,
          r = 33 + (i % 3) * 7,
          h = 5 + ((i * 7) % 16);
        return (
          <Block
            key={i}
            position={[Math.sin(a) * r, h / 2 - 1, Math.cos(a) * r]}
            size={[3 + (i % 3), h, 3]}
            color={i % 2 ? "#6e868d" : "#81959a"}
          />
        );
      })}
    </>
  );
});
