/** Content authored as a TODO placeholder (see content/data/*.json) — detected so it can render as an intentional draft state instead of looking broken. */
export function isPlaceholder(text: string | undefined | null): boolean {
  if (!text) return false;
  return /^todo\b/i.test(text.trim());
}

export function stripPlaceholderPrefix(text: string): string {
  return text.replace(/^todo:?\s*/i, "");
}

/** A URL authored as a TODO placeholder (e.g. "https://github.com/TODO-your-username") — real-looking but dead, so it should be filtered out of rendered links and structured data rather than shown as a broken link. */
export function isPlaceholderUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return /todo/i.test(url);
}
