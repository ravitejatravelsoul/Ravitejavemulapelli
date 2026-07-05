"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PostCard } from "@/components/blog/post-card";
import type { BlogPostSummary } from "@/lib/data/types";

const ALL = "All";

export function BlogExplorer({ posts }: { posts: BlogPostSummary[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const shouldReduceMotion = useReducedMotion();

  const categories = useMemo(
    () => [ALL, ...Array.from(new Set(posts.map((post) => post.category))).sort()],
    [posts],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((post) => {
      const matchesCategory = category === ALL || post.category === category;
      const matchesQuery =
        q.length === 0 ||
        post.title.toLowerCase().includes(q) ||
        post.excerpt.toLowerCase().includes(q) ||
        post.tags.some((tag) => tag.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
  }, [posts, query, category]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts..."
            className="pl-9"
            aria-label="Search posts"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <Badge
                variant={category === cat ? "default" : "outline"}
                className="cursor-pointer px-3 py-1 text-xs font-normal transition-transform hover:scale-105"
              >
                {cat}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-16 text-sm text-muted-foreground">No posts match your search.</p>
      ) : (
        <motion.div
          layout={!shouldReduceMotion} suppressHydrationWarning
          className="mt-14 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((post, index) => (
              <motion.div
                key={post.slug}
                layout={!shouldReduceMotion} suppressHydrationWarning
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <PostCard post={post} index={index} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
