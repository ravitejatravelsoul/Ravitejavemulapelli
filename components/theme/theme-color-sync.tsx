"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

const THEME_COLORS = {
  light: "#fbfbfc",
  dark: "#0d0e12",
} as const;

/**
 * The static `theme-color` metas from `generateViewport` are keyed to
 * `prefers-color-scheme`, which tracks the OS — not the user's explicit
 * choice via the toggle. A dark-OS user who switches the site to light
 * would otherwise get a light page under dark browser chrome on mobile.
 * This keeps every `theme-color` meta in sync with the *resolved* theme;
 * under "system" the resolved theme tracks the OS anyway, so the behavior
 * there is unchanged. Renders nothing.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = THEME_COLORS[resolvedTheme];
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", color));
  }, [resolvedTheme]);

  return null;
}
