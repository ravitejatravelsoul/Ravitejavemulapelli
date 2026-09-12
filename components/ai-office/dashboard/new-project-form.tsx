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
import type { OllamaHealth } from "@/lib/ai-office/providers/ollama/health";

const initialState: CreateProjectState = {};

type Provider = "simulated" | "ollama";

export function NewProjectForm() {
  const [state, formAction, isPending] = useActionState(createProjectAction, initialState);
  const [provider, setProvider] = useState<Provider>("simulated");
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [checking, startChecking] = useTransition();

  function selectProvider(next: Provider) {
    setProvider(next);
    if (next === "ollama" && !health && !checking) {
      startChecking(async () => {
        setHealth(await checkOllamaHealthAction());
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
                  Ollama online{health.models[0] ? ` · ${health.models[0]}` : ""}
                </span>
              )}
              {!checking && health && !health.online && <span className="text-destructive">Ollama offline — start it before running this project</span>}
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
