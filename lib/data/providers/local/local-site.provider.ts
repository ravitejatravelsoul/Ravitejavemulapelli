import type { SiteRepository } from "@/lib/data/repositories/site.repository";
import type { SiteConfig } from "@/lib/data/types";
import { readJsonData } from "@/lib/data/providers/local/mdx";

export const localSiteProvider: SiteRepository = {
  async get() {
    return readJsonData<SiteConfig>("site.json");
  },
};
