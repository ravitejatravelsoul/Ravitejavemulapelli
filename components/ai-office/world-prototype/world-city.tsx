"use client";
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  cityBuildings,
  cityRandom,
  CITY_BLOCK,
  STREET_Y,
  type CityBox,
} from "./world-city-model";

function Sky() {
  const uniforms = useMemo(
    () => ({
      zenith: { value: new THREE.Color("#71a6c9") },
      horizon: { value: new THREE.Color("#cbdce2") },
      sunDirection: { value: new THREE.Vector3(13, 22, 7).normalize() },
    }),
    [],
  );
  return (
    <mesh renderOrder={-100}>
      <sphereGeometry args={[1800, 32, 16]} />
      <shaderMaterial
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={`varying vec3 worldPoint; void main(){vec4 p=modelMatrix*vec4(position,1.0);worldPoint=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`}
        fragmentShader={`uniform vec3 zenith;uniform vec3 horizon;uniform vec3 sunDirection;varying vec3 worldPoint;void main(){vec3 d=normalize(worldPoint-cameraPosition);float h=smoothstep(-0.08,0.75,d.y);vec3 c=mix(horizon,zenith,h);float sun=pow(max(dot(d,sunDirection),0.0),850.0);c+=vec3(0.5,0.36,0.19)*sun;gl_FragColor=vec4(c,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`}
      />
    </mesh>
  );
}
function useFacade(style: number) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 384;
    const x = c.getContext("2d")!;
    const palettes = [
      ["#97a8ac", "#446674", "#7796a1"],
      ["#b9b0a2", "#52636c", "#87959b"],
      ["#708f98", "#305767", "#668a99"],
    ];
    const [frame, dark, light] = palettes[style];
    x.fillStyle = frame;
    x.fillRect(0, 0, 256, 384);
    for (let row = 0; row < 12; row++)
      for (let col = 0; col < 8; col++) {
        const gradient = x.createLinearGradient(
          col * 32,
          row * 32,
          col * 32 + 30,
          row * 32 + 30,
        );
        gradient.addColorStop(0, light);
        gradient.addColorStop(1, dark);
        x.fillStyle = gradient;
        const inset = style === 1 ? 7 : style === 2 ? 1 : 2;
        const windowHeight = style === 2 ? 30 : style === 1 ? 23 : 27;
        x.fillRect(
          col * 32 + inset,
          row * 32 + 2,
          32 - inset * 2,
          windowHeight,
        );
        if (cityRandom(col, row, style) > 0.93) {
          x.fillStyle = "#c9bb9b";
          x.globalAlpha = 0.55;
          x.fillRect(
            col * 32 + inset + 1,
            row * 32 + 4,
            30 - inset * 2,
            windowHeight - 4,
          );
          x.globalAlpha = 1;
        }
        x.fillStyle = "#c4d4d555";
        x.fillRect(col * 32 + 2, row * 32 + 2, 1, 27);
      }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 4;
    const material = new THREE.MeshStandardMaterial({
      map,
      color: "#ffffff",
      metalness: style === 1 ? 0.2 : 0.5,
      roughness: 0.4,
      envMapIntensity: 0.55,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nattribute vec3 citySize;",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\n#ifdef USE_MAP\nfloat facadeWidth=abs(normal.x)>0.5?citySize.z:citySize.x;vMapUv=vec2(uv.x*facadeWidth/24.0,uv.y*citySize.y/48.0);\n#endif",
      );
    };
    material.customProgramCacheKey = () => "city-facade-v1";
    return { material, map };
  }, [style]);
}
function Instances({
  boxes,
  facadeStyle,
}: {
  boxes: CityBox[];
  facadeStyle?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const facade = useFacade(facadeStyle ?? 0);
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.setAttribute(
      "citySize",
      new THREE.InstancedBufferAttribute(
        new Float32Array(boxes.flatMap((b) => b.size)),
        3,
      ),
    );
    return g;
  }, [boxes]);
  const roof = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: facadeStyle === undefined ? "#8a9293" : "#aeb3b2",
        roughness: 0.8,
        metalness: 0.15,
      }),
    [facadeStyle],
  );
  useEffect(() => {
    const mesh = ref.current!;
    const matrix = new THREE.Matrix4(),
      q = new THREE.Quaternion();
    boxes.forEach((b, i) => {
      matrix.compose(
        new THREE.Vector3(...b.position),
        q,
        new THREE.Vector3(...b.size),
      );
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, new THREE.Color().setScalar(b.shade));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes, geometry]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => roof.dispose(), [roof]);
  useEffect(
    () => () => {
      facade.material.dispose();
      facade.map.dispose();
    },
    [facade],
  );
  const materials = useMemo(
    () =>
      facadeStyle === undefined
        ? roof
        : [
            facade.material,
            facade.material,
            roof,
            roof,
            facade.material,
            facade.material,
          ],
    [facadeStyle, roof, facade],
  );
  return <instancedMesh ref={ref} args={[geometry, materials, boxes.length]} />;
}
function Traffic({ active, high }: { active: boolean; high: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null),
    time = useRef(0);
  const cars = useMemo(
    () =>
      Array.from({ length: high ? 130 : 64 }, (_, i) => ({
        lane: ((i % 14) - 7) * CITY_BLOCK + 33,
        offset: cityRandom(i, 7) * 1100,
        axis: i % 2,
        speed: 3 + cityRandom(i, 2) * 5,
        color: i % 7 === 0 ? "#e4b653" : i % 4 === 0 ? "#e0e3db" : "#586878",
      })),
    [high],
  );
  const temp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      s: new THREE.Vector3(),
    }),
    [],
  );
  useEffect(() => {
    cars.forEach((c, i) =>
      ref.current!.setColorAt(i, new THREE.Color(c.color)),
    );
    if (ref.current!.instanceColor)
      ref.current!.instanceColor.needsUpdate = true;
  }, [cars]);
  useFrame((_, dt) => {
    if (active) time.current += dt;
    if (!ref.current) return;
    cars.forEach((c, i) => {
      const along = ((c.offset + time.current * c.speed) % 1100) - 550;
      temp.p.set(
        c.axis ? c.lane + 2 : along,
        STREET_Y + 0.9,
        c.axis ? along : c.lane - 2,
      );
      temp.s.set(c.axis ? 1.6 : 3.5, 1.25, c.axis ? 3.5 : 1.6);
      temp.m.compose(temp.p, temp.q, temp.s);
      ref.current!.setMatrixAt(i, temp.m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, cars.length]}
      frustumCulled={false}
    >
      <boxGeometry />
      <meshStandardMaterial
        color="#ffffff"
        roughness={0.5}
        emissive="#7b6845"
        emissiveIntensity={0.1}
      />
    </instancedMesh>
  );
}
function Streets() {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d")!;
    x.fillStyle = "#868b86";
    x.fillRect(0, 0, 256, 256);
    x.fillStyle = "#454e53";
    x.fillRect(0, 102, 256, 52);
    x.fillRect(102, 0, 52, 256);
    x.fillStyle = "#abb0a7";
    x.fillRect(0, 96, 256, 5);
    x.fillRect(0, 155, 256, 5);
    x.fillRect(96, 0, 5, 256);
    x.fillRect(155, 0, 5, 256);
    x.strokeStyle = "#d0c9a8";
    x.lineWidth = 1;
    x.setLineDash([8, 9]);
    x.beginPath();
    x.moveTo(0, 128);
    x.lineTo(256, 128);
    x.moveTo(128, 0);
    x.lineTo(128, 256);
    x.stroke();
    for (let i = 0; i < 6; i++) {
      x.fillStyle = "#d6d6c8";
      x.fillRect(108 + i * 7, 91, 3, 9);
      x.fillRect(91, 108 + i * 7, 9, 3);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(30, 30);
    t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <>
      <mesh position={[0, STREET_Y - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CITY_BLOCK * 30, CITY_BLOCK * 30]} />
        <meshStandardMaterial map={texture} roughness={0.95} />
      </mesh>
      <mesh
        position={[1100, STREET_Y - 0.2, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[360, 2200]} />
        <meshStandardMaterial
          color="#739baa"
          metalness={0.35}
          roughness={0.38}
        />
      </mesh>
    </>
  );
}
export const CityEnvironment = memo(function CityEnvironment({
  active,
  high,
}: {
  active: boolean;
  high: boolean;
}) {
  const city = useMemo(() => cityBuildings(high), [high]);
  const groups = useMemo(
    () =>
      [0, 1, 2].map((style) => city.facades.filter((b) => b.style === style)),
    [city],
  );
  const tower = useMemo<CityBox[]>(
    () => [
      {
        position: [0, -100.35, 0],
        size: [33.6, 199.3, 35.6],
        style: 0,
        shade: 0.9,
      },
    ],
    [],
  );
  return (
    <group>
      <Sky />
      <Streets />
      {groups.map((boxes, style) => (
        <Instances key={style} boxes={boxes} facadeStyle={style} />
      ))}
      <Instances boxes={city.roofs} />
      <Instances boxes={city.crowns} />
      <Instances boxes={tower} facadeStyle={2} />
      <Traffic active={active} high={high} />
    </group>
  );
});
