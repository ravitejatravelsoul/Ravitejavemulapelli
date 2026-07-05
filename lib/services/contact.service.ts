import type { ContactMessageInput } from "@/lib/data/types";

export interface ContactService {
  send(message: ContactMessageInput): Promise<{ success: boolean }>;
}

/**
 * Local placeholder implementation — no email/backend wired up yet.
 * Swap for a Resend/SendGrid/Firestore-backed implementation later by
 * changing `contactService` below; `app/api/contact/route.ts` never changes.
 */
const consoleContactService: ContactService = {
  async send(message) {
    console.info("[contact] new message received", {
      name: message.name,
      email: message.email,
      subject: message.subject,
    });
    return { success: true };
  },
};

export const contactService: ContactService = consoleContactService;
