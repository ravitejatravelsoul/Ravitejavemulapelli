import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getSiteConfig } from "@/lib/data";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { SiteChrome } from "@/components/layout/site-chrome";
import { PageTransition } from "@/components/motion/page-transition";
import { CursorGlow } from "@/components/motion/cursor-glow";
import { RouteProgressBar } from "@/components/motion/route-progress-bar";
import { Stars } from "@/components/motion/stars";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeColorSync } from "@/components/theme/theme-color-sync";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();

  return {
    metadataBase: new URL(site.seo.url),
    title: {
      default: site.seo.defaultTitle,
      template: site.seo.titleTemplate,
    },
    description: site.seo.description,
    keywords: site.seo.keywords,
    authors: [{ name: site.name }],
    creator: site.name,
    openGraph: {
      type: "website",
      url: site.seo.url,
      title: site.seo.defaultTitle,
      description: site.seo.description,
      siteName: site.name,
    },
    twitter: {
      card: "summary_large_image",
      title: site.seo.defaultTitle,
      description: site.seo.description,
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: "/apple-touch-icon.png",
    },
  };
}

export function generateViewport() {
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
      { media: "(prefers-color-scheme: dark)", color: "#0d0e12" },
    ],
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <ThemeColorSync />
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <div aria-hidden className="noise-texture pointer-events-none fixed inset-0 z-[1]" />
          <Stars className="pointer-events-none fixed inset-0 z-[1] opacity-60 dark:block hidden" />
          <CursorGlow />
          <RouteProgressBar />
          <TooltipProvider delayDuration={150}>
            <SiteChrome>
              <Navbar />
            </SiteChrome>
            <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
              <PageTransition>{children}</PageTransition>
            </main>
            <SiteChrome>
              <Footer />
            </SiteChrome>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
