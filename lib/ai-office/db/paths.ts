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
export function getDefaultDbPath(): string {
  return join(process.cwd(), ".data", "office.db");
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
