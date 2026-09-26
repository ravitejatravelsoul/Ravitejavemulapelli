# Voice acceptance blocker recovery

Voice work preserved separately in commit ab836cd, based on 198afe400cc1c38ab8b508603438cd4e05153e72. No Headquarters redesign, provider additions, paid fallback or production changes.

## Evidence and root causes

The prior report overstated missing functionality. The failed project 263595df-3ae9-4dfc-92b2-d6d12e1439b7 persisted workspace contains both editing and persistence. A read-only real browser inspection successfully created an item, reloaded it, edited it and reloaded the edit. This proves those behaviors in the retained workspace, not every acceptance criterion or the earlier overwritten implementation.

Its two QA evidence records only show the initial empty screen and clicking Create without input. The semantic gate received those visible strings and filenames, not the implementation, then asserted missing editing/persistence. The Developer context also excluded the requirements artifact through its persisted role scope and truncated architecture/UX to 600 characters. The authoritative original request itself was intact. Remediation received failure summaries and source files, but not the associated actual review observations.

Changes: include full requirements for implementation roles, preserve requirements/architecture/UX through prompt rendering and context-budget reduction, attach exact failed review observations via the originating run, and pass real workspace source alongside the actual browser smoke-test observations to the existing strict semantic gate. Candidate review context is bounded at 32,000 characters and fails unavailable when exceeded, rather than silently truncating evidence. No verdict is forced and no generic role contains product-specific functionality.

Groq returned HTTP 429 for both eligible models during repairs. Request IDs: req_01m3cdg7x1eq8repezg2v7zcgr (20b), req_01m3cdg82hegxr7ay6pphd1zag (120b). Registry showed 120b at three consecutive failures and 20b at two. Retry-After already flowed into model-specific cooldown; fallback was bounded and exhausted capacity failed honestly. A stale cooldown timestamp could previously re-admit a model despite three failures: the router now explicitly enforces that protection. Below that threshold, an expired cooldown permits an eligible model to be tried without rewriting health. Invalid/negative Retry-After values receive the conservative default; valid seconds and HTTP dates are honored. No retry ceilings were raised.

The walkthrough combined static navigation with one final all-or-nothing actor collision test. That prevented sliding and only checked the final location during large frame movement. Actor clearance now participates in each existing movement substep and axis, preserving the 0.82 personal-space radius and static collisions. Tests approach from five angles, escape safely, and reject tunneling. The previous scripted route also aimed inside furniture and did not account for camera yaw; the next evidence harness uses collision-clear paths and normal keyboard controls.

## Pre-run verification

163 focused regression tests, three new context/approach tests, 43 free-execution/provider/Claude tests, and 34 context-budget tests passed. TypeScript, ESLint and production build passed. Browser gate and final real run results follow below.

The single new real run will inherit the failed registry and qualification records, including failure counters. It will not reset model health. Normal runner polling is configured to 20 seconds to allow walking between brief tasks and avoid bursts; no responses or backend states are delayed, intercepted or fabricated.

Headquarters browser/E2E passed (257 seconds), including speech cancellation/cooldown, prior movement/delivery safety and fallback. Final pre-run TypeScript and ESLint passed.

## Final real project: STOPPED — NOT READY

Exactly one new real project was created: `7b3e7c76-b9e9-42e0-828c-c46ae423a6ac` (Secure Task Notes). It blocked at Product Owner, with 0/8 tasks complete and delivery NOT_STARTED. The runner stopped on the blocked state. There were zero provider requests, zero Claude calls and $0 paid cost.

Four bounded routing decisions, spaced by the configured 20-second runner cadence, each recorded an empty candidate list and zero model attempts. Product Owner requires GENERAL + REASONING + STRUCTURED_OUTPUT. GPT-OSS-120B was excluded by its inherited three consecutive failures. GPT-OSS-20B had an expired cooldown and two failures, but its persisted qualified capabilities do not include REASONING. All other registry models were unqualified. Thus no eligible model could execute the first task. No fresh 429 occurred: this is an inherited health/capability availability blocker, not a new HTTP failure.

The preflight verified cooldown eligibility but did not check the entire first-task capability intersection against the real registry before creating the project. That was a validation omission; the final attempt could have been identified as unroutable without starting it. It is not grounds to reset health, bypass qualification, alter the task, or launch another project. The three-failure guard remains intact.

No active live spoken briefing, handoff or delivery acceptance was established for this project. Deterministic voice/collision/browser checks remain passed, but do not substitute for those live gates. No full release suite was started because the instruction permits it only after VERIFIED delivery. No cutover, feature push, merge or deployment occurred. Both implementation commits are preserved locally; production configuration is unchanged.

Evidence is local and ignored under `.data/recovery-pilot/`: database, routing decisions, registry snapshot, native speech events, world snapshots, video and stopped screenshot. The absent request log agrees with zero model attempts; no secret evidence is included in source control.
