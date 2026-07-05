import {
  BrainCircuit,
  Cloud,
  Code2,
  FlaskConical,
  GitBranch,
  LayoutTemplate,
  Layers,
  Monitor,
  Server,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/** Maps skill-group ids (content/data/skills.json) to a representative icon. */
export const skillGroupIcon: Record<string, LucideIcon> = {
  languages: Code2,
  frontend: Monitor,
  backend: Server,
  cloud: Cloud,
  automation: Workflow,
  ai: BrainCircuit,
  testing: FlaskConical,
  devops: GitBranch,
  architecture: Layers,
  "enterprise-cms": LayoutTemplate,
  leadership: Users,
};
