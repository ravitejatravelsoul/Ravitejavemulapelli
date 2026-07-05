import type { ExperienceEntry } from "@/lib/data/types";

export interface ExperienceRepository {
  getAll(): Promise<ExperienceEntry[]>;
}
