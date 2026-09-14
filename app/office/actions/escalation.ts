"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { setNotificationPolicy, type NotificationMode } from "@/lib/ai-office/domain/notification-policy";

export interface NotificationPolicyActionState {
  error?: string;
  success?: boolean;
}

const VALID_MODES: NotificationMode[] = ["OFF", "IN_APP", "SMS", "CALL_SMS_FALLBACK"];

/** Owner-only — the one write path for the notification policy (Section M's Settings section). */
export async function updateNotificationPolicyAction(
  _prevState: NotificationPolicyActionState | undefined,
  formData: FormData,
): Promise<NotificationPolicyActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  const mode = String(formData.get("mode") ?? "OFF");
  if (!VALID_MODES.includes(mode as NotificationMode)) return { error: "Invalid notification mode." };

  const db = getAppDatabase();
  setNotificationPolicy(db, {
    mode: mode as NotificationMode,
    quietHoursEnabled: formData.get("quietHoursEnabled") === "on",
    quietHoursStart: String(formData.get("quietHoursStart") ?? "22:00"),
    quietHoursEnd: String(formData.get("quietHoursEnd") ?? "07:00"),
    timezone: String(formData.get("timezone") ?? "UTC"),
    callWindowStart: String(formData.get("callWindowStart") ?? "08:00"),
    callWindowEnd: String(formData.get("callWindowEnd") ?? "21:00"),
  });

  revalidatePath("/office/settings");
  return { success: true };
}
