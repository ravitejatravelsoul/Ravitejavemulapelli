import { z } from "zod";

/** Mirrors the existing `contactSchema` pattern (lib/validation/contact.ts) — form → Server Action → zod. */
export const officeLoginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export type OfficeLoginValues = z.infer<typeof officeLoginSchema>;
