import { Badge } from "@/components/ui/badge"
import type { PreviewStatusLabel } from "@/lib/ai-office/dashboard/delivery-status"

const STATUS_VARIANT: Record<PreviewStatusLabel, "default" | "secondary" | "outline" | "destructive"> = {
  "PREVIEW READY": "default",
  "BUILD FAILED": "destructive",
  "NOT RUNNABLE": "outline",
  VERIFYING: "secondary",
}

/**
 * Owner-facing preview — deliberately a sandboxed `<iframe>` with only
 * `allow-scripts` (no `allow-same-origin`), so the browser treats the
 * generated page as an opaque, cookie-isolated origin even though it's
 * served same-origin through app/office/preview/[projectId]/[...path].
 * See that route's own comment for the full rationale.
 */
export function PreviewPanel({ projectId, status, previewToken }: { projectId: string; status: PreviewStatusLabel; previewToken: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
      </div>
      {status === "PREVIEW READY" && previewToken ? (
        <div className="overflow-hidden rounded-lg border border-border/40">
          <iframe
            src={`/office/preview/${projectId}/index.html?token=${encodeURIComponent(previewToken)}`}
            sandbox="allow-scripts"
            className="h-[420px] w-full bg-white"
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
  )
}
