# Conversational Headquarters V1

Base: `6ab81796ed8e48799119c435a2a34d8e52ea9a09`. Local feature work only; no production configuration, deployment, or cutover.

## Architecture audit

The existing Assistant parses a small command vocabulary and reads dashboard projections. Unknown questions return a help message; it has no reasoning or conversational memory. Its microphone and default browser utterances are separate from Headquarters' local-only speech controller. Headquarters already provides authoritative world projections, grounded role briefings, independent visual handoff/delivery queues, and owner panels.

Extend these boundaries rather than creating another executor:

- One Conversation Orchestrator accepts text and recognized transcripts, with deterministic intent routing and scoped, bounded conversation context.
- Reuse `getOfficeDb` for local/remote reads, role-scoped task context and sanitized world projections for grounding, existing project/approval server actions for confirmed mutations.
- Conversation inference uses the existing free adapter factory. Conversation qualification is separate from execution qualification; no inferred capabilities or changes to project qualification.
- The existing runner, task DAG, QA, delivery verification and remote worker remain the only execution system.
- Headquarters and Classic chat use the same conversation component and server boundary. Headquarters keeps one local speech controller.
- Owner commands remain validated data, never model output interpreted as executable instructions.

## Known baseline constraints

Remote project creation is intentionally SIMULATED/LOCAL_ONLY in the existing remote action. This phase must not describe a simulated remote run as real free-provider acceptance. Browser-native recognition may use the browser vendor's speech service; only speech output is guaranteed local. Recognition is explicit push-to-talk and requires disclosure and typed fallback.

## Acceptance

Exactly one real local project was created through the Headquarters conversation confirmation: `b956a22b-85db-4b6d-83f6-1b37e03bba26`, a dependency-free offline counter with Increment/Reset and keyboard focus. All eight tasks completed on their first attempt: PO, Architect, UX, Developer, QA, Security, Code Review and Release. Delivery is VERIFIED; project is READY_FOR_REVIEW. Recorded execution used Groq openai/gpt-oss-120b, Claude calls 0, paid cost $0. The legacy provider/aiMode defaults remain simulated in storage, but routingMode FREE_MULTI_MODEL selects the recorded real Groq runs.

Live status, active PO briefing, contextual follow-up reasoning and reconnect summary passed. Zero-model replies took 333–565 ms; real reasoning took 1299–1617 ms. Boss was walked to Orchestrator and PO. Native local speech produced 17 lifecycle events including cancellation; real microphone recognition was not exercised with human speech (browser tests use an explicit recognition mock).

The independent local runner continued after closing the browser: persisted events increased from 14 to 22, and reconnect restored 3/8 completed tasks. This proves local background continuation, not a real remote GitHub worker run. Existing remote creation remains simulated-only.

The real delivery event `delivery:d1725afb-dbd9-474d-b414-fbc5473abc77` traversed PREPARE, TRAVEL, TRANSFER, RETURN and DOCK and was recorded as completed while later handoffs ran. Screenshots show the real VERIFIED banner and Release → Delivery Vault status. The camera stayed at the entrance, so close-up Core placement/Vault activation is not visually proven. The observer's combined delivery-last/empty-queue predicate did not capture a final vault.json because later handoffs replaced the last-completed ID; do not claim that combined capture passed.

Typical FPS was 60 with capture-time drops as low as 8; this is not a sustained-60 guarantee. Post-GC heap was 31,261,436 then 31,243,304 bytes over the final ten-second sample (short sample only). Browser errors: 0. Raw evidence, screenshots, request metadata, database and workspaces remain ignored under .data/conversation-v1 and are not committed.

Remaining live acceptance gaps: real human microphone recognition, close-up Vault activation/Core placement, and real remote worker continuation. No second project was launched. No production configuration, deployment or merge occurred.

## Conversation model evidence

Discovery uses the existing provider catalog sync and free-eligibility configuration, not catalog labels alone. Official references: [Groq rate limits](https://console.groq.com/docs/rate-limits), [OpenRouter free routing](https://openrouter.ai/openrouter/free/apps), and [OpenRouter free variants](https://openrouter.ai/support/). Groq eligibility remains OWNER_CONFIRMED_FREE_TIER; OpenRouter requests retain max_price zero. Gemini has no configured key; no signup or credential was invented.

An isolated copy of the existing model evidence was used. The additional shortlist was limited to three concrete OpenRouter free routes: `liquid/lfm-2.5-2.6b:free` (unavailable), `google/gemma-4-31b-it:free` (429), and `dots-studio/dots-3-note-preview:free` (failed qualification). None was enabled for conversation or execution by assumption.

Real conversation-specific probes qualified Groq `openai/gpt-oss-20b` for FAST_CONVERSATION and CODING, and `openai/gpt-oss-120b` for REASONING, REVIEW and SECURITY. Each probe tests structured, read-only output, evidence grounding, bounded context and latency. No project-execution qualifications or capabilities are granted by these probes. An initial greeting rubric rejected the semantically correct phrase “do not have information”; it was corrected to accept that explicit unknown, then re-tested. The security probe was clarified to explicitly ask for identification of prompt injection before testing that criterion. Raw synthetic probe evidence stays in ignored local state.

Memory retains at most 12 messages/10,000 characters per conversation, scoped to owner, login, agent and selected project. Local retention is bounded to 30 conversations per owner and 24 hours. Remote hydrated views carry an authenticated encrypted, context-bound envelope instead of pretending their ephemeral SQLite data persists. Remote confirmed transitions record a single-use nonce in the existing project event bundle, under its existing optimistic-write boundary.

## Regression and security

Final AI Office unit/integration suite: 1067/1067 PASS. Full browser suite originally passed 14/15; its one launcher-accessibility regression was fixed and the navigation suite re-run 3/3 PASS. The new conversation browser suite re-run after the final application changes passed 1/1. TypeScript, full ESLint and production build passed. The generated conversation build directory is ignored by Git and ESLint. The secret scan checks changed/new tracked candidates and client bundles against configured credentials and forbids local data/environment paths. Evidence remains local; no secrets, databases or credential logs are included in the feature commit.
