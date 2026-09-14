import Link from "next/link";
import { LogOut } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The entire authenticated production experience when
 * `isAiOfficeOperationalModeEnabled()` is false (every real Vercel
 * deployment today — see lib/ai-office/config/operational-mode.ts).
 *
 * Deliberately self-contained: no prop or import here reads from SQLite,
 * the workspace filesystem, the runner, or any local-only service — see
 * app/office/(protected)/layout.tsx, which renders *only* this component
 * (never `children`, never `OfficeSidebarNav`/`TejaAssistant`) for every
 * route under the protected group once operational mode is disabled, so
 * that no local-only dependency can ever be reached by a production
 * request, no matter which URL under /office it was for.
 *
 * `email` comes straight from the verified session payload
 * (`session.userId`, which is the signed-in owner's email — see
 * app/office/actions/auth.ts's `login`) — never an `owner` row looked up
 * from the database.
 */
export function LimitedProductionOffice({ email, signOut }: { email: string; signOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <GlassCard className="w-full max-w-lg !p-6 sm:!p-8">
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Teja&apos;s AI Office</p>
            <h1 className="mt-1 text-xl font-semibold">Private Workspace</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive" className="font-mono text-xs uppercase">
              Local-only · production operations disabled
            </Badge>
            <Badge variant="outline" className="font-mono text-xs uppercase">
              Limited production
            </Badge>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="truncate text-sm font-medium">{email}</p>
          </div>

          <p className="text-sm text-muted-foreground">
            Authentication is active and secure. The operational AI Office is intentionally available only from the local workspace in V1.
            Projects, agents, execution, approvals, budgets, workspaces and paid AI actions are disabled on this production deployment.
          </p>

          <div className="flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:flex-wrap">
            <Button asChild variant="outline" size="sm">
              <Link href="/">Return to Portfolio</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/ai-office">View AI Office Showcase</Link>
            </Button>
            <form action={signOut} className="sm:ml-auto">
              <Button type="submit" variant="ghost" size="sm" className="w-full justify-center gap-2 sm:w-auto">
                <LogOut className="size-3.5" />
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
