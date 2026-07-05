import type { SkillsRepository } from "@/lib/data/repositories/skills.repository";
import type { SkillGroup } from "@/lib/data/types";
import { readJsonData } from "@/lib/data/providers/local/mdx";

export const localSkillsProvider: SkillsRepository = {
  async getAll() {
    return readJsonData<SkillGroup[]>("skills.json");
  },
};
