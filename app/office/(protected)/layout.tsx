import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { logout } from "@/app/office/actions/auth";
import { OfficeSidebarNav } from "@/components/ai-office/shell/office-sidebar-nav";
import { LimitedProductionOffice } from "@/components/ai-office/shell/limited-production-office";
import { TejaAssistant } from "@/components/ai-office/assistant/teja-assistant";
import { isAiOfficeOperationalModeEnabled } from "@/lib/ai-office/config/operational-mode";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";

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
 * ONE shell, ONE set of pages, for both execution modes — Remote Mode no
 * longer renders a separate "Remote Workspace" UI. Every `(protected)`
 * page now sources its `DatabaseSync` handle from
 * `lib/ai-office/office-db.ts`'s `getOfficeDb()` instead of calling
 * `getAppDatabase()` directly — local mode returns the real local DB
 * unchanged; remote mode hydrates an ephemeral DB from the private
 * runtime repo (the exact mechanism already proven in production). Every
 * existing domain/dashboard function takes a plain `DatabaseSync` and
 * needed no change — only the *source* of that handle differs.
 *
 * `getOfficeDb()`'s own `node:sqlite` usage (ephemeral `:memory:` DBs,
 * both modes) is proven safe on this deployment's actual Vercel runtime
 * — the remote dashboard already rendered real data in production before
 * this change. Earlier revisions of this layout avoided ever rendering
 * `children` in Remote Mode specifically to guard against an
 * *unconfirmed* risk (a Vercel Node runtime below 22.5, where
 * `node:sqlite` doesn't exist at all); that risk is now empirically
 * closed for this specific deployment, so Remote Mode can safely render
 * the same full shell + children as local mode always has.
 *
 * `isAiOfficeOperationalModeEnabled()` and `isRemoteExecutionMode()`
 * together define the ONE case this layout still fully replaces the
 * shell for: neither configured (a production deployment with no
 * durable execution mode enabled at all) falls back to
 * `<LimitedProductionOffice>`, which still returns early before
 * importing anything that reaches `node:sqlite` — that path has no data
 * source to render the real UI against, so there is nothing to unify.
 */
export default async function OfficeProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession();
  if (!session) {
    redirect("/office/login");
  }

  const remoteMode = isRemoteExecutionMode();
  const operationalMode = isAiOfficeOperationalModeEnabled();

  if (!remoteMode && !operationalMode) {
    return <LimitedProductionOffice email={session.userId} signOut={logout} />;
  }

  const { getOfficeDb } = await import("@/lib/ai-office/office-db");
  const [{ getOwner }, { getOfficeStatus }] = await Promise.all([import("@/lib/ai-office/domain/users"), import("@/lib/ai-office/domain/office")]);
  const db = await getOfficeDb();
  // `session.userId` is the verified sign-in email in every mode
  // (production env-direct auth and local DB auth both set the session
  // subject to the same email the owner row uses) — preferred over
  // `getOwner(db)?.email` so the sidebar never shows Remote Mode's
  // synthetic FK-satisfying owner row (see remote-state-store.ts) by
  // mistake; `getOwner` is still called for local-mode parity in case
  // any other local-only surface needs the full row later.
  const owner = getOwner(db);
  const officeStatus = getOfficeStatus(db);
  const ownerEmail = session.userId || owner?.email || "owner";

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <OfficeSidebarNav ownerEmail={ownerEmail} officeState={officeStatus?.state ?? "CLOSED"} signOut={logout} remoteMode={remoteMode} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-[1600px]">{children}</div>
      </main>
      {remoteMode ? null : <TejaAssistant assistantName={process.env.OWNER_ASSISTANT_NAME || "Teja"} />}
    </div>
  );
}
