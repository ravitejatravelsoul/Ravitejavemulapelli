"use client";

import { useActionState } from "react";
import { GlassCard } from "@/components/common/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProjectAction, type CreateProjectState } from "@/app/office/actions/projects";

const initialState: CreateProjectState = {};

export function NewProjectForm() {
  const [state, formAction, isPending] = useActionState(createProjectAction, initialState);

  return (
    <GlassCard className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold tracking-tight">Start New Project</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Describe the idea — the Orchestrator plans the task graph automatically, in SIMULATED mode, at $0. No AI is called.
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

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        <Button type="submit" disabled={isPending} className="self-start">
          {isPending ? "Planning…" : "Create Project"}
        </Button>
      </form>
    </GlassCard>
  );
}
