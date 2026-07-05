import type { Certification } from "@/lib/data/types";

export interface CertificationsRepository {
  getAll(): Promise<Certification[]>;
}
