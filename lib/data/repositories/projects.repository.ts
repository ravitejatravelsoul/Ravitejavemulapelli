import type { Project, ProjectSummary } from "@/lib/data/types";

export interface ProjectsRepository {
  getAll(): Promise<ProjectSummary[]>;
  getFeatured(): Promise<ProjectSummary[]>;
  getBySlug(slug: string): Promise<Project | null>;
  getAllSlugs(): Promise<string[]>;
}
