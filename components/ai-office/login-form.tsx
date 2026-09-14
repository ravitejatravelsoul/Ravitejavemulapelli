"use client";

import { useActionState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type OfficeLoginState } from "@/app/office/actions/auth";

const initialState: OfficeLoginState = {};

export function OfficeLoginForm() {
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <form action={formAction} noValidate className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="office-email">Email</Label>
        <Input
          key={state?.email ?? ""}
          id="office-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state?.email ?? ""}
          aria-invalid={!!state?.error}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="office-password">Password</Label>
        <Input
          id="office-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!state?.error}
          aria-describedby={state?.error ? "office-login-error" : undefined}
        />
      </div>

      {state?.error ? (
        <p id="office-login-error" role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="gradient-cta w-full border-0">
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
        Sign in
      </Button>
    </form>
  );
}
