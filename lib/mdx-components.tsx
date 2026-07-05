import Link from "next/link";
import type { MDXComponents } from "mdx/types";

/**
 * Shared MDX -> HTML element styling for both /blog and /projects long-form
 * content. Manual overrides instead of @tailwindcss/typography to keep the
 * type scale and spacing consistent with the rest of the design system.
 */
export const mdxComponents: MDXComponents = {
  h2: (props) => (
    <h2
      className="mt-14 scroll-mt-28 text-2xl font-semibold tracking-tight first:mt-0 sm:text-3xl"
      {...props}
    />
  ),
  h3: (props) => (
    <h3 className="mt-10 scroll-mt-28 text-xl font-medium tracking-tight" {...props} />
  ),
  p: (props) => <p className="mt-5 leading-relaxed text-muted-foreground" {...props} />,
  ul: (props) => (
    <ul className="mt-5 list-disc space-y-2 pl-6 text-muted-foreground marker:text-primary" {...props} />
  ),
  ol: (props) => (
    <ol className="mt-5 list-decimal space-y-2 pl-6 text-muted-foreground marker:text-primary" {...props} />
  ),
  li: (props) => <li className="leading-relaxed" {...props} />,
  a: ({ href, ...props }) => (
    <Link
      href={href ?? "#"}
      className="text-foreground underline decoration-primary/50 underline-offset-4 transition-colors hover:decoration-primary"
      {...props}
    />
  ),
  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="mt-6 border-l-2 border-primary pl-5 text-foreground/90 italic"
      {...props}
    />
  ),
  code: (props) => (
    <code
      className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="mt-6 overflow-x-auto rounded-xl border border-border bg-secondary/40 p-4 text-sm leading-relaxed"
      {...props}
    />
  ),
  hr: (props) => <hr className="my-10 border-border/70" {...props} />,
};
