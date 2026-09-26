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
        background: "radial-gradient(ellipse at top, #667d80, #243840)",
        color: "#f0e7d6",
        display: "grid",
        placeContent: "center",
        fontFamily: "Segoe UI, Arial, sans-serif",
        gap: 20,
        textAlign: "center",
      }}
    >
      <p>TEJA’S / AI OFFICE</p>
      <p role="status">Preparing the headquarters…</p>
      <a href="/office/classic">Exit to Office</a>
    </div>
  ),
});
export function WorldLoader() {
  return <World />;
}
