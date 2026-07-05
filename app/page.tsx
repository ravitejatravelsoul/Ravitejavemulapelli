import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/data";
import { JsonLd } from "@/components/common/json-ld";
import { Hero } from "@/components/sections/hero";
import { ImpactStats } from "@/components/sections/impact-stats";
import { WhatIBuild } from "@/components/sections/what-i-build";
import { AboutTeaser } from "@/components/sections/about-teaser";
import { FeaturedProjects } from "@/components/sections/featured-projects";
import { PhilosophyPreview } from "@/components/sections/philosophy-preview";
import { ExperienceTimelinePreview } from "@/components/sections/experience-timeline-preview";
import { TravelPreview } from "@/components/sections/travel-preview";
import { BlogPreview } from "@/components/sections/blog-preview";
import { SectionDivider } from "@/components/motion/section-divider";
import { isPlaceholderUrl } from "@/lib/placeholder";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: site.seo.defaultTitle,
    description: site.seo.description,
    alternates: { canonical: "/" },
  };
}

/**
 * Homepage as a narrative, not a stack of interchangeable sections: who I
 * am (Hero) -> what I build -> why I build -> featured proof -> how I think
 * -> where I am now -> off the clock -> writing -> the ask (closing CTA
 * lives in the global Footer, not a homepage-only section). Each section
 * pulls from the same content layer the dedicated pages use, so there's
 * nothing to keep in sync by hand.
 */
export default async function Home() {
  const site = await getSiteConfig();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Person",
          name: site.name,
          jobTitle: site.role,
          url: site.seo.url,
          email: site.email,
          address: site.location,
          sameAs: site.social
            .filter((social) => social.icon !== "email" && !isPlaceholderUrl(social.url))
            .map((social) => social.url),
        }}
      />
      <Hero />
      <SectionDivider variant="curve" />
      <ImpactStats />
      <WhatIBuild />
      <AboutTeaser />
      <FeaturedProjects />
      <PhilosophyPreview />
      <ExperienceTimelinePreview />
      <TravelPreview />
      <BlogPreview />
    </>
  );
}
