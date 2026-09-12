import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { APIConnectionError, RateLimitError } from "@anthropic-ai/sdk";
import { ClaudeAdapter, isClaudeConfigured } from "../claude-adapter.ts";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.ANTHROPIC_INPUT_PRICE_PER_MTOK = "3";
  process.env.ANTHROPIC_OUTPUT_PRICE_PER_MTOK = "15";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function baseTask(): import("../../types.ts").AgentTaskInput {
  return {
    role: "frontend-developer",
    instructions: 'Perform your assigned "Frontend Developer" responsibilities for this task.',
    task: {
      projectId: "p1",
      taskId: "t1",
      roleId: "frontend-developer",
      taskTitle: "Implement frontend",
      projectSummary: "",
      authoritativeUserRequest: "Create a simple Hello World webpage with a heading, description and a button.",
      projectTitle: "Test Project",
      relevantArtifacts: [],
      relevantDecisions: [],
    },
  };
}

function textMessage(text: string, usage = { input_tokens: 100, output_tokens: 50 }) {
  return { content: [{ type: "text", text, citations: null }], usage } as unknown as Awaited<
    ReturnType<import("@anthropic-ai/sdk").default["messages"]["create"]>
  >;
}

const GOOD_OUTPUT = JSON.stringify({
  summary: "Implemented.",
  artifacts: [],
  decisions: [],
  testResults: [],
  events: [],
  fileOperations: [{ kind: "file-operation", action: "write", path: "index.html", content: "<h1>Hello, World!</h1>" }],
  recommendedNextActions: [],
});

describe("isClaudeConfigured", () => {
  test("false when ANTHROPIC_API_KEY is missing, even with pricing configured", () => {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(isClaudeConfigured(), false);
  });

  test("false when pricing is not configured, even with an API key present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";
    delete process.env.ANTHROPIC_INPUT_PRICE_PER_MTOK;
    assert.equal(isClaudeConfigured(), false);
  });

  test("true when both an API key and pricing are configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";
    assert.equal(isClaudeConfigured(), true);
  });
});

describe("ClaudeAdapter — construction", () => {
  test("throws a clear error when constructed with no API key and no injected client", () => {
    delete process.env.ANTHROPIC_API_KEY;
    assert.throws(() => new ClaudeAdapter(), /ANTHROPIC_API_KEY/);
  });

  test("never throws when a test client is injected, even with no API key configured", () => {
    delete process.env.ANTHROPIC_API_KEY;
    assert.doesNotThrow(() => new ClaudeAdapter({ client: { messages: { create: async () => textMessage(GOOD_OUTPUT) } } as never }));
  });
});

describe("ClaudeAdapter — structured output", () => {
  test("a valid structured JSON response succeeds, with real usage and cost", async () => {
    const adapter = new ClaudeAdapter({
      client: { messages: { create: async () => textMessage(GOOD_OUTPUT, { input_tokens: 1000, output_tokens: 500 }) } } as never,
    });
    const result = await adapter.runAgentTask(baseTask());
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.output.fileOperations.length, 1);
    assert.equal(result.usage.inputTokens, 1000);
    assert.equal(result.usage.outputTokens, 500);
    // 1000/1e6*3 + 500/1e6*15 = 0.003 + 0.0075 = 0.0105
    assert.ok(Math.abs(result.usage.costUsd - 0.0105) < 1e-9, `unexpected cost: ${result.usage.costUsd}`);
  });

  test("a response with a top-level failure field is a real SUCCEEDED-adapter-call/FAILED-task result", async () => {
    const failureOutput = JSON.stringify({
      summary: "",
      artifacts: [],
      decisions: [],
      testResults: [],
      events: [],
      fileOperations: [],
      recommendedNextActions: [],
      failure: { reason: "Could not complete the task." },
    });
    const adapter = new ClaudeAdapter({ client: { messages: { create: async () => textMessage(failureOutput) } } as never });
    const result = await adapter.runAgentTask(baseTask());
    assert.equal(result.status, "FAILED");
    assert.equal(result.output.failure?.reason, "Could not complete the task.");
  });
});

describe("ClaudeAdapter — malformed output", () => {
  test("non-JSON text is a malformed FAILED result, not a thrown exception", async () => {
    const adapter = new ClaudeAdapter({ client: { messages: { create: async () => textMessage("not json at all") } } as never });
    const result = await adapter.runAgentTask(baseTask());
    assert.equal(result.status, "FAILED");
    assert.match(result.output.failure?.reason ?? "", /was not valid JSON/);
  });

  test("valid JSON that doesn't match the schema is a malformed FAILED result", async () => {
    const adapter = new ClaudeAdapter({ client: { messages: { create: async () => textMessage(JSON.stringify({ nonsense: true })) } } as never });
    const result = await adapter.runAgentTask(baseTask());
    assert.equal(result.status, "FAILED");
    assert.match(result.output.failure?.reason ?? "", /did not match the expected structured shape/);
  });
});

