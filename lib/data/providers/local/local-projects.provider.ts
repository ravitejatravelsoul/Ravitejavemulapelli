import type { ProjectsRepository } from "@/lib/data/repositories/projects.repository";
import type { Project, ProjectSummary } from "@/lib/data/types";
import { readMdxCollection, readMdxDocument } from "@/lib/data/providers/local/mdx";
import { findFirstAvailablePublicAsset, isPublicAssetAvailable } from "@/lib/asset-availability";

type ProjectFrontmatter = Omit<Project, "slug" | "content">;

function toSummary(project: Project): ProjectSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content: _content, ...summary } = project;
  return summary;
}

/**
 * A project's `coverImage`/`gallery` frontmatter fields are optional. When
 * left unset, fall back to checking the well-known `public/projects/<slug>/`
 * filenames (the `portfolio-assets/projects/<slug>/README.md` convention)
 * so dropping a file into that folder makes it appear with no MDX edit and
 * no code change. Explicit frontmatter values win, but are still checked
 * against disk — an MDX file can point at an image before it's uploaded, and
 * this makes sure that renders the designed placeholder instead of a broken
 * `<img>` until the real file lands in `public/`.
 */
function withAutoDetectedMedia(project: Project): Project {
  const base = `/projects/${project.slug}`;

  const explicitCover = isPublicAssetAvailable(project.coverImage) ? project.coverImage : undefined;
  const coverImage =
    explicitCover ||
    findFirstAvailablePublicAsset([
      `${base}/cover.webp`,
      `${base}/cover.jpg`,
      `${base}/cover.jpeg`,
      `${base}/cover.png`,
    ]) ||
    undefined;

  let gallery = project.gallery;
  if (!gallery || gallery.length === 0) {
    const detected: string[] = [];
    for (let i = 1; i <= 6; i += 1) {
      const num = String(i).padStart(2, "0");
      const found = findFirstAvailablePublicAsset([
        `${base}/gallery-${num}.webp`,
        `${base}/gallery-${num}.jpg`,
        `${base}/gallery-${num}.jpeg`,
        `${base}/gallery-${num}.png`,
        `${base}/gallery-${num}.gif`,
      ]);
      if (found) detected.push(found);
    }
    for (const extra of [`${base}/architecture.png`, `${base}/workflow.png`, `${base}/demo.mp4`]) {
      if (isPublicAssetAvailable(extra)) detected.push(extra);
    }
    if (detected.length > 0) gallery = detected;
  }

  return { ...project, coverImage, gallery };
}

async function loadAll(): Promise<Project[]> {
  const docs = await readMdxCollection<ProjectFrontmatter>("projects");
  return docs
    .map((doc) => withAutoDetectedMedia({ slug: doc.slug, content: doc.content, ...doc.frontmatter }))
    .sort((a, b) => a.order - b.order);
}

export const localProjectsProvider: ProjectsRepository = {
  async getAll() {
    const projects = await loadAll();
    return projects.map(toSummary);
  },

  async getFeatured() {
    const projects = await loadAll();
    return projects.filter((project) => project.featured).map(toSummary);
  },

  async getBySlug(slug) {
    const doc = await readMdxDocument<ProjectFrontmatter>("projects", slug);
    if (!doc) return null;
    return withAutoDetectedMedia({ slug: doc.slug, content: doc.content, ...doc.frontmatter });
  },

  async getAllSlugs() {
    const projects = await loadAll();
    return projects.map((project) => project.slug);
  },
};
