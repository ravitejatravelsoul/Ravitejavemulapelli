import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { logout } from "@/app/office/actions/auth";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/common/container";

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
 */
export default async function OfficeProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession();
  if (!session) {
    redirect("/office/login");
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-background">
      <header className="border-b border-border/60">
        <Container className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="size-4" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">Teja&apos;s AI Office</p>
              <p className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
                Private Workspace
              </p>
            </div>
          </div>

          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </form>
        </Container>
      </header>

      <Container className="py-12">{children}</Container>
    </div>
  );
}
