import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getSiteConfig } from "@/lib/data";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const logoBase64 = fs
  .readFileSync(path.join(process.cwd(), "public", "rv-monogram-transparent-1024.png"))
  .toString("base64");
const logoSrc = `data:image/png;base64,${logoBase64}`;

export default async function OpengraphImage() {
  const site = await getSiteConfig();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#0d0e12",
          backgroundImage:
            "radial-gradient(circle at 15% 10%, rgba(129,110,245,0.35), transparent 55%), radial-gradient(circle at 85% 85%, rgba(93,199,222,0.25), transparent 55%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={64} height={64} alt="" />
          <div style={{ fontSize: 28, color: "#8b8fa3", letterSpacing: 2 }}>
            {site.role.toUpperCase()}
          </div>
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 72,
            fontWeight: 600,
            color: "#f5f6f8",
            lineHeight: 1.1,
          }}
        >
          {site.name}
        </div>
        <div style={{ marginTop: 28, fontSize: 30, color: "#b7bac6", maxWidth: 900 }}>
          {site.tagline}
        </div>
      </div>
    ),
    { ...size },
  );
}
