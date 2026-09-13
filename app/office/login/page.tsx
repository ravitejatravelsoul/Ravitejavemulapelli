import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { Container } from "@/components/common/container";
import { OfficeLoginForm } from "@/components/ai-office/login-form";

export const metadata: Metadata = {
  title: "Owner Sign-In · Teja's AI Office",
  description: "Restricted owner sign-in for Teja's AI Office.",
  robots: { index: false, follow: false },
};

/**
 * Deliberately restrained per docs/ai-office/07-ui-ux-spec.md §3 — this is
 * the one screen in the whole Office that should NOT try to impress. A
 * plain, centered, restricted-access card and nothing else.
 */
export default function OfficeLoginPage() {
  return (
    <Container className="flex min-h-screen max-w-md items-center py-16">
      <GlassCard className="w-full">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
            <ShieldAlert className="size-5" />
          </div>
          <p className="mt-5 font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Teja&apos;s AI Office
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Private Workspace</h1>
          <p className="mt-3 text-pretty text-sm text-muted-foreground">
            Restricted owner access. This workspace is privately operated by Raviteja Vemulapelli.
            No public signup. No guest access.
          </p>
        </div>

        <div className="mt-8">
          <OfficeLoginForm />
        </div>
      </GlassCard>
    </Container>
  );
}
