import type { Metadata } from "next";
import { getCertifications, getSiteConfig } from "@/lib/data";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { CertificationsExplorer } from "@/components/certifications/certifications-explorer";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  return {
    title: "Certifications",
    description: `Certifications earned by ${site.name}.`,
    alternates: { canonical: "/certifications" },
  };
}

export default async function CertificationsPage() {
  const certifications = await getCertifications();

  return (
    <Section className="pt-20 md:pt-24">
      <SectionHeading
        as="h1"
        eager
        eyebrow="Credentials"
        title="Certifications"
        description="Formal credentials backing the hands-on experience."
      />

      <div className="mt-14">
        <CertificationsExplorer certifications={certifications} />
      </div>
    </Section>
  );
}
