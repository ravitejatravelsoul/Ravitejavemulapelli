import Link from "next/link";
import { ArrowUpRight, Mail, MapPin } from "lucide-react";
import { getSiteConfig } from "@/lib/data";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { Button } from "@/components/ui/button";
import { GradientText } from "@/components/common/gradient-text";
import { AnimatedGradient } from "@/components/motion/animated-gradient";
import { MagneticButton } from "@/components/motion/magnetic-button";
import { ResumeDownloadButton } from "@/components/resume/resume-download-button";
import { GitHubIcon, LinkedInIcon, XIcon } from "@/components/icons/brand-icons";
import { isPlaceholderUrl } from "@/lib/placeholder";
import type { SocialLink } from "@/lib/data/types";

const iconMap: Record<SocialLink["icon"], React.ElementType> = {
  github: GitHubIcon,
  linkedin: LinkedInIcon,
  twitter: XIcon,
  email: Mail,
};

const sitemap = [
  {
    label: "Career",
    links: [
      { label: "About", href: "/about" },
      { label: "Experience", href: "/experience" },
      { label: "Skills", href: "/skills" },
      { label: "Achievements", href: "/achievements" },
      { label: "Certifications", href: "/certifications" },
      { label: "Resume", href: "/resume" },
    ],
  },
  {
    label: "Work",
    links: [
      { label: "Projects", href: "/projects" },
      { label: "Writing", href: "/blog" },
      { label: "Travel", href: "/travel" },
    ],
  },
];

export async function Footer() {
  const site = await getSiteConfig();
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden border-t border-border/70">
      <AnimatedGradient className="opacity-50" />
      <div className="grid-pattern grid-fade-mask pointer-events-none absolute inset-0 -z-10" aria-hidden />

      <Container className="relative py-20">
        <Reveal className="text-center">
          <p className="text-sm font-medium tracking-wide text-primary uppercase">
            {site.availability}
          </p>
          <h2 className="mx-auto mt-4 max-w-xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Let&apos;s build something <GradientText>meaningful</GradientText>.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <MagneticButton>
              <Button asChild size="lg" className="gradient-cta h-12 rounded-xl border-0 px-7 text-base">
                <Link href="/contact">
                  Get in touch <ArrowUpRight className="size-4" />
                </Link>
              </Button>
            </MagneticButton>
            <ResumeDownloadButton
              label="Resume"
              variant="outline"
              className="h-12 rounded-xl px-7 text-base"
            />
          </div>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 gap-12 border-t border-border/70 pt-16 lg:grid-cols-[1.3fr_1fr_1fr]">
          <div className="max-w-sm">
            <p className="font-mono text-sm font-medium">{site.name}</p>
            <p className="mt-3 text-sm text-muted-foreground">{site.tagline}</p>
            <div className="mt-5 space-y-2 text-sm text-muted-foreground">
              <a
                href={`mailto:${site.email}`}
                className="flex items-center gap-2 transition-colors hover:text-foreground"
              >
                <Mail className="size-3.5" /> {site.email}
              </a>
              <p className="flex items-center gap-2">
                <MapPin className="size-3.5" /> {site.location}
              </p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              {site.social.map((social) => {
                const Icon = iconMap[social.icon];
                if (isPlaceholderUrl(social.url)) {
                  return (
                    <span
                      key={social.label}
                      aria-hidden
                      title={`${social.label} — coming soon`}
                      className="flex size-9 cursor-not-allowed items-center justify-center rounded-full border border-dashed border-border/70 text-muted-foreground/40"
                    >
                      <Icon className="size-4" />
                    </span>
                  );
                }
                return (
                  <a
                    key={social.label}
                    href={social.url}
                    target={social.icon === "email" ? undefined : "_blank"}
                    rel={social.icon === "email" ? undefined : "noreferrer"}
                    aria-label={social.label}
                    className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    <Icon className="size-4" />
                  </a>
                );
              })}
            </div>
          </div>

          {sitemap.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-2 border-t border-border/70 pt-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {year} {site.name}. All rights reserved.
          </p>
          <p>{site.availability}</p>
        </div>
      </Container>
    </footer>
  );
}
