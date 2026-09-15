"use client";

import { useActionState } from "react";
import { GlassCard } from "@/components/common/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createRemoteProjectAction, type CreateRemoteProjectState } from "@/app/office/actions/remote-projects";

const initialState: CreateRemoteProjectState = {};

/** Deliberately simpler than the local NewProjectForm — no provider/policy toggles yet (Remote Mode V1 is SIMULATED-only, see remote-projects.ts's docblock). */
export function RemoteNewProjectForm() {
  const [state, formAction, isPending] = useActionState(createRemoteProjectAction, initialState);

  if (state.projectId) {
    return (
      <GlassCard className="p-4">
        <p className="text-sm font-medium">Project queued.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A background worker has been dispatched. You can close this tab — refresh this page later to see progress.
        </p>
        <a href={`/office?project=${state.projectId}`} className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          View project →
        </a>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4">
      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="remote-title">Project name</Label>
          <Input id="remote-title" name="title" required maxLength={120} placeholder="Hello Remote Office" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="remote-idea">Idea</Label>
          <Textarea id="remote-idea" name="ideaText" required rows={3} maxLength={4000} placeholder="Describe what to build..." />
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={isPending} className="self-start">
          {isPending ? "Starting…" : "Start in background"}
        </Button>
      </form>
    </GlassCard>
  );
}
