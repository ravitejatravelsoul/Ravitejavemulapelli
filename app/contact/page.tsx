import type { Metadata } from "next";
import { Mail, MapPin } from "lucide-react";
import { getSiteConfig } from "@/lib/data";
import { JsonLd } from "@/components/common/json-ld";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { Reveal } from "@/components/common/reveal";
import { GlassCard } from "@/components/common/glass-card";
import { ContactForm } from "@/components/contact/contact-form";
import { AnimatedGradient } from "@/components/motion/animated-gradient";
import { FloatingCard } from "@/components/motion/floating-card";
import { GitHubIcon, LinkedInIcon, XIcon } from "@/components/icons/brand-icons";
import { isPlaceholderUrl } from "@/lib/placeholder";
import type { SocialLink } from "@/lib/data/types";

const iconMap: Record<SocialLink["icon"], React.ComponentType<{ className?: string }>> = {
  github: GitHubIcon,
  linkedin: LinkedInIcon,
  twitter: XIcon,
  email: Mail,
};

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Contact",
    description: `Get in touch with ${site.name}.`,
    alternates: { canonical: "/contact" },
  };
}

export default async function ContactPage() {
  const site = await getSiteConfig();
  const socials = site.social.filter((social) => social.icon !== "email");

  return (
    <Section className="relative overflow-hidden pt-20 md:pt-24">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contact",
          url: `${site.seo.url}/contact`,
          mainEntity: {
            "@type": "Person",
            name: site.name,
            email: site.email,
            address: site.location,
          },
        }}
      />
      <AnimatedGradient />
      <div className="grid-pattern grid-fade-mask pointer-events-none absolute inset-0 -z-10" aria-hidden />

      <SectionHeading
        as="h1"
        eager
        eyebrow="Contact"
        title="Let's talk about what you're building"
        description={site.availability}
      />

      <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_20rem]">
        <Reveal eager delay={0.06}>
          <GlassCard className="glass-strong">
            <ContactForm />
          </GlassCard>
        </Reveal>

        <Reveal eager delay={0.12} className="space-y-6">
          <FloatingCard tiltStrength={3}>
            <GlassCard className="transition-colors hover:border-primary/40">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Direct
              </p>
              <a
                href={`mailto:${site.email}`}
                className="mt-3 flex items-center gap-2 text-sm transition-colors hover:text-primary"
              >
                <Mail className="size-4" /> {site.email}
              </a>
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="size-4" /> {site.location}
              </p>

              {socials.length > 0 ? (
                <div className="mt-5 flex items-center gap-2 border-t border-border/60 pt-5">
                  {socials.map((social) => {
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
                        target="_blank"
                        rel="noreferrer"
                        aria-label={social.label}
                        className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary hover:shadow-[0_0_16px_-4px_var(--primary)]"
                      >
                        <Icon className="size-4" />
                      </a>
                    );
                  })}
                </div>
              ) : null}
            </GlassCard>
          </FloatingCard>

          {/* TODO(v2): "Prefer a call?" Cal.com/Calendly booking card — see VERSION2_BACKLOG.md.
              Hidden until a real scheduling link exists; only working contact methods (email, socials) show for now. */}
        </Reveal>
      </div>
    </Section>
  );
}
