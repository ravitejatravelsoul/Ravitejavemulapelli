import "server-only";

/**
 * A safe, on-demand local health check — called from the New Project form
 * and the office floor's provider badge, never polled on an interval.
 * Failure of any kind (offline, timeout, malformed response) reads as
 * simply "offline" — this is informational only, never a gate that
 * blocks anything itself.
 */
export interface OllamaHealth {
  online: boolean;
  models: string[];
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const HEALTH_CHECK_TIMEOUT_MS = 3000;

export async function checkOllamaHealth(options: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<OllamaHealth> {
  const baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) return { online: false, models: [] };
    const body = (await response.json()) as { models?: { name: string }[] };
    return { online: true, models: (body.models ?? []).map((m) => m.name) };
  } catch {
    return { online: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}
