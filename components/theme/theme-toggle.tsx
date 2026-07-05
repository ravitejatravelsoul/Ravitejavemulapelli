"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";

/**
 * Two icons stacked and cross-faded/rotated rather than swapped outright —
 * reads as the sun "setting" into the moon instead of an abrupt icon
 * replacement. `mounted` guards against rendering `resolvedTheme` (which is
 * `undefined` server-side and on the very first client render) so the icon
 * never has to reconcile a server/client mismatch; until mounted, it
 * assumes dark — the site's default — so the one-tick gap before hydration
 * finishes never shows the wrong icon for anyone who hasn't switched to light.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  const isDark = mounted ? resolvedTheme === "dark" : true;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn("relative overflow-hidden", className)}
    >
      <Sun
        aria-hidden
        className={cn(
          "size-4.5 transition-all duration-500 ease-out",
          isDark ? "scale-0 -rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100",
        )}
      />
      <Moon
        aria-hidden
        className={cn(
          "absolute size-4.5 transition-all duration-500 ease-out",
          isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 rotate-90 opacity-0",
        )}
      />
    </Button>
  );
}
