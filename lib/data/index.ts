// Public data API. Pages and components must import content access
// functions from here — never from `content/`, a provider, or `fs` directly.
import { providers } from "@/lib/data/providers";

export const getProjects = () => providers.projects.getAll();
export const getFeaturedProjects = () => providers.projects.getFeatured();
export const getProjectBySlug = (slug: string) => providers.projects.getBySlug(slug);
export const getProjectSlugs = () => providers.projects.getAllSlugs();

export const getExperience = () => providers.experience.getAll();

export const getSkillGroups = () => providers.skills.getAll();

export const getAchievements = () => providers.achievements.getAll();

export const getCertifications = () => providers.certifications.getAll();

export const getTravelEntries = () => providers.travel.getAll();
export const getTravelStats = () => providers.travel.getStats();

export const getBlogPosts = () => providers.blog.getAll();
export const getBlogPostBySlug = (slug: string) => providers.blog.getBySlug(slug);
export const getBlogSlugs = () => providers.blog.getAllSlugs();

export const getResume = () => providers.resume.get();

export const getSiteConfig = () => providers.site.get();

export type {
  Project,
  ProjectSummary,
  ExperienceEntry,
  SkillGroup,
  Skill,
  Achievement,
  Certification,
  TravelEntry,
  TravelStats,
  BlogPost,
  BlogPostSummary,
  ResumeData,
  SiteConfig,
  SocialLink,
  ContactMessageInput,
} from "@/lib/data/types";
