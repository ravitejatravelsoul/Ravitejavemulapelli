import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { SectionDivider } from "@/components/motion/section-divider";
import { Reveal } from "@/components/common/reveal";
import { Button } from "@/components/ui/button";
import { MagneticButton } from "@/components/motion/magnetic-button";
import { AiOfficeHero } from "@/components/ai-office/hero";
import { RolesGallery } from "@/components/ai-office/roles-gallery";
import { WorkflowStepper } from "@/components/ai-office/workflow-stepper";
import { ArchitectureOverview } from "@/components/ai-office/architecture-overview";
import { OwnershipBanner } from "@/components/ai-office/ownership-banner";

export const metadata: Metadata = {
  title: "Teja's AI Office",
  description:
    "Teja's AI Office is a private, autonomous AI engineering workspace created and operated by Raviteja Vemulapelli — a coordinated team of specialized AI agents that researches, plans, builds, tests, and reviews software ideas before owner approval.",
  alternates: { canonical: "/ai-office" },
  openGraph: {
    title: "Teja's AI Office",
    description: "A private, autonomous AI engineering headquarters — owner-operated by Raviteja Vemulapelli.",
  },
};

export default function AiOfficePage() {
  return (
    <>
      <AiOfficeHero />

      <Section className="pt-0">
        <SectionHeading
          eyebrow="What It Is"
          title="An engineering team that never clocks out — built for one owner."
          align="center"
          className="mx-auto"
        />
        <Reveal delay={0.1} className="mx-auto mt-8 max-w-2xl space-y-4 text-center">
          <p className="text-pretty text-muted-foreground">
            Raviteja can hand the office a single idea — sometimes just one sentence — and a
            coordinated team of specialized AI agents takes it from concept to a reviewed, tested
            project ready for his final approval.
          </p>
          <p className="text-pretty text-muted-foreground">
            Not every idea needs every specialist. The office decides how much of the team a given
            idea actually requires, then keeps every meaningful decision in front of its owner
            before anything moves forward.
          </p>
        </Reveal>
      </Section>

      <Section className="border-t border-border/60">
        <SectionHeading
          eyebrow="The Office"
          title="Specialized roles, assigned only when needed."
          description="Each role has a narrow, well-defined job — the office decides which of them a given idea actually requires."
          align="center"
          className="mx-auto"
        />
        <div className="mt-12">
          <RolesGallery />
        </div>
      </Section>

      <SectionDivider className="my-4" />

      <Section className="border-t border-border/60">
        <SectionHeading
          eyebrow="How It Works"
          title="From a single idea to owner approval."
          align="center"
          className="mx-auto"
        />
        <div className="mt-14 overflow-x-auto">
          <WorkflowStepper />
        </div>
      </Section>

      <Section className="border-t border-border/60">
        <SectionHeading
          eyebrow="Under the Hood"
          title="A high-level look at the system."
          description="Conceptual only — the operational details are kept private, the same as the rest of the workspace."
          align="center"
          className="mx-auto"
        />
        <div className="mt-12">
          <ArchitectureOverview />
        </div>
      </Section>

      <Section className="border-t border-border/60">
        <Reveal>
          <OwnershipBanner />
        </Reveal>
      </Section>

      <Section className="relative overflow-hidden border-t border-border/60 text-center">
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-primary uppercase">Ready when you are</p>
          <p className="mx-auto mt-5 max-w-xl text-balance text-2xl leading-snug font-medium tracking-tight sm:text-3xl">
            The office is private — but you now know what it does.
          </p>
          <MagneticButton className="mt-8 inline-block">
            <Button asChild size="lg" className="gradient-cta h-12 rounded-xl border-0 px-7 text-base">
              <Link href="/office">
                Enter AI Office <ArrowRight className="size-4" />
              </Link>
            </Button>
          </MagneticButton>
        </Reveal>
      </Section>
    </>
  );
}
