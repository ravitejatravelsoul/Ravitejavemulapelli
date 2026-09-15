import "server-only";

/**
 * Remote Mode's own execution-mode switch — deliberately a SEPARATE env
 * var from `AI_OFFICE_OPERATIONAL_MODE`
 * (lib/ai-office/config/operational-mode.ts), which answers a different
 * question ("is it safe to mutate state at all on this deployment?") from
 * this one ("where does that state actually live, and what executes the
 * work?"). Conflating them would mean a single flag carrying two
 * unrelated meanings — exactly what this file's docs elsewhere warn
 * against.
 *
 *   - "local"  — existing SQLite (.data/office.db), existing local
 *     runner/supervisor, local workspace filesystem, Ollama available.
 *     The default everywhere except a real Vercel deployment.
 *   - "remote" — GitHub-backed durable state (lib/ai-office/remote/**),
 *     GitHub Actions executes background work, no local SQLite/runner/
 *     Ollama dependency. Only meaningful on Vercel production, and only
 *     once explicitly turned on here — this file's default is "local"
 *     even in a `NODE_ENV=production` build, unlike
 *     `isAiOfficeOperationalModeEnabled()`'s safe-by-default flip. Remote
 *     Mode requires real GitHub credentials to function at all, so
 *     defaulting it "on" for any production build would just be a
 *     different flavor of the same unsafe-by-default mistake — this
 *     stays "local" until a specific deployment is deliberately
 *     configured for it.
 */
export type AiOfficeExecutionMode = "local" | "remote";

export function getAiOfficeExecutionMode(): AiOfficeExecutionMode {
  return process.env.AI_OFFICE_EXECUTION_MODE === "remote" ? "remote" : "local";
}

export function isRemoteExecutionMode(): boolean {
  return getAiOfficeExecutionMode() === "remote";
}
