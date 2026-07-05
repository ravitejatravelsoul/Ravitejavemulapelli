import Link from "next/link";
import { ArrowUpRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProjectCover } from "@/components/projects/project-cover";
import { FloatingCard } from "@/components/motion/floating-card";
import { formatMonthYear } from "@/lib/format";
import type { BlogPostSummary } from "@/lib/data/types";

export function PostCard({ post, index = 0 }: { post: BlogPostSummary; index?: number }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <FloatingCard className="rounded-xl">
        <ProjectCover title={post.title} coverImage={post.coverImage} index={index} />
      </FloatingCard>
      <div className="mt-5">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-xs font-normal">
            {post.category}
          </Badge>
          <span>{formatMonthYear(post.publishedDate)}</span>
          <span className="flex items-center gap-1">
            <Clock className="size-3" /> {post.readingTimeMinutes} min read
          </span>
        </div>
        <h3 className="mt-3 text-xl font-medium tracking-tight transition-colors group-hover:text-primary">
          {post.title}
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{post.excerpt}</p>

        {post.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {post.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs text-muted-foreground/90">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          Read article <ArrowUpRight className="size-3" />
        </div>
      </div>
    </Link>
  );
}
