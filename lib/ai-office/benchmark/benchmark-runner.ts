import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { OllamaAdapter, OllamaTimeoutError } from "../providers/ollama/ollama-adapter.ts";
import type { AgentTaskResult } from "../providers/types.ts";
import { recordBenchmarkResult, type BenchmarkResultRow } from "../domain/model-routing.ts";
import { BENCHMARK_SCENARIOS, getBenchmarkScenario, type BenchmarkScenarioId } from "./scenarios.ts";

/**
 * Local model benchmark runner (Parts G-J, O/P) — the ONLY code that
 * actually invokes an adapter for a benchmark scenario. Deliberately
 * separate from agent-runner.ts's executeTask(): a benchmark never
 * creates a Task/TaskAttempt/AgentRun, never touches a real project or
 * workspace, and its results live only in `benchmark_results` (Part I),
 * entirely isolated from real project/budget history.
 *
 * Runs are always serial — one scenario, one model, at a time (Part T:
 * "prefer serial model execution... avoid parallel benchmark runs on
 * this machine"). `runBenchmarkSuite` enforces this by awaiting each
 * call in sequence rather than using Promise.all.
 */

const DEFAULT_BENCHMARK_TIMEOUT_MS = 90_000;

export interface RunBenchmarkOptions {
  model: string;
  scenarioId: BenchmarkScenarioId;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Never throws — an adapter-level failure (timeout, connection error, malformed JSON) is itself a real, recordable benchmark outcome, not an exception escaping the runner. */
export async function runBenchmarkScenario(db: DatabaseSync, options: RunBenchmarkOptions): Promise<BenchmarkResultRow> {
  const scenario = getBenchmarkScenario(options.scenarioId);
  const adapter = new OllamaAdapter({
    model: options.model,
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs ?? DEFAULT_BENCHMARK_TIMEOUT_MS,
  });

  const startedAt = Date.now();
  let result: AgentTaskResult;
  let timedOut = false;
  try {
    result = await adapter.runAgentTask(scenario.buildInput());
  } catch (error) {
    timedOut = error instanceof OllamaTimeoutError;
    result = {
      status: "FAILED",
      output: {
        summary: "",
        artifacts: [],
        decisions: [],
        testResults: [],
        events: [],
        fileOperations: [],
        recommendedNextActions: [],
        failure: { reason: error instanceof Error ? error.message : String(error) },
      },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }
  const latencyMs = Date.now() - startedAt;

  const malformedJson = result.status === "FAILED" && /not valid JSON|did not match the expected structured shape/i.test(result.output.failure?.reason ?? "");
  const evaluation = scenario.evaluate(result);

  return recordBenchmarkResult(db, {
    model: options.model,
    scenarioId: scenario.id,
    roleId: scenario.roleId,
    status: evaluation.status,
    score: evaluation.score,
    latencyMs,
    promptTokens: result.usage.inputTokens || undefined,
    outputTokens: result.usage.outputTokens || undefined,
    retries: 0,
    timedOut,
    malformedJson,
    fileOperationValid: evaluation.fileOperationValid,
    defectDiagnosed: evaluation.defectDiagnosed,
    matchesRequest: evaluation.matchesRequest,
    details: {
      notes: evaluation.notes,
      summary: result.output.summary,
      failureReason: result.output.failure?.reason ?? null,
      adapterStatus: result.status,
    },
  });
}

export interface RunBenchmarkSuiteOptions {
  models: readonly string[];
  scenarioIds?: readonly BenchmarkScenarioId[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Runs every requested scenario against every requested model, strictly serially (model outer loop, scenario inner loop) — never in parallel, per Part T. */
export async function runBenchmarkSuite(db: DatabaseSync, options: RunBenchmarkSuiteOptions): Promise<BenchmarkResultRow[]> {
  const scenarioIds = options.scenarioIds ?? BENCHMARK_SCENARIOS.map((s) => s.id);
  const results: BenchmarkResultRow[] = [];
  for (const model of options.models) {
    for (const scenarioId of scenarioIds) {
      results.push(
        await runBenchmarkScenario(db, {
          model,
          scenarioId,
          timeoutMs: options.timeoutMs,
          fetchImpl: options.fetchImpl,
          baseUrl: options.baseUrl,
        }),
      );
    }
  }
  return results;
}
