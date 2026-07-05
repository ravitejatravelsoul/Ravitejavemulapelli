"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * `attribute="class"` toggles `.light`/`.dark` on `<html>` (matching the
 * `@custom-variant dark` selector in globals.css). `defaultTheme="system"`
 * with `enableSystem` means a first-time visitor (no stored preference yet)
 * gets their OS preference; the bare `:root` palette in globals.css is the
 * dark theme, so anything before the theme script runs (or with JS
 * disabled) still renders the site's dark-first default.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
