import "server-only";
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { getWorkspacesRootPath } from "../db/paths.ts";

/**
 * The one and only place anything in this codebase is allowed to touch
 * a real-development-workspace file. Every path — whether it comes from
 * a materialized agent `fileOperations` entry, the owner-facing preview
 * route, or the code-viewer UI — passes through `resolveSafePath()`
 * before any `fs` call happens. No caller outside this module should
 * ever import `node:fs` for workspace content.
 *
 * Threat model: `relativePath` is effectively model-controlled (an LLM
 * chose it), so it is treated as untrusted input. `projectId` is always
 * server-controlled (it comes from a task/project row, never from model
 * output), so cross-project isolation only has to hold up against a
 * malicious `relativePath` trying to climb out of its own project root
 * — never against a caller claiming a different project id, which this
 * module has no way to prevent and doesn't need to.
 */

export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_WORKSPACE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export class WorkspacePathError extends Error {}
export class WorkspaceLimitError extends Error {}

/** Project ids are always our own `randomUUID()` output — a narrow allowlist, not a blocklist, so nothing unexpected can smuggle a traversal through this parameter either. */
function isSafeProjectId(projectId: string): boolean {
  return /^[a-zA-Z0-9-]{1,100}$/.test(projectId);
}

function assertSafeRelativePath(relativePath: string): void {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new WorkspacePathError("Path must be a non-empty string.");
  }
  if (relativePath.includes("\0")) {
    throw new WorkspacePathError("Path contains a null byte.");
  }
  if (path.isAbsolute(relativePath)) {
    throw new WorkspacePathError(`Absolute paths are not allowed: "${relativePath}".`);
  }
  // Windows drive-letter ("C:...") and UNC/device ("\\?\...", "\\.\...", "\\server\share") paths —
  // path.isAbsolute() already catches these on win32, but this module must reject them
  // identically regardless of which OS it happens to run on.
  if (/^[a-zA-Z]:/.test(relativePath) || relativePath.startsWith("\\\\")) {
    throw new WorkspacePathError(`Absolute or device paths are not allowed: "${relativePath}".`);
  }

  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    throw new WorkspacePathError(`Path resolves to nothing: "${relativePath}".`);
  }
  for (const segment of segments) {
    if (segment === "..") {
      throw new WorkspacePathError(`Path traversal ("..") is not allowed: "${relativePath}".`);
    }
    if (segment === ".") continue;
    const bareName = segment.split(".")[0]!.toUpperCase();
    if (WINDOWS_RESERVED_NAMES.has(bareName)) {
      throw new WorkspacePathError(`"${segment}" is a reserved device name and cannot be used in a workspace path.`);
    }
  }
}

function projectRoot(projectId: string): string {
  if (!isSafeProjectId(projectId)) {
    throw new WorkspacePathError(`Invalid project id: "${projectId}".`);
  }
  return path.join(getWorkspacesRootPath(), projectId);
}

/**
 * Resolves `relativePath` against `projectId`'s own workspace root and
 * verifies the result cannot have escaped it. Two independent checks:
 * (1) the plain string-resolved path must stay under the root — catches
 * every ordinary traversal; (2) the *realpath* of the nearest existing
 * ancestor directory must also stay under the root's own realpath —
 * catches a symlink planted somewhere in the path that points outside
 * the workspace, which (1) alone cannot see since it never touches the
 * filesystem.
 */
/**
 * Resolves `path` to its real, symlink-free form by realpath-ing the
 * nearest *existing* ancestor and reattaching whatever non-existent
 * suffix remains — rather than realpath-ing only when the whole path
 * happens to exist. This matters because the workspace root itself is
 * usually created lazily (it may not exist yet on a first write): if
 * the two sides of an escape check were normalized inconsistently
 * (one realpath'd, the other left as a raw string), routine OS-level
 * path normalization alone (case folding, short-name expansion, a
 * symlinked temp-directory prefix in tests) would produce a false
 * "escape" on every single write to a not-yet-created workspace. Both
 * sides of the comparison in `resolveSafePath` go through this exact
 * function so they're always normalized identically.
 */
function realpathOfNearestExistingAncestor(target: string): string {
  let ancestor = target;
  let suffix = "";
  while (!fsSync.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break; // reached the filesystem root without finding anything that exists
    suffix = suffix ? path.join(path.basename(ancestor), suffix) : path.basename(ancestor);
    ancestor = parent;
  }
  const realAncestor = fsSync.realpathSync(ancestor);
  return suffix ? path.join(realAncestor, suffix) : realAncestor;
}

