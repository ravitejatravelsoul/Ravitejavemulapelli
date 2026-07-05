import type { BlogPost, BlogPostSummary } from "@/lib/data/types";

export interface BlogRepository {
  getAll(): Promise<BlogPostSummary[]>;
  getBySlug(slug: string): Promise<BlogPost | null>;
  getAllSlugs(): Promise<string[]>;
}
