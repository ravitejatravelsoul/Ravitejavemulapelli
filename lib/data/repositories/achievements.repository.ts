import type { Achievement } from "@/lib/data/types";

export interface AchievementsRepository {
  getAll(): Promise<Achievement[]>;
}
