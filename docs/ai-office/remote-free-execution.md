# Remote free-model execution

Branch starts at master `6ab8179`, carrying forward the existing conversational Headquarters implementation. No production configuration or default runtime workflow is changed.

## Routing boundary

`state/model-catalog.json` is office-wide, separate from project bundles. Its versioned, validated allowlist contains external model registry rows, provider enablement, explicit eligibility provenance, numeric benchmark evidence, separate conversation qualifications, and provider-reported token windows. It excludes credentials, raw benchmark output, prompts, conversations, local Ollama models and arbitrary database tables. Project bundles now retain the existing task-level routing decision audit.

The explicit `scripts/ai-office-remote-sync-models.ts <evidence.db> [expected-revision]` path reads existing evidence without changing it. Replacing an existing catalog requires its reviewed revision and fails while leased. Discovery never qualifies a model. Hydration uses the same registry, adapters and router; deployment-side free-account confirmation and allowlists must independently agree with catalog eligibility. Credentials are environment secrets only.

A worker acquires a catalog lease with a GitHub Contents SHA compare-and-swap before any real provider call. Real outcomes, consecutive failures, recovery, cooldowns and token windows are persisted with that reserved SHA before releasing the lease. Stale writers are refused without merging or overwriting health. Interrupted leases fail closed and require inspection; expiration does not silently reset health or steal a possibly active worker's lease. Conversation inference uses the same lease; zero-model status queries remain available.

Workers force the Claude kill switch off and permit only simulated or FREE_MULTI_MODEL projects. Existing retries, qualification, structured-output validation, context limits and provider adapters remain authoritative. Simulated execution requires no catalog. The normal remote creation action plans in memory and checks every planned task against existing capability gates before saving or dispatching. Headquarters confirmation and Classic creation reuse that action. Creation no longer overwrites office status/budget, and project-index writes now read content and SHA from the same snapshot.

## Runtime setup

The runtime workflow must pin the reviewed engine SHA, supply only authorized provider secrets and free-account allowlists, and use office-wide workflow concurrency with cancellation disabled. The catalog lease also protects non-workflow writers. The acceptance workflow uses a separate runtime branch and a dedicated environment secret; the current main workflow and Vercel configuration remain unchanged.

## Validation

Catalog tests cover serialization/hydration, unchanged capabilities and qualification, context refusal, 429 cooldown preservation, three failures, successful recovery, owner-confirmation refusal, Claude exclusion, lease contention and stale-SHA rejection. Existing deterministic provider/router tests cover 413, malformed output, bounded fallback, paid refusal and Claude zero-call protection.

Real acceptance and final regression results will be recorded after the single authorized project.

## Single real remote acceptance — 2026-09-27

Project `cb6c646e-7861-49de-a1f4-af40f75d6cf8` was created by the real Headquarters conversation confirmation in Remote Mode with FREE_MULTI_MODEL. Private runtime branch: `acceptance/remote-free-v1`; environment: `remote-free-acceptance`; engine pinned to `0e6f6658e0ff49ddd3a6fd7c0c04023805dca76b`. Existing measured evidence came from the prior isolated conversation pilot, with no qualification or health reset. All eight planned role routes passed preflight. Runtime main and production Vercel settings were untouched.

GitHub runs (all completed): 36353679827, 36353727075, 36353790685, 36353836664, 36353889392, 36353939360, 36353992749, 36354050884, 36354105295. The acceptance browser and local web server were closed after dispatch. No local runner was started; workers self-chained in GitHub Actions.

Nine recorded Groq openai/gpt-oss-120b requests returned HTTP 200 with distinct provider request IDs, nonzero token usage and valid structured output. Example: req_01m3je3sn8epeadr907smtanns (559 input / 942 output tokens). Claude calls: 0. Paid cost: $0. Nine task routing decisions persisted. Catalog revision advanced from 1 to 10, with released lease and provider token-limit/window metadata preserved across jobs.

PO, Architect and UX completed once; Developer completed after its normal retry fixed a missing heading. QA executed four attempts, then the existing bounded policy blocked the project. Security, Code Review and Release did not execute. Four of eight tasks completed, five artifacts and three workspace files persisted (index.html, style.css, script.js). Delivery remains VERIFYING, not VERIFIED.

The exact remaining blocker is outside catalog hydration: agent-runner's mandatory built-deliverable intent-consistency gate calls `checkIntentConsistency` without an alternate provider. `lib/ai-office/agents/intent-consistency.ts` defaults to Ollama at http://127.0.0.1:11434/api/generate and gemma4:latest. GitHub has no local Ollama server. The persisted failure is `Operational: deliverable-consistency verification could not run (Intent-consistency check for built deliverable could not run (fetch failed).) — not marking this deliverable VERIFIED.` This is not a Groq limit or model-health failure. The gate was not bypassed; no project state was forced, no manual retry and no second project were launched.

