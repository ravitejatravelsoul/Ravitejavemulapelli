"use client";

import { useState } from "react";
import { RotateCw, ExternalLink, Monitor, Tablet, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PreviewStatusLabel } from "@/lib/ai-office/dashboard/delivery-status";

const STATUS_VARIANT: Record<PreviewStatusLabel, "default" | "secondary" | "outline" | "destructive"> = {
  "PREVIEW READY": "default",
  "BUILD FAILED": "destructive",
  "NOT RUNNABLE": "outline",
  VERIFYING: "secondary",
};

const DEVICE_WIDTHS = { Desktop: "100%", Tablet: "768px", Mobile: "390px" } as const;
type DeviceMode = keyof typeof DEVICE_WIDTHS;

/**
 * Owner-facing preview (Section 19/20) — deliberately a sandboxed
 * `<iframe>` with only `allow-scripts` (no `allow-same-origin`), so the
 * browser treats the generated page as an opaque, cookie-isolated origin
 * even though it's served same-origin through
 * app/office/preview/[projectId]/[...path]. Device-mode buttons only
 * resize the iframe's own container — they never pretend to be a real
 * device or touch the sandbox attributes.
 */
export function PreviewPanel({ projectId, status, previewToken }: { projectId: string; status: PreviewStatusLabel; previewToken: string | null }) {
  const [device, setDevice] = useState<DeviceMode>("Desktop");
  const [reloadKey, setReloadKey] = useState(0);
  const previewUrl = previewToken ? `/office/preview/${projectId}/index.html?token=${encodeURIComponent(previewToken)}` : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[status]}>{status === "PREVIEW READY" ? "FINAL PRODUCT · VERIFIED" : status}</Badge>

        {status === "PREVIEW READY" && previewUrl && (
          <div className="ml-auto flex items-center gap-1">
            {(Object.keys(DEVICE_WIDTHS) as DeviceMode[]).map((mode) => {
              const Icon = mode === "Desktop" ? Monitor : mode === "Tablet" ? Tablet : Smartphone;
              return (
                <Button
                  key={mode}
                  type="button"
                  variant={device === mode ? "default" : "outline"}
                  size="icon"
                  aria-label={`${mode} preview width`}
                  aria-pressed={device === mode}
                  onClick={() => setDevice(mode)}
                >
                  <Icon className="size-3.5" />
                </Button>
              );
            })}
            <Button type="button" variant="outline" size="icon" aria-label="Refresh preview" onClick={() => setReloadKey((k) => k + 1)}>
              <RotateCw className="size-3.5" />
            </Button>
            <Button asChild variant="outline" size="icon" aria-label="Open preview in a new tab">
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
        )}
      </div>

      {status === "PREVIEW READY" && previewUrl ? (
        <div className="flex justify-center overflow-hidden rounded-lg border border-border/40 bg-muted/30 p-2">
          <iframe
            key={reloadKey}
            src={previewUrl}
            sandbox="allow-scripts"
            className={cn("h-[420px] bg-white transition-[width]", device !== "Desktop" && "rounded-md border border-border shadow-sm")}
            style={{ width: DEVICE_WIDTHS[device], maxWidth: "100%" }}
            title="Project preview"
          />
        </div>
      ) : status === "PREVIEW READY" ? (
        <p className="text-sm text-muted-foreground">Preview token could not be created — check that OFFICE_SESSION_SECRET is configured.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {status === "BUILD FAILED" && "The real deliverable's last verification failed — nothing to preview yet."}
          {status === "VERIFYING" && "A build or verification is in progress — check back shortly."}
          {status === "NOT RUNNABLE" && "No verified real deliverable exists yet for this project."}
        </p>
      )}
    </div>
  );
}
