"use server";

import { redirect } from "next/navigation";
import { officeLoginSchema } from "@/lib/ai-office/auth/schema";
import { verifyOwnerCredentials } from "@/lib/ai-office/auth/credentials";
import { createOfficeSession, destroyOfficeSession } from "@/lib/ai-office/auth/session";

export interface OfficeLoginState {
  error?: string;
}

/**
 * Server Action backing the `/office/login` form — matches the documented
 * Next.js 16 App Router auth pattern (form → Server Action → zod →
 * session), see docs/ai-office/08-security-plan.md §1.
 *
 * Deliberately returns one generic error for both "unknown email" and
 * "wrong password" — never reveals which field was wrong (no user
 * enumeration), and never reveals *why* login is impossible (e.g. missing
 * server configuration) beyond a generic message, since that detail isn't
 * the visitor's to know.
 */
export async function login(
  _prevState: OfficeLoginState | undefined,
  formData: FormData,
): Promise<OfficeLoginState> {
  const parsed = officeLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const isValid = verifyOwnerCredentials(parsed.data.email, parsed.data.password);
  if (!isValid) {
    return { error: "Invalid email or password." };
  }

  const sessionCreated = await createOfficeSession(parsed.data.email);
  if (!sessionCreated) {
    return { error: "Sign-in is not available right now. Try again shortly." };
  }

  redirect("/office");
}

/** Used directly as `<form action={logout}>` — no field values are needed, and a function with fewer declared params than the expected `(formData: FormData) => ...` action signature is still assignable in TypeScript. */
export async function logout(): Promise<void> {
  await destroyOfficeSession();
  redirect("/office/login");
}
