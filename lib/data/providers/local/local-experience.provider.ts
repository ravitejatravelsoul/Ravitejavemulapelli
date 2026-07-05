import type { ExperienceRepository } from "@/lib/data/repositories/experience.repository";
import type { ExperienceEntry } from "@/lib/data/types";
import { readJsonData } from "@/lib/data/providers/local/mdx";

export const localExperienceProvider: ExperienceRepository = {
  async getAll() {
    const entries = await readJsonData<ExperienceEntry[]>("experience.json");
    return [...entries].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
  },
};
