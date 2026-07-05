"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ArrowUpRight } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

const primaryLinks = [
  { label: "About", href: "/about" },
  { label: "Experience", href: "/experience" },
  { label: "Projects", href: "/projects" },
  { label: "Writing", href: "/blog" },
];

const menuGroups = [
  {
    label: "Career",
    links: [
      { label: "About", href: "/about" },
      { label: "Experience", href: "/experience" },
      { label: "Skills", href: "/skills" },
      { label: "Achievements", href: "/achievements" },
      { label: "Certifications", href: "/certifications" },
      { label: "Resume", href: "/resume" },
    ],
  },
  {
    label: "Work",
    links: [
      { label: "Projects", href: "/projects" },
      { label: "Writing", href: "/blog" },
    ],
  },
  {
    label: "More",
    links: [
      { label: "Travel", href: "/travel" },
      { label: "Contact", href: "/contact" },
    ],
  },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-colors duration-300",
        scrolled ? "glass" : "border-b border-transparent",
      )}
    >
      <nav
        className={cn(
          "mx-auto flex max-w-6xl items-center justify-between px-6 transition-[height] duration-300 md:px-10",
          scrolled ? "h-14" : "h-16",
        )}
      >
        <Link
          href="/"
          className="font-mono text-sm font-medium tracking-tight rounded-sm transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Raviteja Vemulapelli
        </Link>

        <div className="hidden items-center gap-8 lg:flex">
          {primaryLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative py-1 text-sm transition-colors hover:text-foreground rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {link.label}
                {isActive ? (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute inset-x-0 -bottom-1 h-px bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                ) : null}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="hidden transition-transform hover:scale-[1.03] active:scale-[0.97] sm:inline-flex">
            <Link href="/contact">
              Contact <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open site menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full max-w-sm">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              {menuOpen ? (
                <StaggerContainer eager stagger={0.06} className="flex flex-col gap-8 px-6 pb-8">
                  {menuGroups.map((group) => (
                    <StaggerItem key={group.label}>
                      <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {group.label}
                      </p>
                      <div className="flex flex-col gap-1">
                        {group.links.map((link) => (
                          <SheetClose asChild key={link.href}>
                            <Link
                              href={link.href}
                              className="rounded-md px-2 py-2 text-base text-foreground/90 transition-all hover:translate-x-1 hover:bg-secondary hover:text-foreground"
                            >
                              {link.label}
                            </Link>
                          </SheetClose>
                        ))}
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              ) : null}
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
