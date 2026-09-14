import "server-only";
import { join } from "node:path";

/**
 * The AI Office database lives outside `content/` and outside anything
 * the public portfolio reads, per
 * docs/ai-office/02-current-portfolio-assessment.md §6 and
 * docs/ai-office/06-data-model.md §1. `.data/office.db` is already
 * covered by the existing `.gitignore` `*.db` pattern (verified before
 * this file was written — no `.gitignore` change was needed).
 *
 * Resolved from `process.cwd()`, matching how `next dev`/`next build`/
 * `next start` are actually run in this repo (from the project root,
 * `output: "standalone"` is not configured) — see the migration runner
 * for the same assumption applied to reading the migration SQL files.
 */
/**
 * `AI_OFFICE_DB_PATH` is a real, supported override — not test-only. The
 * Next.js app and the standalone runner (`lib/ai-office/runner/start.ts`)
 * are two separate OS processes; both resolve this the exact same way
 * (`process.cwd()` when unset), so they only ever diverge onto different
 * files if started from two different working directories — a real
 * failure mode investigated and ruled out for the first Claude LIVE pilot
 * (both processes were confirmed, via their actual running PIDs, to
 * resolve the identical absolute path). This override exists so a
 * permanent e2e test (lib/ai-office/e2e/__tests__/office-navigation.e2e.ts)
 * can point a real spawned `next dev`/runner pair at a disposable
 * database instead of ever touching a real `.data/office.db`.
 */
export function getDefaultDbPath(): string {
  return process.env.AI_OFFICE_DB_PATH || join(process.cwd(), ".data", "office.db");
}

export function getMigrationsDir(): string {
  return join(process.cwd(), "lib", "ai-office", "db", "migrations");
}

/**
 * Root directory for all per-project real-development workspaces
 * (Phase 8) — a sibling of `.data/office.db`, covered by the same
 * `.gitignore` `/.data/` rule (no gitignore change needed). Every
 * project's workspace is `<this>/<projectId>/`; nothing outside
 * lib/ai-office/workspace/workspace-service.ts should ever read this
 * path directly.
 *
 * `AI_OFFICE_WORKSPACES_ROOT` is a test-only override (mirroring how
 * `db/test-helpers.ts` isolates the SQLite file into a temp directory
 * per test) — real app code never sets this env var.
 */
export function getWorkspacesRootPath(): string {
  return process.env.AI_OFFICE_WORKSPACES_ROOT || join(process.cwd(), ".data", "ai-office-workspaces");
}
