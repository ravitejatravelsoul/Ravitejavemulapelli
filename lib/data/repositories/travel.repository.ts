import type { TravelEntry, TravelStats } from "@/lib/data/types";

export interface TravelRepository {
  getAll(): Promise<TravelEntry[]>;
  getStats(): Promise<TravelStats>;
}
