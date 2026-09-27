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
