import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets the AI Office e2e smoke suite (lib/ai-office/e2e/office-navigation.e2e.ts)
  // spawn its own `next dev` instance, on its own port, against its own
  // disposable database, without colliding with an already-running
  // interactive `next dev` in the same project directory — Next's
  // single-dev-server-per-directory lock lives inside `.next/`, keyed by
  // directory, not by port. Unset in normal (non-e2e) use, so this never
  // changes the real dev server's own build output location.
  ...(process.env.AI_OFFICE_E2E_DIST_DIR ? { distDir: process.env.AI_OFFICE_E2E_DIST_DIR } : {}),
};

export default nextConfig;
