import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Checks whether a `public/`-relative URL (e.g. "/resume/x.pdf") points to a
 * file that actually exists on disk. Server-only (uses `node:fs`) — used to
 * avoid rendering download buttons/links that would 404, without needing a
 * network request. Reads happen at request/build time, so a file dropped
 * into `public/` starts working on the next request with no code change.
 */
export function isPublicAssetAvailable(publicUrl: string | undefined | null): boolean {
  if (!publicUrl) return false;
  const relative = publicUrl.replace(/^\//, "");
  const fullPath = path.join(process.cwd(), "public", relative);
  return existsSync(fullPath);
}

/** Returns the first candidate URL that exists on disk, or null if none do — used where the file extension isn't known ahead of time (e.g. a headshot that could be .jpg/.png/.webp). */
export function findFirstAvailablePublicAsset(candidates: string[]): string | null {
  return candidates.find((candidate) => isPublicAssetAvailable(candidate)) ?? null;
}
