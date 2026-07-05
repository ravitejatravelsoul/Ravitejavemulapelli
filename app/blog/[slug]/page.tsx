import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { getBlogPostBySlug, getBlogPosts, getBlogSlugs, getSiteConfig } from "@/lib/data";
import { mdxComponents } from "@/lib/mdx-components";
import { extractToc } from "@/lib/toc";
import { formatMonthYear } from "@/lib/format";
import { Section } from "@/components/common/section";
import { Reveal } from "@/components/common/reveal";
import { Badge } from "@/components/ui/badge";
import { JsonLd } from "@/components/common/json-ld";
import { TableOfContents } from "@/components/blog/table-of-contents";
import { PostCard } from "@/components/blog/post-card";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { ReadingProgress } from "@/components/motion/reading-progress";

export async function generateStaticParams() {
  const slugs = await getBlogSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  if (!post) return {};

  const ogImage = post.coverImage || "/og-image.png";

  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.publishedDate,
      images: [{ url: ogImage, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: [ogImage],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [post, allPosts, site] = await Promise.all([
    getBlogPostBySlug(slug),
    getBlogPosts(),
    getSiteConfig(),
  ]);

  if (!post) notFound();

  const toc = extractToc(post.content);
  const related = allPosts.filter((p) => p.slug !== post.slug).slice(0, 3);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description: post.excerpt,
          author: { "@type": "Person", name: post.author },
          datePublished: post.publishedDate,
          dateModified: post.updatedDate ?? post.publishedDate,
          url: `${site.seo.url}/blog/${post.slug}`,
        }}
      />
      <ReadingProgress />
      <Section className="pt-20 pb-0 md:pt-24">
        <Reveal eager>
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> All posts
          </Link>

          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <Badge variant="secondary">{post.category}</Badge>
            <span>{formatMonthYear(post.publishedDate)}</span>
            <span>· {post.readingTimeMinutes} min read</span>
          </div>

          <h1 className="mt-6 max-w-3xl text-balance text-[clamp(1.875rem,4vw,2.75rem)] leading-[1.15] font-semibold tracking-tight">
            {post.title}
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
            {post.excerpt}
          </p>
        </Reveal>
      </Section>

      <Section containerClassName="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_16rem]">
        <Reveal className="min-w-0">
          <article className="max-w-2xl">
            <MDXRemote
              source={post.content}
              components={mdxComponents}
              options={{
                mdxOptions: {
                  remarkPlugins: [remarkGfm],
                  rehypePlugins: [
                    rehypeSlug,
                    [rehypeAutolinkHeadings, { behavior: "wrap" }],
                    [rehypePrettyCode, { theme: "github-dark-dimmed" }],
                  ],
                },
              }}
            />
          </article>
        </Reveal>

        <Reveal delay={0.1} className="hidden lg:sticky lg:top-24 lg:block lg:h-fit">
          <TableOfContents entries={toc} />
        </Reveal>
      </Section>

      {related.length > 0 ? (
        <Section className="border-t border-border/60">
          <Reveal>
            <p className="text-sm font-medium tracking-wide text-primary uppercase">
              More writing
            </p>
          </Reveal>
          <StaggerContainer className="mt-8 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p, index) => (
              <StaggerItem key={p.slug}>
                <PostCard post={p} index={index} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </Section>
      ) : null}
    </>
  );
}
