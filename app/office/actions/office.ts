"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOwner } from "@/lib/ai-office/domain/users";
import { openOffice, closeOffice } from "@/lib/ai-office/control/office-control";
import { isAiOfficeOperationalModeEnabled, OPERATIONAL_MODE_DISABLED_MESSAGE } from "@/lib/ai-office/config/operational-mode";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";
import { withRemoteOfficeMutation, REMOTE_SYNTHETIC_OWNER_ID } from "@/lib/ai-office/remote/remote-state-store";

/**
 * Office Open/Close — bound to `<form action={...}>` buttons on the
 * dashboard. Each independently calls `verifySession()`; per
 * docs/ai-office/08-security-plan.md §5, the `(protected)` layout's own
 * session check is not a substitute — a Server Action reachable from a
 * protected page must still authenticate itself, since layouts don't
 * re-run on client-side navigation.
 */

export interface OfficeControlActionState {
  error?: string;
}

export async function openOfficeAction(): Promise<OfficeControlActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  if (isRemoteExecutionMode()) {
    const result = await withRemoteOfficeMutation((db) => {
      openOffice(db, REMOTE_SYNTHETIC_OWNER_ID);
      return { ok: true, value: undefined };
    });
    revalidatePath("/office");
    return result.ok ? {} : { error: result.error };
  }

  if (!isAiOfficeOperationalModeEnabled()) return { error: OPERATIONAL_MODE_DISABLED_MESSAGE };

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  openOffice(db, owner.id);
  revalidatePath("/office");
  return {};
}

export async function closeOfficeAction(): Promise<OfficeControlActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  if (isRemoteExecutionMode()) {
    const result = await withRemoteOfficeMutation((db) => {
      closeOffice(db, REMOTE_SYNTHETIC_OWNER_ID);
      return { ok: true, value: undefined };
    });
    revalidatePath("/office");
    return result.ok ? {} : { error: result.error };
  }

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  closeOffice(db, owner.id);
  revalidatePath("/office");
  return {};
}
