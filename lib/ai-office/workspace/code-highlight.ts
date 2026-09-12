import "server-only";
import path from "node:path";
import { codeToHtml } from "shiki";

/**
 * Read-only syntax highlighting for the project detail page's Files
 * viewer — reuses shiki (already a dependency, via rehype-pretty-code's
 * blog pipeline) through its standalone `codeToHtml()` API, matching the
 * same "github-dark-dimmed" theme the blog already uses so the two don't
 * look like two different products. No editing capability — this only
 * ever produces static HTML for display.
 */

const LANG_BY_EXTENSION: Record<string, string> = {
  ".html": "html",
  ".css": "css",
  ".js": "javascript",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".jsx": "jsx",
  ".json": "json",
  ".md": "markdown",
};

function languageForPath(filePath: string): string {
  return LANG_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "text";
}

export async function highlightFileContent(filePath: string, content: string): Promise<string> {
  return codeToHtml(content, { lang: languageForPath(filePath), theme: "github-dark-dimmed" });
}
