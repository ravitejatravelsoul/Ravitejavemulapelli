import type { ResumeRepository } from "@/lib/data/repositories/resume.repository";
import type { ResumeData } from "@/lib/data/types";
import { readJsonData } from "@/lib/data/providers/local/mdx";

export const localResumeProvider: ResumeRepository = {
  async get() {
    return readJsonData<ResumeData>("resume.json");
  },
};
