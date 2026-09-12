"use client";

import { useActionState, useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setModelPolicyAction, type ModelPolicyActionState } from "@/app/office/actions/model-routing";
import type { ModelPolicyMode } from "@/lib/ai-office/domain/model-routing";

const initialState: ModelPolicyActionState = {};

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

export interface ModelPolicyRole {
  id: string;
  name: string;
}

export function ModelPolicyPanel({
  projectId,
  availableModels,
  initialMode,
  initialSingleModel,
  initialCustomMapping,
  roles,
}: {
  projectId: string;
  availableModels: string[];
  initialMode: ModelPolicyMode;
  initialSingleModel: string | null;
  initialCustomMapping: Record<string, string> | null;
  roles: ModelPolicyRole[];
}) {
  const [state, formAction, isPending] = useActionState(setModelPolicyAction.bind(null, projectId), initialState);
  const [mode, setMode] = useState<ModelPolicyMode>(initialMode);

  if (availableModels.length === 0) {
    return <p className="text-xs text-muted-foreground">No local models detected — connect Ollama to configure routing.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="model-policy-mode">Local model policy</Label>
        <select
          id="model-policy-mode"
          name="mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as ModelPolicyMode)}
          className={cn(selectClassName)}
        >
          <option value="AUTO">AUTO — router picks the best known local model per role</option>
          <option value="SINGLE_MODEL">SINGLE MODEL — every role uses one chosen model</option>
          <option value="CUSTOM">CUSTOM — override specific roles</option>
        </select>
      </div>

      {mode === "SINGLE_MODEL" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="single-model">Model</Label>
          <select id="single-model" name="singleModel" defaultValue={initialSingleModel ?? availableModels[0]} className={cn(selectClassName)}>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === "CUSTOM" && (
        <div className="flex flex-col gap-2">
          <Label>Role overrides (leave &ldquo;Auto&rdquo; to fall back to the default routing)</Label>
          {roles.map((role) => (
            <div key={role.id} className="grid grid-cols-2 items-center gap-2">
              <span className="text-xs text-muted-foreground">{role.name}</span>
              <select name={`role:${role.id}`} defaultValue={initialCustomMapping?.[role.id] ?? ""} className={cn(selectClassName)}>
                <option value="">Auto</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state.success && <p className="text-xs text-muted-foreground">Saved.</p>}

      <Button type="submit" size="sm" variant="outline" disabled={isPending} className="w-fit">
        {isPending ? "Saving..." : "Save routing policy"}
      </Button>
    </form>
  );
}
