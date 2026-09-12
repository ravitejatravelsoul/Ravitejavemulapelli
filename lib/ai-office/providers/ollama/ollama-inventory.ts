import "server-only";
import { z } from "zod";

/**
 * Real local-model detection (local multi-model routing follow-up, Part
 * A) — the only place that calls Ollama's `/api/tags` inventory endpoint.
 * Never downloads a model, never lets a router/agent invent a model name
 * out of thin air: `LocalModelRouter.selectModel()` only ever picks from
 * whatever this function actually reports as installed right now.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 10_000;

const tagsResponseSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        size: z.number().optional(),
      }),
    )
    .default([]),
});

export interface InstalledOllamaModel {
  name: string;
  sizeBytes: number | null;
}

export interface ListInstalledOllamaModelsOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Real names only — no fabrication, no assumed models. Throws (never silently returns an empty/fake list) if the Ollama server can't be reached or responds unexpectedly, so a caller can tell "zero models installed" apart from "couldn't ask." */
export async function listInstalledOllamaModelsDetailed(options: ListInstalledOllamaModelsOptions = {}): Promise<InstalledOllamaModel[]> {
  const baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/tags`, { method: "GET", signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Operational: Ollama model inventory request timed out after ${timeoutMs}ms at ${baseUrl}.`);
    }
    throw new Error(
      `Operational: Could not reach Ollama at ${baseUrl} to list installed models — is it running? (${error instanceof Error ? error.message : String(error)})`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Operational: Ollama responded with HTTP ${response.status} while listing installed models at ${baseUrl}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Operational: Ollama's model inventory response was not valid JSON.");
  }

  const parsed = tagsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Operational: Ollama's model inventory response did not match the expected shape: ${parsed.error.message}`);
  }

  return parsed.data.models.map((m) => ({ name: m.name, sizeBytes: m.size ?? null }));
}

/** Convenience wrapper returning just the installed model names — what LocalModelRouter and the benchmark runner actually need. */
export async function listInstalledOllamaModels(options: ListInstalledOllamaModelsOptions = {}): Promise<string[]> {
  return (await listInstalledOllamaModelsDetailed(options)).map((m) => m.name);
}
