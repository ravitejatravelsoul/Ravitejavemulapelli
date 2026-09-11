"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A private-dashboard button that calls a Server Action directly (not
 * via `<form action>`) and surfaces its `{ error? }` result as a toast —
 * every mutation action in `app/office/actions/**` returns exactly this
 * shape, so one component covers Open/Close, Pause/Resume, and
 * Approve/Reject uniformly. `confirmMessage`, when set, requires a
 * native confirm dialog before calling the action — used for the two
 * decisions that permanently commit something (Approve, Reject).
 */
export function ActionButton({
  action,
  children,
  confirmMessage,
  successMessage,
  className,
  variant,
  size,
  disabled,
}: {
  action: () => Promise<{ error?: string }>;
  children: React.ReactNode;
  confirmMessage?: string;
  successMessage?: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled || isPending}
      className={cn(className)}
      onClick={() => {
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        startTransition(async () => {
          const result = await action();
          if (result?.error) {
            toast.error(result.error);
          } else if (successMessage) {
            toast.success(successMessage);
          }
        });
      }}
    >
      {children}
    </Button>
  );
}
