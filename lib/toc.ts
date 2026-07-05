import GithubSlugger from "github-slugger";

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/** Extracts h2/h3 headings from raw markdown and slugs them the same way rehype-slug does. */
export function extractToc(markdown: string): TocEntry[] {
  const slugger = new GithubSlugger();
  const headingPattern = /^(#{2,3})\s+(.+)$/gm;
  const entries: TocEntry[] = [];

  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(markdown)) !== null) {
    const level = match[1].length as 2 | 3;
    const text = match[2].trim();
    entries.push({ id: slugger.slug(text), text, level });
  }

  return entries;
}
