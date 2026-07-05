import type { MetadataRoute } from "next";
import { getSiteConfig } from "@/lib/data";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getSiteConfig();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: `${site.seo.url}/sitemap.xml`,
  };
}