export function resolveSafePath(projectId: string, relativePath: string): string {
  assertSafeRelativePath(relativePath);
  const root = projectRoot(projectId);
  const resolved = path.resolve(root, relativePath);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new WorkspacePathError(`Resolved path escapes the project workspace: "${relativePath}".`);
  }

  const realRoot = realpathOfNearestExistingAncestor(root);
  const realResolvedDir = realpathOfNearestExistingAncestor(path.dirname(resolved));
  if (realResolvedDir !== realRoot && !realResolvedDir.startsWith(realRoot + path.sep)) {
    throw new WorkspacePathError(`Resolved path escapes the project workspace via a symlink: "${relativePath}".`);
  }

  return resolved;
}

export function workspaceExists(projectId: string): boolean {
  return fsSync.existsSync(projectRoot(projectId));
}

export async function createWorkspace(projectId: string): Promise<void> {
  await fs.mkdir(projectRoot(projectId), { recursive: true });
}

/** Every file path, relative to the workspace root, forward-slash-joined regardless of OS — sorted for stable UI ordering. */
export async function listFiles(projectId: string): Promise<string[]> {
  if (!workspaceExists(projectId)) return [];
  const root = projectRoot(projectId);
  const results: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else results.push(rel);
    }
  }

  await walk(root, "");
  return results.sort();
}

export async function readFile(projectId: string, relativePath: string): Promise<string> {
  const full = resolveSafePath(projectId, relativePath);
  return fs.readFile(full, "utf8");
}

async function getFileSize(projectId: string, relativePath: string): Promise<number> {
  const full = resolveSafePath(projectId, relativePath);
  const stat = await fs.stat(full);
  return stat.size;
}

async function getWorkspaceTotalSize(projectId: string): Promise<number> {
  const files = await listFiles(projectId);
  let total = 0;
  for (const file of files) {
    try {
      total += await getFileSize(projectId, file);
    } catch {
      // Removed between listing and stat-ing — fine to skip, this is a best-effort total.
    }
  }
  return total;
}

/**
 * Atomic: writes to a temp file in the same directory, then renames
 * over the target — a reader never observes a partially-written file.
 * Enforces both the per-file and total-workspace size caps *before*
 * writing anything.
 */
export async function writeFile(projectId: string, relativePath: string, content: string): Promise<void> {
  const full = resolveSafePath(projectId, relativePath);
  const byteSize = Buffer.byteLength(content, "utf8");
  if (byteSize > MAX_FILE_SIZE_BYTES) {
    throw new WorkspaceLimitError(`"${relativePath}" is ${byteSize} bytes, exceeding the ${MAX_FILE_SIZE_BYTES}-byte per-file limit.`);
  }

  let existingSize = 0;
  try {
    existingSize = (await fs.stat(full)).size;
  } catch {
    // New file — nothing to subtract.
  }
  const currentTotal = await getWorkspaceTotalSize(projectId);
  const projectedTotal = currentTotal - existingSize + byteSize;
  if (projectedTotal > MAX_WORKSPACE_SIZE_BYTES) {
    throw new WorkspaceLimitError(
      `Writing "${relativePath}" would bring the workspace to ${projectedTotal} bytes, exceeding the ${MAX_WORKSPACE_SIZE_BYTES}-byte workspace limit.`,
    );
  }

  await fs.mkdir(path.dirname(full), { recursive: true });
  const tempPath = `${full}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, full);
}

export async function deleteFile(projectId: string, relativePath: string): Promise<void> {
  const full = resolveSafePath(projectId, relativePath);
  await fs.rm(full, { force: true });
}

export async function createDirectory(projectId: string, relativePath: string): Promise<void> {
  const full = resolveSafePath(projectId, relativePath);
  await fs.mkdir(full, { recursive: true });
}

export interface WorkspaceMetadata {
  exists: boolean;
  fileCount: number;
  totalSizeBytes: number;
}

export async function getWorkspaceMetadata(projectId: string): Promise<WorkspaceMetadata> {
  if (!workspaceExists(projectId)) return { exists: false, fileCount: 0, totalSizeBytes: 0 };
  const files = await listFiles(projectId);
  const totalSizeBytes = await getWorkspaceTotalSize(projectId);
  return { exists: true, fileCount: files.length, totalSizeBytes };
}
