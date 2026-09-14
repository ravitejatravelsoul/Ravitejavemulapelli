import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { logout } from "@/app/office/actions/auth";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOwner } from "@/lib/ai-office/domain/users";
import { getOfficeStatus } from "@/lib/ai-office/domain/office";
import { OfficeSidebarNav } from "@/components/ai-office/shell/office-sidebar-nav";
import { LimitedProductionOffice } from "@/components/ai-office/shell/limited-production-office";
import { TejaAssistant } from "@/components/ai-office/assistant/teja-assistant";
import { isAiOfficeOperationalModeEnabled } from "@/lib/ai-office/config/operational-mode";

export const metadata: Metadata = {
  title: {
    default: "Private Workspace · Teja's AI Office",
    template: "%s · Teja's AI Office",
  },
  robots: { index: false, follow: false },
};

/**
 * The real authorization boundary for every route under this group — not
 * `proxy.ts` (that's an optimistic redirect only). Every page inside
 * `(protected)` can assume a valid session exists once it renders, but per
 * docs/ai-office/08-security-plan.md §5, any Server Action or Route
 * Handler reachable from here must still call `verifySession()` itself
 * rather than relying on this check alone.
 *
 * Living AI Office UI transformation — replaces the old single-row header
 * with a persistent sidebar shell (Section 1) shared by every page under
 * this group, so navigation between Office/Projects/Agents/Workspaces/
 * Models/Analytics/Settings never requires re-deriving the same auth/owner
 * lookups on each page.
 *
 * Production-shell boundary (the fix for the post-login Vercel 500): when
 * `isAiOfficeOperationalModeEnabled()` is false, this layout renders
 * *only* `<LimitedProductionOffice>` and returns early — it never calls
 * `getAppDatabase()`/`getOwner()`/`getOfficeStatus()`, never renders
 * `OfficeSidebarNav`/`TejaAssistant`, and critically never renders
 * `children`. Every route under this group (`/office/projects`,
 * `/office/agents`, `/office/workspaces`, ...) shares this one layout, so
 * skipping `children` here is what keeps a production visitor from ever
 * reaching a child page's own SQLite/filesystem-touching Server Component
 * simply by typing its URL — there is no route inside this group that can
 * bypass this check, because there is no route inside this group that
 * renders without first passing through this layout.
 */
export default async function OfficeProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession();
  if (!session) {
    redirect("/office/login");
  }

  if (!isAiOfficeOperationalModeEnabled()) {
    return <LimitedProductionOffice email={session.userId} signOut={logout} />;
  }

  // Reached only when isAiOfficeOperationalModeEnabled() is true (the
  // early return above handles the disabled case) — local dev, tests, or
  // a future durably-hosted production deployment.
  const db = getAppDatabase();
  const owner = getOwner(db);
  const officeStatus = getOfficeStatus(db);

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <OfficeSidebarNav ownerEmail={owner?.email ?? "owner"} officeState={officeStatus?.state ?? "CLOSED"} signOut={logout} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-[1600px]">{children}</div>
      </main>
      <TejaAssistant assistantName={process.env.OWNER_ASSISTANT_NAME || "Teja"} />
    </div>
  );
}