describe("ClaudeAdapter — timeout and cancellation", () => {
  test("a call that never resolves within timeoutMs is treated as an operational timeout failure, and the request is actually aborted", async () => {
    let observedAbortSignal: AbortSignal | undefined;
    const adapter = new ClaudeAdapter({
      timeoutMs: 20,
      client: {
        messages: {
          create: (_params: unknown, options?: { signal?: AbortSignal }) => {
            observedAbortSignal = options?.signal;
            return new Promise((_resolve, reject) => {
              options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            });
          },
        },
      } as never,
    });

    await assert.rejects(() => adapter.runAgentTask(baseTask()), /Operational: Claude request timed out after 20ms/);
    assert.ok(observedAbortSignal?.aborted, "the real AbortSignal passed to the SDK call must actually be aborted — not just 'stop waiting'");
  });
});

describe("ClaudeAdapter — transient vs non-transient failures", () => {
  test("a transient APIConnectionError is classified operational", async () => {
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async () => {
            throw new APIConnectionError({ message: "ECONNRESET" });
          },
        },
      } as never,
    });
    await assert.rejects(() => adapter.runAgentTask(baseTask()), /Operational: Claude request failed transiently/);
  });

  test("a RateLimitError is classified operational", async () => {
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async () => {
            throw new RateLimitError(429, {}, "rate limited", new Headers());
          },
        },
      } as never,
    });
    await assert.rejects(() => adapter.runAgentTask(baseTask()), /Operational: Claude request failed transiently/);
  });

  test("a non-transient error (e.g. a bad request) is NOT prefixed 'Operational:' — it must consume real retry budget, not be silently absorbed", async () => {
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async () => {
            throw new Error("400 something is structurally wrong with this request");
          },
        },
      } as never,
    });
    await assert.rejects(async () => {
      try {
        await adapter.runAgentTask(baseTask());
      } catch (error) {
        assert.ok(!(error as Error).message.startsWith("Operational:"));
        throw error;
      }
    });
  });

  test("an error message is sanitized before it ever becomes a failure reason — no raw API key fragment survives", async () => {
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async () => {
            throw new Error("failed while using sk-ant-api03-realsecretvalue1234567890");
          },
        },
      } as never,
    });
    try {
      await adapter.runAgentTask(baseTask());
      assert.fail("expected runAgentTask to throw");
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(!message.includes("sk-ant-api03-realsecretvalue1234567890"), `raw key leaked into error message: ${message}`);
      assert.match(message, /\[redacted\]/);
    }
  });
});

describe("ClaudeAdapter — estimateCost", () => {
  test("estimates a conservative maximum reservation, not an average", () => {
    const adapter = new ClaudeAdapter({ client: { messages: { create: async () => textMessage(GOOD_OUTPUT) } } as never });
    const estimate = adapter.estimateCost(baseTask());
    assert.ok(estimate.estimatedInputTokens > 0);
    assert.ok(estimate.estimatedOutputTokens >= 8192, "must reserve against the real max_tokens ceiling, not a guessed average");
    assert.ok(estimate.estimatedCostUsd > 0);
  });

  test("estimateCost never silently returns a nonzero-looking real number when pricing is unset — it honestly reports $0 rather than guessing", () => {
    delete process.env.ANTHROPIC_INPUT_PRICE_PER_MTOK;
    delete process.env.ANTHROPIC_OUTPUT_PRICE_PER_MTOK;
    const adapter = new ClaudeAdapter({ client: { messages: { create: async () => textMessage(GOOD_OUTPUT) } } as never });
    const estimate = adapter.estimateCost(baseTask());
    assert.equal(estimate.estimatedCostUsd, 0);
  });
});

describe("ClaudeAdapter — model configuration", () => {
  test("uses ANTHROPIC_MODEL when set, otherwise a sane default", () => {
    process.env.ANTHROPIC_MODEL = "claude-opus-5";
    const withEnv = new ClaudeAdapter({ client: { messages: { create: async () => textMessage(GOOD_OUTPUT) } } as never });
    assert.equal(withEnv.model, "claude-opus-5");

    delete process.env.ANTHROPIC_MODEL;
    const withDefault = new ClaudeAdapter({ client: { messages: { create: async () => textMessage(GOOD_OUTPUT) } } as never });
    assert.ok(withDefault.model.length > 0);
  });

  test("an explicit model option overrides the environment", () => {
    process.env.ANTHROPIC_MODEL = "claude-opus-5";
    const adapter = new ClaudeAdapter({ model: "claude-haiku-4-5-20251001", client: { messages: { create: async () => textMessage(GOOD_OUTPUT) } } as never });
    assert.equal(adapter.model, "claude-haiku-4-5-20251001");
  });
});

