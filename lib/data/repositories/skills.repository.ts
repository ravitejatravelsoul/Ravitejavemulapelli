import type { SkillGroup } from "@/lib/data/types";

export interface SkillsRepository {
  getAll(): Promise<SkillGroup[]>;
}
