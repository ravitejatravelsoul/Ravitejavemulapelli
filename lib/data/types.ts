// Shared domain types for the content layer.
// UI components and pages must only depend on these types plus the
// repository functions in `lib/data/index.ts` — never on content file
// formats or providers directly. This keeps the local (JSON/MDX) provider
// swappable for a Firestore provider later without touching the UI.

export type ProjectStatus = "live" | "in-progress" | "concept" | "archived";

export interface ProjectMetric {
  label: string;
  value: string;
}

export interface ProjectLinks {
  github?: string;
  live?: string;
  caseStudy?: string;
  playStore?: string;
  appStore?: string;
}

export interface Project {
  slug: string;
  title: string;
  tagline: string;
  summary: string;
  category: string[];
  techStack: string[];
  status: ProjectStatus;
  year: string;
  featured: boolean;
  order: number;
  coverImage?: string;
  gallery?: string[];
  links: ProjectLinks;
  metrics?: ProjectMetric[];
  /** Platforms the project ships on, e.g. ["Web", "Android", "iOS"] or ["Windows Desktop"]. */
  platform: string[];
  /** What I did on the project, e.g. "Full Stack Engineer" or "Product Designer, Developer". */
  role: string;
  /** A short one-off descriptive label distinct from `status`, e.g. "Enterprise Tool", "Client Project", "Coming Soon". */
  badge?: string;
  /** Shows a small "Featured Project" ribbon on the card — separate from `featured`, which controls homepage placement. */
  featuredRibbon?: boolean;
  /** Raw MDX body — problem, architecture, challenges, lessons, results, roadmap. */
  content: string;
}

export type ProjectSummary = Omit<Project, "content">;

export interface ExperienceEntry {
  id: string;
  company: string;
  companyUrl?: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string | null;
  employmentType: string;
  summary: string;
  responsibilities: string[];
  achievements: string[];
  technologies: string[];
  relatedProjectSlugs?: string[];
}

export interface Skill {
  name: string;
  level: 1 | 2 | 3 | 4 | 5;
  yearsExperience?: number;
}

export interface SkillGroup {
  id: string;
  category: string;
  description: string;
  skills: Skill[];
}

export interface AchievementMedia {
  type: "image" | "video" | "document" | "link";
  url: string;
  label: string;
}

export interface Achievement {
  id: string;
  title: string;
  date: string;
  description: string;
  category: string;
  tags: string[];
  milestone: boolean;
  media?: AchievementMedia[];
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate?: string | null;
  credentialId?: string;
  credentialUrl?: string;
  category: string;
  downloadUrl?: string;
}

export interface TravelStory {
  title: string;
  excerpt: string;
  date: string;
}

/** A planned-but-not-yet-taken trip — the "future bucket list," kept distinct from `stories` (which are trips that already happened). */
export interface FutureTrip {
  destination: string;
  note?: string;
}

export interface TravelEntry {
  countryCode: string;
  countryName: string;
  continent: string;
  visited: boolean;
  states?: string[];
  notes?: string;
  stories?: TravelStory[];
  photos?: string[];
  futureTrips?: FutureTrip[];
}

export interface TravelStats {
  countriesVisited: number;
  continentsVisited: number;
  statesVisited: number;
  citiesVisited: number;
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  publishedDate: string;
  updatedDate?: string;
  category: string;
  tags: string[];
  coverImage?: string;
  readingTimeMinutes: number;
  featured: boolean;
  author: string;
  content: string;
}

export type BlogPostSummary = Omit<BlogPost, "content">;

export interface ResumeSection {
  id: string;
  label: string;
}

export interface EducationEntry {
  degree: string;
  institution?: string;
  year?: string;
}

export interface ResumeData {
  summary: string;
  downloadUrl: string;
  updatedAt: string;
  highlights: string[];
  education?: EducationEntry[];
}

export interface SocialLink {
  label: string;
  url: string;
  icon: "github" | "linkedin" | "twitter" | "email";
}

export interface CoreValue {
  title: string;
  description: string;
}

export interface SiteConfig {
  name: string;
  preferredName?: string;
  role: string;
  tagline: string;
  thesis: string;
  location: string;
  yearsExperience: number;
  currentFocus: string;
  email: string;
  availability: string;
  social: SocialLink[];
  storyHook: string;
  story: string[];
  values: CoreValue[];
  seo: {
    defaultTitle: string;
    titleTemplate: string;
    description: string;
    keywords: string[];
    url: string;
  };
}

export interface ContactMessageInput {
  name: string;
  email: string;
  subject: string;
  message: string;
}
