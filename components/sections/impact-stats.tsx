import { getProjects, getSiteConfig, getSkillGroups } from "@/lib/data";
import { Section } from "@/components/common/section";
import { Reveal } from "@/components/common/reveal";
import { AnimatedCounter } from "@/components/common/animated-counter";

export async function ImpactStats() {
  const [site, projects, skillGroups] = await Promise.all([
    getSiteConfig(),
    getProjects(),
    getSkillGroups(),
  ]);

  const skillCount = skillGroups.reduce((total, group) => total + group.skills.length, 0);

  const stats: { label: string; value: number; suffix?: string }[] = [
    ...(site.yearsExperience > 0
      ? [{ label: "Years building software", value: site.yearsExperience, suffix: "+" }]
      : []),
    { label: "Products shipped end to end", value: projects.length },
    { label: "Skill areas across the stack", value: skillCount, suffix: "+" },
    { label: "Domains covered", value: skillGroups.length },
  ];

  return (
    <Section className="border-b border-border/60">
      <div className="grid grid-cols-2 gap-x-8 gap-y-12 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <Reveal key={stat.label} delay={index * 0.06}>
            <p className="font-mono text-4xl font-semibold tracking-tight sm:text-5xl">
              <AnimatedCounter value={stat.value} suffix={stat.suffix} />
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
