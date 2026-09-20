"use client";
import dynamic from "next/dynamic";
const World = dynamic(() => import("./world-experience"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "#101d26",
        color: "#f0e7d6",
        display: "grid",
        placeContent: "center",
        fontFamily: "monospace",
      }}
    >
      <p>TEJA’S / AI OFFICE</p>
      <p role="status">Initializing 3D world…</p>
      <a href="/office">Exit to Office</a>
    </div>
  ),
});
export function WorldLoader() {
  return <World />;
}
