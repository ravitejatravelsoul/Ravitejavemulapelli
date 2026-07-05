import { BrainCircuit, Smartphone, Workflow } from "lucide-react";
import { Section } from "@/components/common/section";
import { SectionHeading } from "@/components/common/section-heading";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import { FloatingCard } from "@/components/motion/floating-card";
import { GlassCard } from "@/components/common/glass-card";

const FOCUS_AREAS = [
  {
    icon: Workflow,
    title: "Automation Platforms",
    description:
      "Shared tooling that becomes the default way teams test and ship — not another script nobody maintains after I move on.",
  },
  {
    icon: BrainCircuit,
    title: "AI-Powered Tools",
    description:
      "AI applied to real engineering questions — grounded in real data, honest about its limits, and faster than digging through logs.",
  },
  {
    icon: Smartphone,
    title: "Mobile & Web Products",
    description:
      "Consumer products shipped end to end, from idea to a production release on iOS and Android.",
  },
];

export function WhatIBuild() {
  return (
    <Section>
      <SectionHeading
        eyebrow="What I Build"
        title="Three kinds of problems I keep coming back to"
        description="Different surfaces, same instinct: find the slow or manual part, and build something that removes it for good."
      />

      <StaggerContainer className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {FOCUS_AREAS.map((area) => (
          <StaggerItem key={area.title}>
            <FloatingCard tiltStrength={4} className="h-full">
              <GlassCard className="h-full transition-colors hover:border-primary/40">
                <span className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <area.icon className="size-5" />
                </span>
                <h3 className="mt-5 text-lg font-medium">{area.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {area.description}
                </p>
              </GlassCard>
            </FloatingCard>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </Section>
  );
}
