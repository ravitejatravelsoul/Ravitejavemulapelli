import type { Metadata } from "next";
import { getBlogPosts, getSiteConfig } from "@/lib/data";
import { JsonLd } from "@/components/common/json-ld";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { BlogExplorer } from "@/components/blog/blog-explorer";
import { FeaturedPostCard } from "@/components/blog/featured-post-card";
import { Reveal } from "@/components/common/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Writing",
    description: `Notes on engineering, automation, and building products, by ${site.name}.`,
    alternates: { canonical: "/blog" },
  };
}

export default async function BlogPage() {
  const [posts, site] = await Promise.all([getBlogPosts(), getSiteConfig()]);
  const [featured, ...rest] = posts;

  return (
    <Section className="pt-20 md:pt-24">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: `${site.name} — Writing`,
          url: `${site.seo.url}/blog`,
          blogPost: posts.map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            url: `${site.seo.url}/blog/${post.slug}`,
            datePublished: post.publishedDate,
          })),
        }}
      />
      <SectionHeading
        as="h1"
        eager
        eyebrow="Writing"
        title="Notes from building"
        description="Longer-form thinking on automation, quality engineering, AI, and shipping products."
      />

      {featured ? (
        <Reveal eager delay={0.1} className="mt-14">
          <FeaturedPostCard post={featured} />
        </Reveal>
      ) : null}

      <div className="mt-16">
        <BlogExplorer posts={rest} />
      </div>
    </Section>
  );
}
