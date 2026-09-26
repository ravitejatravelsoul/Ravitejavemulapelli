"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutGrid, FolderKanban, Users, FolderOpen, Cpu, BarChart3, Settings, Menu, LogOut, ShieldCheck, Wrench, MessageCircle, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The AI Office's primary navigation — one definition shared by the
 * persistent desktop sidebar and the mobile drawer, so the two can never
 * drift out of sync. Every route already exists or is added in this same
 * phase; nothing here is a placeholder link to a page that doesn't exist.
 */
const NAV_ITEMS = [
  { href: "/office", label: "Headquarters", icon: LayoutGrid },
  { href: "/office/projects", label: "Projects", icon: FolderKanban },
  { href: "/office/agents", label: "Agents", icon: Users },
  { href: "/office/workspaces", label: "Workspaces", icon: FolderOpen },
  { href: "/office/local-models", label: "Models", icon: Cpu },
  { href: "/office/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/office/engineer", label: "Engineer", icon: Wrench },
  { href: "/office/communications", label: "Communications", icon: MessageCircle, History },
  { href: "/office/settings", label: "Settings", icon: Settings },
  { href: "/office/classic", label: "Classic Office", icon: History },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/office") return pathname === "/office";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="AI Office">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ remoteMode }: { remoteMode: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ShieldCheck className="size-4" />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold tracking-tight">Teja&apos;s AI Office</p>
        <div className="flex items-center gap-1.5">
          <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">Private Workspace</p>
          <Badge variant={remoteMode ? "default" : "outline"} className="font-mono text-[0.55rem] tracking-widest uppercase">
            {remoteMode ? "Remote" : "Local"}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function OwnerFooter({ ownerEmail, officeState, signOut }: { ownerEmail: string; officeState: "OPEN" | "CLOSED"; signOut: () => void }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="truncate text-xs text-muted-foreground">{ownerEmail}</span>
        <Badge variant={officeState === "OPEN" ? "default" : "outline"} className="font-mono text-[0.6rem] uppercase">
          {officeState}
        </Badge>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="outline" size="sm" className="w-full justify-start gap-2">
          <LogOut className="size-3.5" />
          Sign out
        </Button>
      </form>
    </div>
  );
}

/**
 * Desktop: a persistent, compact sidebar (Section 1's "compact persistent
 * sidebar"). Tablet: same sidebar, icon-only once the viewport narrows
 * (handled by the `lg:` breakpoint collapsing the text labels via CSS,
 * not a second component). Mobile: a drawer opened from a small top bar,
 * so the working area is never permanently crushed by a sidebar it can't
 * afford. Server-provided `ownerEmail`/`officeState` are the only two
 * real, dynamic values — everything else here is static navigation.
 */
export function OfficeSidebarNav({
  ownerEmail,
  officeState,
  signOut,
  remoteMode = false,
}: {
  ownerEmail: string;
  officeState: "OPEN" | "CLOSED";
  signOut: () => void;
  remoteMode?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar — visible only below the `md` breakpoint. */}
      <div className="glass sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 md:hidden">
        <Brand remoteMode={remoteMode} />
        <Button variant="outline" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu className="size-4" />
        </Button>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-72 flex-col gap-4 p-4">
          <SheetTitle className="sr-only">AI Office navigation</SheetTitle>
          <Brand remoteMode={remoteMode} />
          <NavLinks onNavigate={() => setMobileOpen(false)} />
          <div className="mt-auto">
            <OwnerFooter ownerEmail={ownerEmail} officeState={officeState} signOut={signOut} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop/tablet persistent sidebar. */}
      <aside className="glass sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/60 p-4 md:flex">
        <Brand remoteMode={remoteMode} />
        <NavLinks />
        <div className="mt-auto">
          <OwnerFooter ownerEmail={ownerEmail} officeState={officeState} signOut={signOut} />
        </div>
      </aside>
    </>
  );
}
