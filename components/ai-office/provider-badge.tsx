import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Platform-hardening phase, Part 6 — a real owner found the raw provider
 * labels ("SIMULATED", "CLAUDE") technically correct but confusing: it
 * was not obvious that SIMULATED means deterministic test logic with no
 * real AI reasoning at all, as opposed to "a real but currently-idle
 * model." Every place a provider name is shown to the owner should go
 * through this one component so the explanation can never drift out of
 * sync between screens, and so a simulated role can never be mistaken
 * for one that performed real reasoning.
 */

export type DisplayProvider = "simulated" | "ollama" | "claude" | string;

const PROVIDER_EXPLANATIONS: Record<string, string> = {
  simulated: "SIMULATED — deterministic test/development logic. No real reasoning model was called; output is fixed, scripted text used to exercise the platform itself.",
  ollama: "LOCAL AI — a real model running on your own machine via Ollama. Free, private, and genuinely reasons about the task, within that model's own capability.",
  claude: "CLAUDE — a real, paid Anthropic model reasoning about the task over the network. Every call is budget-authorized and tracked as real LIVE spend.",
};

function explanationFor(provider: string): string {
  return PROVIDER_EXPLANATIONS[provider.toLowerCase()] ?? `${provider.toUpperCase()} — a configured AI provider.`;
}

export function ProviderBadge({ provider, model, className }: { provider: DisplayProvider; model?: string | null; className?: string }) {
  const normalized = provider.toLowerCase();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={normalized === "claude" ? "default" : normalized === "simulated" ? "outline" : "secondary"}
          className={cn("cursor-help font-mono text-[0.6rem] uppercase", className)}
        >
          {provider}
          {model ? ` · ${model}` : ""}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{explanationFor(provider)}</TooltipContent>
    </Tooltip>
  );
}
