"use client";

import { useActionState, useState, useTransition } from "react";
import { GlassCard } from "@/components/common/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createProjectAction, type CreateProjectState } from "@/app/office/actions/projects";
import { checkOllamaHealthAction } from "@/app/office/actions/ollama";
import { checkClaudeHealthAction } from "@/app/office/actions/claude";
import type { OllamaHealth } from "@/lib/ai-office/providers/ollama/health";

const initialState: CreateProjectState = {};

type Provider = "simulated" | "ollama";
type AiPolicyMode = "LOCAL_ONLY" | "HYBRID" | "CLAUDE_ONLY";

export function NewProjectForm() {
  const [state, formAction, isPending] = useActionState(createProjectAction, initialState);
  const [provider, setProvider] = useState<Provider>("simulated");
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [checking, startChecking] = useTransition();
  const [aiPolicyMode, setAiPolicyMode] = useState<AiPolicyMode>("LOCAL_ONLY");
  const [claudeConfigured, setClaudeConfigured] = useState<boolean | null>(null);
  const [checkingClaude, startCheckingClaude] = useTransition();

  function selectProvider(next: Provider) {
    setProvider(next);
    if (next === "ollama" && !health && !checking) {
      startChecking(async () => {
        setHealth(await checkOllamaHealthAction());
      });
    }
  }

  function selectAiPolicyMode(next: AiPolicyMode) {
    setAiPolicyMode(next);
    if (next !== "LOCAL_ONLY" && claudeConfigured === null && !checkingClaude) {
      // Read-only status check — never a billable call (Part 20).
      startCheckingClaude(async () => {
        setClaudeConfigured((await checkClaudeHealthAction()).configured);
      });
    }
  }

  return (
    <GlassCard className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold tracking-tight">Start New Project</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Describe the idea — the Orchestrator plans the task graph automatically. No AI is called during planning either way.
      </p>

      <form action={formAction} className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Project name</Label>
          <Input id="title" name="title" placeholder="Screenshot Test Report Tool" maxLength={120} required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ideaText">Idea</Label>
          <Textarea
            id="ideaText"
            name="ideaText"
            rows={5}
            placeholder="Build a small web tool where manual testers capture screenshots and generate a test report."
            maxLength={4000}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>AI Provider</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => selectProvider("simulated")}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                provider === "simulated" ? "border-primary bg-primary/5 font-medium" : "border-border text-muted-foreground hover:border-primary/40",
              )}
            >
              Simulation
              <p className="text-xs font-normal text-muted-foreground">Deterministic fixtures · $0 · no LLM</p>
            </button>
            <button
              type="button"
              onClick={() => selectProvider("ollama")}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                provider === "ollama" ? "border-accent-2 bg-accent-2/5 font-medium" : "border-border text-muted-foreground hover:border-accent-2/40",
              )}
            >
              Ollama Local
              <p className="text-xs font-normal text-muted-foreground">Real local LLM · $0 API cost</p>
            </button>
          </div>
          <input type="hidden" name="provider" value={provider} />

          {provider === "ollama" && (
            <p className="mt-1 font-mono text-[0.7rem] tracking-wide uppercase">
              {checking && <span className="text-muted-foreground">Checking Ollama…</span>}
              {!checking && health && health.online && (
                <span className="text-accent-2">
                  {health.models.length > 0
                    ? `Ollama online · installed: ${health.models.join(", ")} — routed automatically per role`
                    : "Ollama online · no models installed"}
                </span>
              )}
              {!checking && health && !health.online && <span className="text-destructive">Ollama offline — start it before running this project</span>}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>AI Policy</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            {(
              [
                { value: "LOCAL_ONLY" as const, label: "Local Only", desc: "Every role runs on local/simulated models. Never spends money." },
                { value: "HYBRID" as const, label: "Hybrid", desc: "Local where qualified; Claude only for capabilities with no qualified local model, after your approval." },
                { value: "CLAUDE_ONLY" as const, label: "Claude Only", desc: "Every role routes to Claude. Requires your approval and real spend." },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => selectAiPolicyMode(opt.value)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  aiPolicyMode === opt.value ? "border-primary bg-primary/5 font-medium" : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {opt.label}
                <p className="text-xs font-normal text-muted-foreground">{opt.desc}</p>
              </button>
            ))}
          </div>
          <input type="hidden" name="aiPolicyMode" value={aiPolicyMode} />

          {aiPolicyMode !== "LOCAL_ONLY" && (
            <p className="mt-1 font-mono text-[0.7rem] tracking-wide uppercase">
              {checkingClaude && <span className="text-muted-foreground">Checking Claude configuration…</span>}
              {!checkingClaude && claudeConfigured === true && (
                <span className="text-accent-2">Claude configured · project LIVE budget will be capped at $3.00 · owner approval required before any spend</span>
              )}
              {!checkingClaude && claudeConfigured === false && (
                <span className="text-destructive">
                  Claude is NOT configured on this server — this project can be created, but any Claude-routed role will show a clean blocked state
                  until an administrator sets the required credentials.
                </span>
              )}
            </p>
          )}
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        <Button type="submit" disabled={isPending} className="self-start">
          {isPending ? "Planning…" : "Create Project"}
        </Button>
      </form>
    </GlassCard>
  );
}
