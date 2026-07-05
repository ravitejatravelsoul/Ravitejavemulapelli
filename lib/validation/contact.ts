import { z } from "zod";

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100),
  email: z.string().trim().email("Enter a valid email address"),
  subject: z.string().trim().min(3, "Give it a short subject").max(150),
  message: z.string().trim().min(20, "Add a bit more detail (20+ characters)").max(4000),
});

export type ContactFormValues = z.infer<typeof contactSchema>;
