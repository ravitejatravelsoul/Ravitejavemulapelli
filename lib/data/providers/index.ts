// Provider factory. Every repo currently resolves to its local (filesystem)
// implementation. To move a domain to Firestore later: implement the same
// repository interface in a new `providers/firestore/*.provider.ts` file and
// swap the export below — no changes required in `lib/data/index.ts` or in
// any page/component, since they only ever call the repo functions.

import { localProjectsProvider } from "@/lib/data/providers/local/local-projects.provider";
import { localExperienceProvider } from "@/lib/data/providers/local/local-experience.provider";
import { localSkillsProvider } from "@/lib/data/providers/local/local-skills.provider";
import { localAchievementsProvider } from "@/lib/data/providers/local/local-achievements.provider";
import { localCertificationsProvider } from "@/lib/data/providers/local/local-certifications.provider";
import { localTravelProvider } from "@/lib/data/providers/local/local-travel.provider";
import { localBlogProvider } from "@/lib/data/providers/local/local-blog.provider";
import { localResumeProvider } from "@/lib/data/providers/local/local-resume.provider";
import { localSiteProvider } from "@/lib/data/providers/local/local-site.provider";

export const providers = {
  projects: localProjectsProvider,
  experience: localExperienceProvider,
  skills: localSkillsProvider,
  achievements: localAchievementsProvider,
  certifications: localCertificationsProvider,
  travel: localTravelProvider,
  blog: localBlogProvider,
  resume: localResumeProvider,
  site: localSiteProvider,
};
