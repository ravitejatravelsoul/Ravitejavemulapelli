import type { MetadataRoute } from "next";
import { getBlogSlugs, getProjectSlugs, getSiteConfig } from "@/lib/data";

const staticRoutes = [
  "",
  "/about",
  "/experience",
  "/projects",
  "/skills",
  "/achievements",
  "/certifications",
  "/resume",
  "/travel",
  "/blog",
  "/contact",
  // /office/** is intentionally excluded — private, authenticated workspace.
  "/ai-office",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [site, projectSlugs, blogSlugs] = await Promise.all([
    getSiteConfig(),
    getProjectSlugs(),
    getBlogSlugs(),
  ]);
  const base = site.seo.url;
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    url: `${base}${route}`,
    lastModified: now,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));

  const projectEntries: MetadataRoute.Sitemap = projectSlugs.map((slug) => ({
    url: `${base}/projects/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const blogEntries: MetadataRoute.Sitemap = blogSlugs.map((slug) => ({
    url: `${base}/blog/${slug}`,
    lastModified: now,
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  return [...staticEntries, ...projectEntries, ...blogEntries];
}
