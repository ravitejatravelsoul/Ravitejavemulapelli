import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getBlogPosts } from "@/lib/data";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { FadeIn } from "@/components/motion/fade-in";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { PostCard } from "@/components/blog/post-card";

export async function BlogPreview() {
  const posts = await getBlogPosts();
  const latest = posts.slice(0, 3);

  if (latest.length === 0) return null;

  return (
    <Section className="border-t border-border/60">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <SectionHeading
          eyebrow="Writing"
          title="Notes from building"
          description="Longer-form thinking on automation, quality engineering, AI, and shipping products."
        />
        <FadeIn delay={0.2}>
          <Link
            href="/blog"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            All posts <ArrowRight className="size-4" />
          </Link>
        </FadeIn>
      </div>

      <StaggerContainer className="mt-14 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {latest.map((post, index) => (
          <StaggerItem key={post.slug}>
            <PostCard post={post} index={index} />
          </StaggerItem>
        ))}
      </StaggerContainer>
    </Section>
  );
}
