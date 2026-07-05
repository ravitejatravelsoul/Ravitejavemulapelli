import type { CertificationsRepository } from "@/lib/data/repositories/certifications.repository";
import type { Certification } from "@/lib/data/types";
import { readJsonData } from "@/lib/data/providers/local/mdx";

export const localCertificationsProvider: CertificationsRepository = {
  async getAll() {
    const certifications = await readJsonData<Certification[]>("certifications.json");
    return [...certifications].sort(
      (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime(),
    );
  },
};
