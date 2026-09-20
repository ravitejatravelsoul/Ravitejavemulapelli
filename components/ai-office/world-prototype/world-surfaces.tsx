"use client";
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Vec3 } from "./world-model";

export const palette = {
  ivory: "#eeeae1",
  dark: "#283339",
  metal: "#9babad",
  copper: "#ac8960",
  cyan: "#6ed9d4",
  floor: "#c5c5bd",
};
export function Reflections() {
  const { gl, scene } = useThree();
  useEffect(() => {
    // Locally generated studio radiance: no downloaded HDR or network dependency.
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    const previous = scene.environment;
    /* eslint-disable react-hooks/immutability -- Three.js scene ownership requires imperative environment setup and cleanup. */
    scene.environment = target.texture;
    scene.environmentIntensity = 0.42;
    return () => {
      scene.environment = previous;
      target.dispose();
      room.dispose();
      generator.dispose();
      /* eslint-enable react-hooks/immutability */
    };
  }, [gl, scene]);
  return null;
}
export function Block({
  position,
  size,
  color = palette.dark,
  glow = 0,
  rotation = [0, 0, 0],
  roughness,
  metalness,
  rounded = false,
}: {
  position: Vec3;
  size: Vec3;
  color?: string;
  glow?: number;
  rotation?: Vec3;
  roughness?: number;
  metalness?: number;
  rounded?: boolean;
}) {
  const material = (
    <meshStandardMaterial
      color={color}
      roughness={roughness ?? (color === palette.ivory ? 0.65 : 0.32)}
      metalness={metalness ?? (color === palette.metal ? 0.8 : 0.12)}
      emissive={color}
      emissiveIntensity={glow}
    />
  );
  return rounded ? (
    <RoundedBox
      position={position}
      rotation={rotation}
      args={size}
      radius={Math.min(...size, 0.24) * 0.35}
      smoothness={3}
      castShadow
      receiveShadow
    >
      {material}
    </RoundedBox>
  ) : (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      {material}
    </mesh>
  );
}
export function Glass({
  position,
  size,
  opacity = 0.12,
}: {
  position: Vec3;
  size: Vec3;
  opacity?: number;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshPhysicalMaterial
        color="#bce0e1"
        transparent
        opacity={opacity}
        roughness={0.08}
        metalness={0.25}
        clearcoat={1}
        envMapIntensity={1.4}
        depthWrite={false}
      />
    </mesh>
  );
}
export function Ring({
  position = [0, 0, 0],
  radius,
  tube = 0.018,
  color = palette.cyan,
  rotation = [Math.PI / 2, 0, 0],
}: {
  position?: Vec3;
  radius: number;
  tube?: number;
  color?: string;
  rotation?: Vec3;
}) {
  return (
    <mesh position={position} rotation={rotation}>
      <torusGeometry args={[radius, tube, 8, 96]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.7}
        metalness={0.6}
        roughness={0.25}
      />
    </mesh>
  );
}
export function Sign({
  text,
  sub = "",
  position,
  width = 4,
  height = 0.7,
  color = "#35464c",
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
    c.width = 1536;
    c.height = 256;
    const x = c.getContext("2d")!;
    x.fillStyle = color;
    x.font = "500 66px Arial";
    x.textAlign = "center";
    x.fillText(text, 768, 109, 1480);
    x.globalAlpha = 0.75;
    x.font = "26px Arial";
    x.letterSpacing = "5px";
    x.fillText(sub, 768, 180, 1440);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, sub, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
export function Screen({
  position,
  kind = "code",
  color = palette.cyan,
  scale = 1,
  rotation = [0, 0, 0],
  wide = false,
}: {
  position: Vec3;
  kind?: string;
  color?: string;
  scale?: number;
  rotation?: Vec3;
  wide?: boolean;
}) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 576;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 1024, 576);
    g.addColorStop(0, "#183039");
    g.addColorStop(1, "#07151e");
    x.fillStyle = g;
    x.fillRect(0, 0, 1024, 576);
    x.fillStyle = color;
    x.font = "20px Arial";
    x.fillText("T / INTELLIGENCE STUDIO", 40, 45);
    x.fillStyle = "#81999f";
    x.textAlign = "right";
    x.fillText("SIMULATION / 02", 982, 45);
    x.textAlign = "left";
    x.strokeStyle = "#55767b55";
    x.beginPath();
    x.moveTo(40, 68);
    x.lineTo(984, 68);
    x.stroke();
    x.font = "38px Arial";
    x.fillStyle = "#e6efeb";
    x.fillText(
      (
        {
          planning: "From ambition to intention.",
          blueprint: "An architecture of possibility.",
          overview: "One company. Shared intelligence.",
          code: "Build something meaningful.",
        } as Record<string, string>
      )[kind] ?? kind,
      40,
      124,
    );
    if (kind === "blueprint" || kind === "overview") {
      const nodes = [
        [120, 285],
        [375, 215],
        [375, 390],
        [660, 240],
        [660, 410],
        [900, 310],
      ];
      [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 4],
        [3, 5],
        [4, 5],
        [1, 4],
      ].forEach(([a, b]) => {
        x.strokeStyle = "#639293";
        x.beginPath();
        x.moveTo(...(nodes[a] as [number, number]));
        x.lineTo(...(nodes[b] as [number, number]));
        x.stroke();
      });
      nodes.forEach(([px, py], i) => {
        x.fillStyle = "#203f49";
        x.beginPath();
        x.roundRect(px - 63, py - 32, 126, 64, 12);
        x.fill();
        x.strokeStyle = color;
        x.stroke();
        x.fillStyle = "#e5efec";
        x.font = "16px Arial";
        x.fillText(
          ["INTENT", "PLAN", "DESIGN", "BUILD", "REVIEW", "DELIVER"][i],
          px - 40,
          py + 6,
        );
      });
    } else if (kind === "planning") {
      ["DISCOVER", "DEFINE", "DELIVER"].forEach((s, i) => {
        const px = 40 + i * 322;
        x.fillStyle = "#24414a";
        x.beginPath();
        x.roundRect(px, 180, 300, 275, 16);
        x.fill();
        x.fillStyle = color;
        x.font = "17px Arial";
        x.fillText("0" + (i + 1) + " / " + s, px + 22, 219);
        [0, 1, 2].forEach((j) => {
          x.fillStyle = j === 0 ? "#748c8d" : "#425e66";
          x.beginPath();
          x.roundRect(px + 22, 250 + j * 54, 190 - j * 32, 9, 4);
          x.fill();
        });
      });
    } else {
      [
        "const tomorrow = await studio.create({",
        "  intent: 'a brighter future',",
        "  team: [product, architecture, engineering],",
        "  execution: 'visual demonstration'",
        "});",
        "// Ready for human imagination.",
      ].forEach((s, i) => {
        x.fillStyle = i % 2 ? "#a8c8cd" : color;
        x.font = "22px monospace";
        x.fillText(String(i + 1).padStart(2, "0"), 40, 202 + i * 44);
        x.fillText(s, 98, 202 + i * 44);
      });
    }
    x.fillStyle = color;
    x.fillRect(40, 518, 160, 3);
    x.fillStyle = "#92a9ad";
    x.font = "15px Arial";
    x.fillText("LOCAL VISUAL STUDY  /  NO LIVE SYSTEMS", 40, 550);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [kind, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group
      position={position}
      rotation={rotation}
      scale={[scale * (wide ? 1.5 : 1), scale, scale]}
    >
      <Block
        position={[0, 0, -0.035]}
        size={[2.65, 1.51, 0.045]}
        color={palette.metal}
        rounded
      />
      <mesh>
        <planeGeometry args={[2.6, 1.46]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
export function Plant({
  position,
  scale = 1,
}: {
  position: Vec3;
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.28, 0.6, 24]} />
        <meshStandardMaterial color="#d8d4c7" roughness={0.82} />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.022, 0.04, 1.3, 8]} />
        <meshStandardMaterial color="#675d42" />
      </mesh>
      {Array.from({ length: 11 }, (_, i) => (
        <mesh
          key={i}
          position={[
            Math.sin(i * 2.4) * 0.26,
            0.9 + i * 0.09,
            Math.cos(i * 2.4) * 0.26,
          ]}
          rotation={[0, i * 2.4, 0.35]}
          scale={[0.35, 0.1, 0.19]}
          castShadow
        >
          <sphereGeometry args={[1, 10, 6]} />
          <meshStandardMaterial
            color={i % 2 ? "#466a43" : "#789064"}
            roughness={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}
function CapsuleSlab({
  width,
  depth,
  y,
  thickness,
  color,
}: {
  width: number;
  depth: number;
  y: number;
  thickness: number;
  color: string;
}) {
  const shape = useMemo(() => {
    const s = new THREE.Shape(),
      r = depth / 2,
      x = width / 2 - r;
    s.moveTo(-x, -r);
    s.lineTo(x, -r);
    s.absarc(x, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(-x, r);
    s.absarc(-x, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    return s;
  }, [width, depth]);
  return (
    <mesh
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      castShadow
      receiveShadow
    >
      <extrudeGeometry
        args={[
          shape,
          {
            depth: thickness,
            bevelEnabled: true,
            bevelSegments: 2,
            steps: 1,
            bevelSize: 0.016,
            bevelThickness: 0.016,
            curveSegments: 24,
          },
        ]}
      />
      <meshStandardMaterial color={color} metalness={0.4} roughness={0.3} />
    </mesh>
  );
}
export function Console({
  position,
  rotation = [0, 0, 0],
  width = 4.6,
}: {
  position: Vec3;
  rotation?: Vec3;
  width?: number;
}) {
  // Sculpted horizontal capsule: integrated touch surface, no conventional monitor stand.
  return (
    <group position={position} rotation={rotation}>
      <Block
        position={[0, 0.46, 0.14]}
        size={[width * 0.54, 0.86, 0.7]}
        color={palette.dark}
        rounded
        metalness={0.5}
      />
      <CapsuleSlab
        width={width}
        depth={1.18}
        y={0.84}
        thickness={0.18}
        color={palette.ivory}
      />
      <CapsuleSlab
        width={width - 0.18}
        depth={0.99}
        y={1.025}
        thickness={0.012}
        color="#34494e"
      />
      <Block
        position={[0, 0.86, 0.615]}
        size={[width - 0.45, 0.018, 0.018]}
        color="#b8e6dd"
        glow={1.1}
      />
      {[-1, 0, 1].map((i) => (
        <Block
          key={i}
          position={[i * width * 0.23, 1.06, 0.15]}
          size={[width * 0.17, 0.008, 0.24]}
          color="#668a8b"
          glow={0.15}
          rounded
        />
      ))}
    </group>
  );
}