describe("ClaudeAdapter — token economics: capability output ceiling (Part 7)", () => {
  test("input.maxOutputTokens is passed through as the real max_tokens request parameter", async () => {
    let capturedMaxTokens: number | undefined;
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async (params: { max_tokens: number }) => {
            capturedMaxTokens = params.max_tokens;
            return textMessage(GOOD_OUTPUT);
          },
        },
      } as never,
    });
    await adapter.runAgentTask({ ...baseTask(), maxOutputTokens: 1024 });
    assert.equal(capturedMaxTokens, 1024);
  });

  test("estimateCost reserves against the given maxOutputTokens, not a flat default, when one is provided", () => {
    const adapter = new ClaudeAdapter({ client: { messages: { create: async () => textMessage(GOOD_OUTPUT) } } as never });
    const small = adapter.estimateCost({ ...baseTask(), maxOutputTokens: 512 });
    const large = adapter.estimateCost({ ...baseTask(), maxOutputTokens: 8192 });
    assert.equal(small.estimatedOutputTokens, 512);
    assert.equal(large.estimatedOutputTokens, 8192);
    assert.ok(small.estimatedCostUsd < large.estimatedCostUsd);
  });
});

describe("ClaudeAdapter — token economics: real Anthropic prompt caching (Part 9)", () => {
  test("the system parameter carries a cache_control breakpoint on the stable content — the officially supported mechanism", async () => {
    let capturedSystem: unknown;
    let capturedMessages: unknown;
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async (params: { system: unknown; messages: unknown }) => {
            capturedSystem = params.system;
            capturedMessages = params.messages;
            return textMessage(GOOD_OUTPUT);
          },
        },
      } as never,
    });
    await adapter.runAgentTask(baseTask());

    assert.ok(Array.isArray(capturedSystem) && capturedSystem.length > 0, "system must be a content-block array, not a bare string");
    const systemBlocks = capturedSystem as Array<{ type: string; text: string; cache_control?: { type: string } }>;
    assert.ok(systemBlocks.some((b) => b.cache_control?.type === "ephemeral"), "at least one system block must carry a real cache breakpoint");
    assert.ok(systemBlocks.some((b) => b.text.includes("Create a simple Hello World webpage")), "the authoritative request is part of the cached system content");

    const userMessages = capturedMessages as Array<{ role: string; content: string }>;
    assert.equal(userMessages[0]?.role, "user");
    assert.ok(!userMessages[0]?.content.includes("Create a simple Hello World webpage"), "the authoritative request lives only in the cached system block, never duplicated into the volatile user message");
  });

  test("real cache_creation_input_tokens/cache_read_input_tokens are tracked separately, never fabricated", async () => {
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async () =>
            textMessage(GOOD_OUTPUT, { input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 800, cache_read_input_tokens: 0 } as never),
        },
      } as never,
    });
    const result = await adapter.runAgentTask(baseTask());
    assert.equal(result.usage.cacheCreationInputTokens, 800);
    assert.equal(result.usage.cacheReadInputTokens, 0);
  });

  test("a response reporting no cache activity (null fields) leaves cache usage undefined, not 0 — 0 would falsely claim the cache was checked", async () => {
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async () => textMessage(GOOD_OUTPUT, { input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: null, cache_read_input_tokens: null } as never),
        },
      } as never,
    });
    const result = await adapter.runAgentTask(baseTask());
    assert.equal(result.usage.cacheCreationInputTokens, undefined);
    assert.equal(result.usage.cacheReadInputTokens, undefined);
  });

  test("a cache read is billed at the configured cache-read rate, not the full input rate, when configured", async () => {
    process.env.ANTHROPIC_CACHE_READ_PRICE_PER_MTOK = "0.3"; // 10% of the $3 input rate
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async () => textMessage(GOOD_OUTPUT, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 } as never),
        },
      } as never,
    });
    const result = await adapter.runAgentTask(baseTask());
    assert.ok(Math.abs(result.usage.costUsd - 0.3) < 1e-9, `expected the discounted cache-read rate, got ${result.usage.costUsd}`);
  });

  test("a malformed response after real cache usage still records the real cache tokens, never zeroing them out", async () => {
    const adapter = new ClaudeAdapter({
      client: {
        messages: {
          create: async () => textMessage("not json at all", { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 500 } as never),
        },
      } as never,
    });
    const result = await adapter.runAgentTask(baseTask());
    assert.equal(result.status, "FAILED");
    assert.equal(result.usage.cacheCreationInputTokens, 500);
    assert.ok(result.usage.costUsd > 0);
  });
});
