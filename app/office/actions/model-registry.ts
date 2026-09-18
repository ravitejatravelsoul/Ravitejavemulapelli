"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getOfficeDb } from "@/lib/ai-office/office-db";
import { syncAllFreeModelCatalogs } from "@/lib/ai-office/providers/free/model-catalog-sync";
import { setProviderEnabled, setModelEnabled } from "@/lib/ai-office/domain/model-registry";
import { benchmarkFreeProviderModel } from "@/lib/ai-office/benchmark/free-model-benchmark";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";

/**
 * Free multi-model orchestration phase — owner-only Model Control Center
 * controls (Phase 9/10). Every action independently calls
 * `verifySession()`, matching every other `app/office/actions/**`
 * mutation. Deliberately LOCAL ONLY: the registry lives in
 * `getOfficeDb()`'s ephemeral Remote-Mode database exactly like every
 * other page, but refreshing a live external catalog or running a real
 * benchmark against a free provider from a serverless Remote Mode
 * request is out of scope for this phase (no durable place to persist
 * results between requests there) — disclosed plainly rather than
 * silently no-op'd.
 */

const providerSchema = z.enum(["groq", "gemini", "openrouter", "ollama"]);

export interface ModelRegistryActionState {
  error?: string;
  success?: boolean;
}

export async function refreshFreeModelCatalogAction(): Promise<ModelRegistryActionState & { results?: { provider: string; configured: boolean; ok: boolean; modelsFound: number; error?: string }[] }> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (isRemoteExecutionMode()) return { error: "Refreshing the free-model catalog is only available in Local Mode." };

  const db = await getOfficeDb();
  const results = await syncAllFreeModelCatalogs(db);
  revalidatePath("/office/local-models");
  const failed = results.filter(r => r.configured && !r.ok);
  return failed.length ? { error: failed.map(r => `${r.provider}: ${r.error}`).join("; "), results } : { success: true, results };
}

export async function setProviderEnabledAction(provider: string, enabled: boolean): Promise<ModelRegistryActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success) return { error: "Invalid provider." };
  if (isRemoteExecutionMode()) return { error: "Changing provider configuration is only available in Local Mode." };

  const db = await getOfficeDb();
  setProviderEnabled(db, parsed.data, enabled);
  revalidatePath("/office/local-models");
  return { success: true };
}

export async function setModelEnabledAction(provider: string, modelId: string, enabled: boolean): Promise<ModelRegistryActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success) return { error: "Invalid provider." };
  if (typeof modelId !== "string" || modelId.length === 0) return { error: "Invalid model." };
  if (isRemoteExecutionMode()) return { error: "Changing model configuration is only available in Local Mode." };

  const db = await getOfficeDb();
  setModelEnabled(db, parsed.data, modelId, enabled);
  revalidatePath("/office/local-models");
  return { success: true };
}

export async function benchmarkFreeModelAction(provider: string, modelId: string): Promise<ModelRegistryActionState & { score?: number; qualified?: boolean }> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success) return { error: "Invalid provider." };
  if (typeof modelId !== "string" || modelId.length === 0) return { error: "Invalid model." };
  if (isRemoteExecutionMode()) return { error: "Benchmarking is only available in Local Mode." };

  const db = await getOfficeDb();
  const result = await benchmarkFreeProviderModel(db, { provider: parsed.data, modelId });
  revalidatePath("/office/local-models");
  if (!result.ok) return { error: result.error };
  return { success: true, score: result.score, qualified: result.qualified };
}
