"use client";

import { usePathname } from "next/navigation";

/**
 * Hides the public portfolio's own chrome (nav, footer) on every /office
 * route — Teja's AI Office is meant to feel like its own dedicated
 * application, not a page embedded inside the portfolio. Server Components
 * passed in as `children` still render server-side as usual; only the
 * decision to mount them is client-side (pathname isn't known at the
 * server-rendered root layout without adding middleware header plumbing).
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/office")) return null;
  return <>{children}</>;
}
