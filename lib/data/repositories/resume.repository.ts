import type { ResumeData } from "@/lib/data/types";

export interface ResumeRepository {
  get(): Promise<ResumeData>;
}
