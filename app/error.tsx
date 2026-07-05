"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw } from "lucide-react";
import { Section } from "@/components/common/section";
import { Button } from "@/components/ui/button";
import { GradientText } from "@/components/common/gradient-text";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Section className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-sm text-muted-foreground">Error</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        <GradientText>Something went wrong</GradientText>
      </h1>
      <p className="mt-4 max-w-md text-muted-foreground">
        An unexpected error occurred loading this page. Try again, or head back home.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => reset()}>
          <RotateCw className="size-4" /> Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeft className="size-4" /> Back to home
          </Link>
        </Button>
      </div>
    </Section>
  );
}
