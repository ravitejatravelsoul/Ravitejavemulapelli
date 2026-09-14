import type { MetadataRoute } from "next";
import { getSiteConfig } from "@/lib/data";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getSiteConfig();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /office/** is the private, authenticated AI Office workspace — kept
      // out of crawlable discovery. Authentication (not this rule) is the
      // real access boundary; see docs/ai-office/08-security-plan.md.
      disallow: ["/api/", "/office/"],
    },
    sitemap: `${site.seo.url}/sitemap.xml`,
  };
}
