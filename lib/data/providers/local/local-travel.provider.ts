import type { TravelRepository } from "@/lib/data/repositories/travel.repository";
import type { TravelEntry } from "@/lib/data/types";
import { readJsonData } from "@/lib/data/providers/local/mdx";

export const localTravelProvider: TravelRepository = {
  async getAll() {
    return readJsonData<TravelEntry[]>("travel.json");
  },

  async getStats() {
    const entries = await readJsonData<TravelEntry[]>("travel.json");
    const visited = entries.filter((entry) => entry.visited);
    const statesVisited = visited.reduce(
      (count, entry) => count + (entry.states?.length ?? 0),
      0,
    );
    return {
      countriesVisited: visited.length,
      continentsVisited: new Set(visited.map((entry) => entry.continent)).size,
      statesVisited,
      citiesVisited: visited.reduce(
        (count, entry) => count + (entry.stories?.length ?? 0),
        0,
      ),
    };
  },
};