Reconnect through a fresh browser restored the real remote Headquarters snapshot. The zero-model response to “What happened while I was away?” accurately cited 4/8 tasks, delivery VERIFYING and timestamped persisted failed/succeeded events. Browser errors: zero. Screenshots, bundles, workflow logs and provider diagnostics remain ignored local evidence in .data/remote-free-v1.

Final regressions: 1069/1069 AI Office tests passed; TypeScript, full ESLint, and production build passed. Full browser suite: 14/15 passed, with a mouse-look assertion failure in the unchanged 3D prototype. Its isolated rerun passed 1/1 without a code change. Secret scan across all 40 branch-changed files, 71 client bundle files and 12 local acceptance evidence files found no configured credentials or forbidden committed paths. Classic/local execution regressions passed.

Result: NOT READY. Real remote routing/background persistence is proven; the mandatory QA intent verifier still needs a remote qualified-free execution path in a follow-up phase. No merge or deployment.

## Final Headquarters acceptance — 2026-10-01 / 2026-10-02

Exactly one real project was created: `43d6b776-6b48-4217-9485-40fdc00e2148`, a tiny offline character counter with Reset. The real Headquarters confirmation and server-returned card specified Remote/FREE_MULTI_MODEL. A read of `state/projects/43d6b776-6b48-4217-9485-40fdc00e2148.json` before dispatch independently confirmed FREE_MULTI_MODEL (content SHA `4e1cabdd9621c45f0fed954f294d319297f8622a`). Boss remained on `/office?project=...`; no local runner was used. Closing the browser for 65 seconds did not stop the GitHub chain. Reconnection restored authoritative state, and “What happened while I was away?” cited persisted counts and timestamped events.

Three reproduced defects were corrected on this feature branch: advisory free-project intent checks still used localhost (0f984c8); browser QA clicked Reset on an initially empty counter, falsely rejecting a working app; and remote workers persisted task activity only after completion (the latter two in e834cb9). Browser QA now populates an editable text field and snapshots the baseline after typing, so a broken Reset still fails. Remote workers publish real RUNNING state before execution with the same SHA conflict protection. Failed publication prevents the provider call. No qualification, health, eligibility, retry ceiling, or delivery guard was weakened.

The same blocked QA task was retried once using the existing audited owner retry transition, retaining all previous attempts. No second project was created. All four recovered attempts passed the actual browser interaction (20 characters to zero, no browser errors), but the mandatory remote intent verdict failed. The project is BLOCKED with 4/8 tasks done; delivery remains VERIFYING, not VERIFIED. PO, Architect, UX and Developer completed; QA executed; Security, Code Review and Release did not execute.

Network evidence records 29 actual Groq requests: 26 to openai/gpt-oss-120b and 3 to openai/gpt-oss-20b, with 15 HTTP 200 and 14 HTTP 400 responses. SimulatedAdapter calls, Claude calls, Ollama model calls and paid fallback: zero. Recorded paid cost: $0. The 20B model was unavailable after its real failures; its health was not reset. The four recovered intent requests used 120B and returned `json_validate_failed`, with an empty failed-generation field and maxOutputTokens=300. Request IDs: `req_01m3yg20qeeg6byp0tcv4t85f0`, `req_01m3yg3m5xe7j9wtdxyeknv2xp`, `req_01m3yg6bcvefn8h9mkbf7sht8f`, `req_01m3yg7tgfefr9w66jbhk2hbv5`. These responses establish the blocker, not whether token budget or prompt/schema interaction caused it. No speculative fix or further recovery was attempted.

GitHub runs: 36941733959, 36941788140, 36941868797, 36941954779, 36942041455, 36942117007, 36942210754, 36942290625, 36942357226, 36942421016, 36942516716, 37019604765, 37019710030, 37019815308, 37019989775. Workflow success means a bounded cycle completed, not that the project passed acceptance.

Orchestrator working state, grounded text and native speech were captured. Specialist active briefings were not captured. Backend-driven handoff animation phases were captured, but successful downstream recipient work was not proven. The observer recorded a teardown race after closing the page; this is not an application browser error. Full live voice lifecycle acceptance, real VERIFIED delivery and Release-to-Vault remain unproven. Fixture E2E evidence is not substituted for these items.

Targeted tests: 94/94. Full browser/E2E: 15/16 initially; the assignment-card timeout passed its isolated rerun without code changes. TypeScript, ESLint and build passed. Full AI Office: 1103/1103 passed. Secret scan passed across 54 branch-changed files, 71 client bundle files and 40 evidence files. Private evidence stays in ignored `.data/final-real-hq`; no credentials, workspace databases or logs are committed. Runtime main, production configuration, master and deployment are unchanged. Result: NOT READY.
