import { getProjects, getSiteConfig } from "@/lib/data";
import { HeroExperience } from "@/components/sections/hero-experience";
import { ResumeDownloadButton } from "@/components/resume/resume-download-button";
import { isPlaceholder } from "@/lib/placeholder";
import { findFirstAvailablePublicAsset } from "@/lib/asset-availability";

function initialsFor(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

const HEADSHOT_CANDIDATES = [
  "/profile/headshot.jpg",
  "/profile/headshot.jpeg",
  "/profile/headshot.png",
  "/profile/headshot.webp",
];

/**
 * Server wrapper: fetches site/project data and the headshot path, then
 * hands everything to the client-side `HeroExperience`, which owns the
 * cinematic layout, scroll-collapse, and mouse-driven motion. The resume
 * button is a Server Component itself (checks the PDF's existence on
 * disk) so it's rendered here and passed down as a prop rather than
 * imported directly into the client tree.
 */
export async function Hero() {
  const [site, projects] = await Promise.all([getSiteConfig(), getProjects()]);
  const photoUrl = findFirstAvailablePublicAsset(HEADSHOT_CANDIDATES);
  const thesisIsDraft = isPlaceholder(site.thesis);
  const displayName = site.preferredName ?? site.name;

  return (
    <HeroExperience
      displayName={displayName}
      name={site.name}
      initials={initialsFor(site.name)}
      role={site.role}
      location={site.location}
      yearsExperience={site.yearsExperience}
      thesis={site.thesis}
      thesisIsDraft={thesisIsDraft}
      photoUrl={photoUrl}
      productsShipped={projects.length}
      resumeButton={
        <ResumeDownloadButton label="Download Resume" variant="outline" className="h-12 rounded-xl px-7 text-base" />
      }
    />
  );
}
