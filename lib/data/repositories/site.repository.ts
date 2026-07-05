import type { SiteConfig } from "@/lib/data/types";

export interface SiteRepository {
  get(): Promise<SiteConfig>;
}
