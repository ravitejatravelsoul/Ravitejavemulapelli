"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { approveApproval, rejectApproval } from "@/lib/ai-office/approvals/approval-service";
import {
  hydrateEphemeralDb,
  flushProjectBundle,
  readOfficeState,
  readProjectBundle,
  writeProjectBundle,
  remoteClientFromEnv,
  REMOTE_SYNTHETIC_OWNER_ID,
} from "@/lib/ai-office/remote/remote-state-store";
import { GitHubClient } from "@/lib/ai-office/remote/github-client";

/**
 * Remote Mode's Approve/Reject — reuses `approveApproval`/
 * `rejectApproval` (lib/ai-office/approvals/approval-service.ts)
 * completely unmodified, exactly like the local
 * app/office/actions/approvals.ts. The only difference is where the
 * "before" state comes from (a fresh hydration of the one project's
 * GitHub-committed bundle, re-read right before deciding — so a stale
 * approval or a task that moved on since the page was last loaded is
 * caught by `approveApproval`'s own exact-scope/idempotency checks
 * against CURRENT state, never the browser's stale view) and what
 * happens after a successful decision: the bundle is flushed back with
 * optimistic concurrency, and a fresh worker run is dispatched so the
 * project actually resumes in the background — approving from Remote
 * Mode does nothing by itself otherwise, since there is no long-lived
 * local runner polling for this change.
 */

export interface RemoteApprovalActionState {
  error?: string;
}

export async function approveRemoteApprovalAction(projectId: string, approvalId: string, note?: string): Promise<RemoteApprovalActionState> {
  return decide(projectId, approvalId, note, "approve");
}

export async function rejectRemoteApprovalAction(projectId: string, approvalId: string, note?: string): Promise<RemoteApprovalActionState> {
  return decide(projectId, approvalId, note, "reject");
}

async function decide(projectId: string, approvalId: string, note: string | undefined, kind: "approve" | "reject"): Promise<RemoteApprovalActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof projectId !== "string" || !projectId || typeof approvalId !== "string" || !approvalId) {
    return { error: "Invalid project or approval." };
  }

  let remoteConfig;
  try {
    remoteConfig = remoteClientFromEnv();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Remote Mode is not configured." };
  }

  const [{ state: office }, { bundle, sha }] = await Promise.all([readOfficeState(remoteConfig), readProjectBundle(remoteConfig, projectId)]);
  if (!bundle) return { error: "Project not found." };

  const db = hydrateEphemeralDb(office, bundle);
  const result =
    kind === "approve"
      ? approveApproval(db, { approvalId, decidedByUserId: REMOTE_SYNTHETIC_OWNER_ID, note: note?.trim() || undefined })
      : rejectApproval(db, { approvalId, decidedByUserId: REMOTE_SYNTHETIC_OWNER_ID, note: note?.trim() || undefined });

  if (!result.ok) return { error: result.reason };

  const newBundle = flushProjectBundle(db, projectId);
  await writeProjectBundle(remoteConfig, newBundle, sha);

  const gh = new GitHubClient(remoteConfig);
  await gh.dispatchWorkflow("ai-office-remote-worker.yml", { projectId, taskId: "", runId: crypto.randomUUID(), action: "continue" });

  revalidatePath("/office");
  return {};
}
