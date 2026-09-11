import {
  ClipboardList,
  Code2,
  GitPullRequest,
  Layers,
  PenTool,
  Rocket,
  Search,
  ShieldCheck,
  TestTube2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { FloatingCard } from "@/components/motion/floating-card";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";

interface OfficeRole {
  icon: LucideIcon;
  name: string;
  description: string;
}

/**
 * High-level role gallery only — one line each, no responsibilities,
 * permissions, retry rules, or escalation logic. See
 * docs/ai-office/08-security-plan.md §12 for what stays internal.
 */
const ROLES: OfficeRole[] = [
  { icon: Workflow, name: "Orchestrator", description: "Plans the work and assigns the right specialists." },
  { icon: ClipboardList, name: "Product", description: "Turns an idea into clear requirements." },
  { icon: Search, name: "Research", description: "Investigates feasibility before real work begins." },
  { icon: Layers, name: "Architecture", description: "Designs the system shape and technical approach." },
  { icon: PenTool, name: "UI/UX", description: "Shapes the experience — flows, screens, interaction." },
  { icon: Code2, name: "Engineering", description: "Builds the work to the approved design." },
  { icon: TestTube2, name: "QA", description: "Tests against the plan and flags what fails." },
  { icon: ShieldCheck, name: "Security", description: "Reviews for security-sensitive issues." },
  { icon: GitPullRequest, name: "Code Review", description: "Checks quality and consistency." },
  { icon: Rocket, name: "Release", description: "Packages the work for owner approval." },
];

export function RolesGallery() {
  return (
    <StaggerContainer
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
      stagger={0.06}
    >
      {ROLES.map((role) => {
        const Icon = role.icon;
        return (
          <StaggerItem key={role.name}>
            <FloatingCard tiltStrength={3} className="h-full">
              <GlassCard className="flex h-full flex-col items-start gap-3 p-5 transition-colors hover:border-primary/40">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4.5" />
                </div>
                <div>
                  <p className="text-sm font-medium">{role.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{role.description}</p>
                </div>
              </GlassCard>
            </FloatingCard>
          </StaggerItem>
        );
      })}
    </StaggerContainer>
  );
}
