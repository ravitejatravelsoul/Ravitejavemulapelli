"use client";

import { useMemo, useState } from "react";
import { Award, Download, ExternalLink, Search } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/common/glass-card";
import { FloatingCard } from "@/components/motion/floating-card";
import { formatMonthYear } from "@/lib/format";
import { isPlaceholder } from "@/lib/placeholder";
import type { Certification } from "@/lib/data/types";

const ALL = "All";

export function CertificationsExplorer({ certifications }: { certifications: Certification[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const shouldReduceMotion = useReducedMotion();

  const categories = useMemo(
    () => [ALL, ...Array.from(new Set(certifications.map((c) => c.category))).sort()],
    [certifications],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return certifications.filter((cert) => {
      const matchesCategory = category === ALL || cert.category === category;
      const matchesQuery =
        q.length === 0 ||
        cert.name.toLowerCase().includes(q) ||
        cert.issuer.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [certifications, query, category]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search certifications..."
            className="pl-9"
            aria-label="Search certifications"
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

      <motion.div layout={!shouldReduceMotion} suppressHydrationWarning className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <AnimatePresence mode="popLayout">
          {filtered.map((cert) => (
            <motion.div
              key={cert.id}
              layout={!shouldReduceMotion} suppressHydrationWarning
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <FloatingCard tiltStrength={3}>
                <GlassCard className="group flex h-full flex-col transition-colors hover:border-primary/40">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-shadow duration-300 group-hover:shadow-[0_0_24px_-4px_var(--primary)]">
                      <Award className="size-5" />
                    </span>
                    <Badge variant="outline" className="text-xs font-normal">
                      {cert.category}
                    </Badge>
                  </div>
                  <h3 className="mt-4 font-medium">{cert.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{cert.issuer}</p>
                  {!isPlaceholder(cert.issueDate) || cert.expiryDate || cert.credentialId ? (
                    <p className="mt-3 font-mono text-xs text-muted-foreground">
                      {!isPlaceholder(cert.issueDate) ? `Issued ${formatMonthYear(cert.issueDate)}` : null}
                      {cert.expiryDate ? ` · Expires ${formatMonthYear(cert.expiryDate)}` : ""}
                      {cert.credentialId ? ` · ID: ${cert.credentialId}` : ""}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    {cert.credentialUrl ? (
                      <a
                        href={cert.credentialUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ExternalLink className="size-3.5" /> Verify
                      </a>
                    ) : null}
                    {cert.downloadUrl ? (
                      <a
                        href={cert.downloadUrl}
                        download
                        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Download className="size-3.5" /> Certificate
                      </a>
                    ) : null}
                  </div>
                </GlassCard>
              </FloatingCard>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {filtered.length === 0 ? (
        <p className="mt-16 text-sm text-muted-foreground">No certifications match your search.</p>
      ) : null}
    </div>
  );
}
