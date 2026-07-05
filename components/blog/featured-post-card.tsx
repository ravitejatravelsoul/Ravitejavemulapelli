import Link from "next/link";
import { ArrowUpRight, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProjectCover } from "@/components/projects/project-cover";
import { FloatingCard } from "@/components/motion/floating-card";
import { formatMonthYear } from "@/lib/format";
import type { BlogPostSummary } from "@/lib/data/types";

/** Large lead treatment for the most recent post — magazine cover, not another grid tile. */
export function FeaturedPostCard({ post }: { post: BlogPostSummary }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <FloatingCard tiltStrength={2} className="glass-strong rounded-2xl p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center lg:gap-12">
          <ProjectCover title={post.title} coverImage={post.coverImage} index={0} className="aspect-video lg:aspect-[4/3]" />
          <div>
            <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
              <Sparkles className="size-3 text-primary" /> Latest
            </Badge>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight transition-colors group-hover:text-primary sm:text-4xl">
              {post.title}
            </h2>
            <p className="mt-4 text-pretty text-lg text-muted-foreground">{post.excerpt}</p>
            <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="outline" className="text-xs font-normal">
                {post.category}
              </Badge>
              <span>{formatMonthYear(post.publishedDate)}</span>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" /> {post.readingTimeMinutes} min read
              </span>
            </div>
            <div className="mt-6 flex items-center gap-1 text-sm font-medium text-primary">
              Read article <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
          </div>
        </div>
      </FloatingCard>
    </Link>
  );
}
