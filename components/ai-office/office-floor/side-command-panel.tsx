"use client";

import { useState } from "react";
import { Building2, FolderKanban, Users, ListChecks, Activity, CheckCircle2, Wallet, Settings, LogOut, Menu } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { logout } from "@/app/office/actions/auth";

type SectionKey = "projects" | "agents" | "tasks" | "activity" | "approvals" | "budget" | "settings";

const NAV: { key: SectionKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "agents", label: "Agents", icon: Users },
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "approvals", label: "Approvals", icon: CheckCircle2 },
  { key: "budget", label: "Budget", icon: Wallet },
  { key: "settings", label: "Settings", icon: Settings },
];

/**
 * Collapsible right-side command panel — reuses the existing, unmodified
 * dashboard widgets (passed in as pre-rendered Server Component children,
 * one per section) inside a drawer, so none of that working code needed
 * to change. "Office Floor" isn't a section here; it's just what's behind
 * the drawer when it's closed.
 *
 * `pendingApprovalCount` (real UX defect fix): previously a pending
 * approval was only ever visible after the owner opened this panel *and*
 * manually selected the "Approvals" tab within it — nothing on the closed
 * trigger button or the tab strip itself gave any indication something
 * needed a decision. Now a nonzero count puts a real badge on both the
 * trigger and the tab, and opening the panel jumps straight to Approvals
 * instead of defaulting to Projects.
 */
export function SideCommandPanel({ sections, pendingApprovalCount = 0 }: { sections: Record<SectionKey, React.ReactNode>; pendingApprovalCount?: number }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SectionKey>(pendingApprovalCount > 0 ? "approvals" : "projects");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="relative">
          <Menu className="size-4" />
          Panel
          {pendingApprovalCount > 0 && (
            <Badge variant="destructive" className="absolute -top-2 -right-2 size-5 justify-center rounded-full p-0 text-[0.65rem]">
              {pendingApprovalCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/60 p-4">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" />
            <SheetTitle>AI Office</SheetTitle>
          </div>
        </SheetHeader>

        <div className="flex gap-1 overflow-x-auto border-b border-border/60 px-3 py-2">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActive(item.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                active === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
              {item.key === "approvals" && pendingApprovalCount > 0 && (
                <Badge variant="destructive" className="size-4 justify-center rounded-full p-0 text-[0.6rem]">
                  {pendingApprovalCount}
                </Badge>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">{sections[active]}</div>

        <div className="border-t border-border/60 p-4">
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
