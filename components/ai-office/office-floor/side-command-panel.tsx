"use client";

import { useState } from "react";
import { Building2, FolderKanban, Users, ListChecks, Activity, CheckCircle2, Wallet, Settings, LogOut, Menu } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
 */
export function SideCommandPanel({ sections }: { sections: Record<SectionKey, React.ReactNode> }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SectionKey>("projects");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Menu className="size-4" />
          Panel
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
