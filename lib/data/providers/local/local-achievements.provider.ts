import type { AchievementsRepository } from "@/lib/data/repositories/achievements.repository";
import type { Achievement } from "@/lib/data/types";
import { readJsonData } from "@/lib/data/providers/local/mdx";

export const localAchievementsProvider: AchievementsRepository = {
  async getAll() {
    const achievements = await readJsonData<Achievement[]>("achievements.json");
    return [...achievements].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  },
};
