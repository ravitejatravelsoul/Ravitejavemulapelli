import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The AI Office e2e suites' isolated build output (a custom `distDir`
    // so each can run alongside an interactive `next dev`, see
    // lib/ai-office/e2e/office-navigation.e2e.ts and
    // office-limited-production.e2e.ts) — same reason `.next/` itself is
    // ignored above: generated build artifacts, not source.
    ".next-e2e/**",
    ".next-e2e-limited/**",
    ".next-e2e-living/**",
  ]),
]);

export default eslintConfig;
