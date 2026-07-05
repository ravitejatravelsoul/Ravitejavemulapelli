import readingTime from "reading-time";
import type { BlogRepository } from "@/lib/data/repositories/blog.repository";
import type { BlogPost, BlogPostSummary } from "@/lib/data/types";
import { readMdxCollection, readMdxDocument } from "@/lib/data/providers/local/mdx";

type BlogFrontmatter = Omit<BlogPost, "slug" | "content" | "readingTimeMinutes">;

function toSummary(post: BlogPost): BlogPostSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content: _content, ...summary } = post;
  return summary;
}

async function loadAll(): Promise<BlogPost[]> {
  const docs = await readMdxCollection<BlogFrontmatter>("blog");
  return docs
    .map((doc) => ({
      slug: doc.slug,
      content: doc.content,
      readingTimeMinutes: Math.max(1, Math.ceil(readingTime(doc.content).minutes)),
      ...doc.frontmatter,
    }))
    .sort(
      (a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime(),
    );
}

export const localBlogProvider: BlogRepository = {
  async getAll() {
    const posts = await loadAll();
    return posts.map(toSummary);
  },

  async getBySlug(slug) {
    const doc = await readMdxDocument<BlogFrontmatter>("blog", slug);
    if (!doc) return null;
    return {
      slug: doc.slug,
      content: doc.content,
      readingTimeMinutes: Math.max(1, Math.ceil(readingTime(doc.content).minutes)),
      ...doc.frontmatter,
    };
  },

  async getAllSlugs() {
    const posts = await loadAll();
    return posts.map((post) => post.slug);
  },
};
