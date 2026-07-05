import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export interface MdxDocument<TFrontmatter> {
  slug: string;
  frontmatter: TFrontmatter;
  content: string;
}

const CONTENT_ROOT = path.join(process.cwd(), "content");

/** Reads every `.mdx` file in a content subdirectory and parses its frontmatter. */
export async function readMdxCollection<TFrontmatter>(
  collection: string,
): Promise<MdxDocument<TFrontmatter>[]> {
  const dir = path.join(CONTENT_ROOT, collection);
  const files = await readdir(dir);
  const mdxFiles = files.filter((file) => file.endsWith(".mdx"));

  const docs = await Promise.all(
    mdxFiles.map(async (file) => {
      const raw = await readFile(path.join(dir, file), "utf8");
      const { data, content } = matter(raw);
      return {
        slug: file.replace(/\.mdx$/, ""),
        frontmatter: data as TFrontmatter,
        content: content.trim(),
      };
    }),
  );

  return docs;
}

export async function readMdxDocument<TFrontmatter>(
  collection: string,
  slug: string,
): Promise<MdxDocument<TFrontmatter> | null> {
  try {
    const raw = await readFile(
      path.join(CONTENT_ROOT, collection, `${slug}.mdx`),
      "utf8",
    );
    const { data, content } = matter(raw);
    return { slug, frontmatter: data as TFrontmatter, content: content.trim() };
  } catch {
    return null;
  }
}

export async function readJsonData<T>(fileName: string): Promise<T> {
  const raw = await readFile(
    path.join(CONTENT_ROOT, "data", fileName),
    "utf8",
  );
  return JSON.parse(raw) as T;
}
