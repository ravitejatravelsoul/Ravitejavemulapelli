"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { runBenchmarkSuite } from "@/lib/ai-office/benchmark/benchmark-runner";
import { generateRecommendedRouting } from "@/lib/ai-office/benchmark/routing-recommendation";
import { listInstalledOllamaModels } from "@/lib/ai-office/providers/ollama/ollama-inventory";

/**
 * Owner-only local model benchmark controls (Parts G/K/L) — diagnostic
 * only, never called automatically. Every action independently calls
 * `verifySession()`, matching every other `app/office/actions/**`
 * mutation.
 */

export interface RunBenchmarkActionState {
  error?: string;
  success?: boolean;
  ranModels?: string[];
}

/**
 * Runs the full benchmark suite against every currently-installed model
 * — real model names only, detected fresh from Ollama, never a
 * client-supplied list (Part V). Strictly serial (Part T); this can take
 * several minutes on a CPU-only machine, which is expected for a
 * deliberately manual, developer-facing diagnostic action.
 */
export async function runBenchmarkAction(): Promise<RunBenchmarkActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  let models: string[];
  try {
    models = await listInstalledOllamaModels();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not detect installed Ollama models." };
  }
  if (models.length === 0) return { error: "No local Ollama models are installed." };

  const db = getAppDatabase();
  await runBenchmarkSuite(db, { models });

  revalidatePath("/office/local-models");
  return { success: true, ranModels: models };
}

const capabilitySchema = z.enum(["GENERAL", "REASONING", "CODING", "REVIEW", "FAST"]);

export interface GenerateRecommendationActionState {
  error?: string;
  success?: boolean;
  generatedCapabilities?: string[];
  skippedCapabilities?: string[];
}

export async function generateRecommendedRoutingAction(): Promise<GenerateRecommendationActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  const db = getAppDatabase();
  const { generated, skipped } = generateRecommendedRouting(db);
  const generatedCapabilities = generated.map((r) => capabilitySchema.parse(r.capability));

  revalidatePath("/office/local-models");
  return { success: true, generatedCapabilities, skippedCapabilities: skipped };
}
