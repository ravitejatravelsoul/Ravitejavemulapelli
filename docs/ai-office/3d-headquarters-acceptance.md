# 3D headquarters — final live acceptance and realism hardening

Base: `50a48849c47def1c7ab812789e9f7701a7567c3c`.
Branch: `feature/ai-office-3d-headquarters-acceptance`.

## Presentation contract

The backend remains authoritative. Workstation status, DAG nodes, briefings, models, attempts, dependencies, costs, incidents and delivery qualification come from the existing safe projection. Visual playback does not hold execution, rewrite task states, call models, or create a second execution system. Current status can advance while a recent transfer is playing; the historical transfer cue does not claim the recipient is still working.

A local presentation queue retains at most **three pending** transitions plus one current animation. It deduplicates IDs (512 bounded recent IDs and a timestamp watermark), consumes the first snapshot without playback, and rejects future/stale transitions. Eligible events must be under **60 seconds old** at enqueue and dequeue. Newest pending events win. An active transfer completes without interruption; newer arrivals replace older pending entries. Hidden/reduced-motion/error/closed/paused states clear visual work, and the first fresh snapshot after a hidden tab is reconciled without replay. Backend polling remains 1.5 seconds locally and 10 seconds remotely, conditional on ETag, with one request in flight and no hidden-tab polling.

Travel lasts 12–40 seconds based on route length, with prepare, outbound, physical transfer, return and dock phases. Smooth interpolation follows the existing collision-tested navigation graph. A visual-only personal-space hold prevents a carrier entering the Boss's immediate space; the owner can step aside. Player collision remains active against agent bodies. The runner never waits for presentation.

Watch is explicitly opt-in through the cue or V. It saves the Boss position, quaternion, yaw and pitch, follows the current transfer, then restores the pose on completion, Escape or Return to Boss. The cinematic camera is not the Boss collision body. Reduced motion suppresses transfers and active animation.

Proximity uses the normal nearest-agent range (2.6m), turns the character toward the Boss and gives a short acknowledgment. The caption expires after eight seconds. A **90-second** per-agent cooldown suppresses repeated greetings unless project/task/status/route/attempt/blocker/dependencies change. E retains the detailed existing briefing and actions. Both briefings are deterministic and use zero inference. Raw task failure content is replaced with a safe summary; authorized details remain in Workspace.

Workstations distinguish thinking, working, testing, reviewing, retrying and warning states with compact local effects. Labels are small dock-level plates. The Command Core uses real dependency edges and task states. Owner displays show actual health, budget, project, approval and incident counts. The existing Engineer health projection drives diagnostic/escalation behavior. Remediation transfers have an amber defect core. Release-to-Vault playback requires the existing strict VERIFIED transition; an unverified/failed/blocked project cannot trigger it.

No browser voice was added. No new role, provider, backend architecture, production configuration, merge or deployment is part of this pass.

## Validation results

The isolated live pilot, snapshots, video, screenshots, database and request audit stay under ignored `.data/headquarters-acceptance-pilot`; no credentials or pilot data belong in Git.

- TypeScript, ESLint and production build: PASS.
- Unit tests: **959/959 PASS**, including 13 headquarters cases. A subsequent focused pass also verifies that unsafe raw failure content is absent from the DTO.
- Existing browser suites: **13/13 PASS** (Living/Classic Office, workspaces, navigation, limited-production safety, V2.1 prototype).
- Headquarters browser: PASS for protected DTO/304/authentication, owner actions, physical walking, active QA fixture briefing, cooldown, exact Boss pose restoration, three remediation transfers, Engineer repair/escalation fixtures, remote 10-second snapshots, stale disabling, hidden reconciliation, mobile fallback and zero external requests. The verified-delivery fixture also passed: Release carried/transferred the core to the Vault, with transfer and completion screenshots. This validates presentation only; the blocked real pilot did not deliver.
- Remote state consumption is validated with a representative snapshot and the existing mode-aware projection. **Live remote execution was NOT tested.**
- Local visual evidence shows the amended north-side development camera avoids the tall workstation screens.

## One real project — result and limitations

Project `36ee5e2f-7312-426b-83e2-eb04d39537ad`, **Headquarters — Reading Desk**, was created through the existing FREE_MULTI_MODEL form. The runner used an isolated database and existing qualification evidence. Claude was disabled; a network guard admitted only configured owner-confirmed Groq free models and OpenRouter `:free` routes. Presentation-server model credentials were blank. No production/default-database project was executed.

Result: **BLOCKED**, 2/7 tasks completed, delivery **NOT_STARTED**. Orchestrator, Product Owner, Solution Architect and UI/UX were observed active. PO and Architect succeeded. UI/UX exhausted free routing after repeated `openrouter response included no message` failures; the last failure recorded no eligible enabled/healthy free model. The world truthfully displayed retries and BLOCKED. No project state or provider response was fabricated or slowed.

Eleven guarded external requests used Groq `openai/gpt-oss-20b`, Groq `openai/gpt-oss-120b`, and OpenRouter `nex-agi/nex-n2.5-mini:free`. **Recorded paid cost $0; Claude calls 0.** Groq eligibility remains owner-confirmed free tier, not an independent guarantee about the account. No paid route or second real project was attempted.

Captured detailed briefings exactly matched their protected world-state revisions:

- PO, THINKING, revision `269377ac5469f90b3eef7a5cc3f06b762f039cb9fba90b389ec71d93dd5b4147`: requirements task, Groq `openai/gpt-oss-20b`, attempt 1.
- Orchestrator, WORKING, revision `29455bf2d8364567902bc481866456e46d5f6f235ecf051c346d586131f407a0`: 2/7 tasks complete, two active roles, zero approvals.
- Developer: owner walked to the station, but the task never became active; the active-briefing wait timed out. No completed live briefing assertion is claimed.
- QA: never became TESTING, so the required live walk/briefing could not occur. Its deterministic active fixture passes, but does not satisfy real acceptance.

## Genuine physical handoff evidence

Transition `handoff:37d2e1c4-bfa6-4973-ad41-bbc7c9d23b75:5b242d2b-d48e-42e8-a276-05f933959db2` proves **Solution Architect → UI/UX attempt 2**. Timestamp: **2026-09-23T03:32:35.826Z** (September 22 local time).

The persisted predecessor run `5b242d2b-d48e-42e8-a276-05f933959db2` completed before dependent run `37d2e1c4-bfa6-4973-ad41-bbc7c9d23b75` started. The source was captured actively WORKING in `before-architect-active.png`. The real retry handoff has prepare/travel/transfer/return/dock frames `transfer-2-*.png`: physical transfer at 03:32:44.974Z; return at 03:32:47.212Z; dock at 03:32:51.260Z. The receiver was authoritatively **RETRYING with an active run** through the complete transfer and return, with its retry workstation effect. This is evidence of a genuine retry handoff, not evidence that UI/UX succeeded.

The earlier PO → Architect handoff also visibly transferred its core, but the fast Architect task had completed by transfer time. It is not represented as an after-transfer active-task proof. Five distinct real attempt handoffs were observed; duplicate IDs were not replayed.

## Performance and safety

Single-view pilot observation after the second camera closed: **60 FPS**, 334 draw calls, about 140k visible triangles (view dependent). Simultaneous recording/browser checks measured roughly 36–42 FPS in some frames; 60 FPS is not claimed under that concurrent workload. Pilot heap after forced GC: 30,536,164 → 30,526,168 bytes over 20 seconds. This is a short smoke measurement, not a long-duration leak guarantee.

Maximum safe DTO: **21,342 bytes**. Loaded page JavaScript: 23 resources, **559,232 encoded bytes / 1,952,011 decoded bytes**, including the page runtime, not solely 3D code. Local polling remains 1.5s with conditional 304 responses; remote fixture cadence is 10s; hidden tabs stop polling. Observed pending queue max: **1**; deterministic stress bound: **3 pending + 1 current**.

Configured-secret scan of changed files and 70 client assets: zero matches and no forbidden paths. Raw failure text is excluded; only a safe summary reaches greetings. API keys, env files, databases, logs, generated workspaces and recordings remain ignored. Classic Office and production configuration remain unchanged. No merge, deployment, real remote execution or extra inference for greetings occurred.

## Final acceptance

**NOT READY for owner final acceptance of the complete live workflow.**

Exact remaining gaps: the authorized real pilot blocked before Developer/QA/Code Review/Release; no real active QA briefing, successful delivery, or real Release → Vault ceremony was observed. The complete captured handoff is an active retry handoff, not a successful downstream completion. Fixture checks cannot substitute for those real-run requirements. No second real project was launched to conceal the failure. Owner/ChatGPT review and a separately authorized follow-up are required before claiming full live acceptance or considering a merge.


## September 23 — free execution blocker investigation

Follow-up base: `bdaf2486d42d214e91a3c267d6f950cdc6e09edc`. No Headquarters presentation code changed.

The failed pilot's persisted registry showed both Groq GPT-OSS models still enabled and qualified, but UNAVAILABLE after three consecutive failures. Neither had a rate-limit cooldown. All three OpenRouter attempts consumed exactly 1,024 completion tokens. The historical request events did not retain HTTP envelopes or per-candidate error codes, so the original Groq errors cannot be reconstructed conclusively.

Bounded reproduction of the same UI/UX context established:

- Groq 20B and 120B returned HTTP 400 `json_validate_failed` at the 1,024-token limit (request IDs `req_01m3743qj6egptzk11xnr6970j` and `req_01m3743sa9e3ntfpz78yq8f809`). A further 20B diagnostic succeeded at the old limit: the failure is intermittent, not a deterministic claim that every Groq response truncates.
- OpenRouter returned HTTP 200, `finish_reason: length`, null final content and 1,024 completion tokens (`gen-1790166822-5ZOGSYDJHiCWH1pz5j2k`). Its reported reasoning count was 1,282; this inconsistent provider count is retained as reported, not added to completion usage. Reasoning is never treated as final content.
- The corrected free output budget is the existing capability output ceiling plus a bounded 4,096-token reasoning reserve. The same total is used by context-fit routing, telemetry and the actual request. No retry count changes. Standard/paid and direct Ollama budgets remain unchanged. Groq then produced valid complete answers using 933 and 1,775 completion tokens.
- A larger ceiling alone did not repair Nex Mini: at 5,120 tokens it still returned `length` and null content (`gen-1790167353-0bgbKIVz0YOGKP7xFVi9`). Live model metadata reported default reasoning `high`, with supported efforts `high`, `medium`, `none`.
- Local-only settings now explicitly use `AI_OFFICE_OPENROUTER_REASONING_EFFORT=none` and `AI_OFFICE_OPENROUTER_JSON_SCHEMA_MODELS=nex-agi/nex-n2.5-mini:free`. The adapter sends OpenRouter's `reasoning.effort` object. JSON-object mode with no reasoning produced an invalid contract and was correctly rejected. With the supported JSON-schema mode, the same UI/UX request completed validly in 854 completion tokens (`gen-1790167510-Gzv1PWzIAuWh7tZbWSED`). These settings are specific to this validated local model configuration; other models require their own supported settings and qualification. Production settings were not touched.

The adapter accepts string or final text-part content, but rejects empty, reasoning-only, refusal, provider-error, tool-only and truncated generations, even if truncated JSON happens to parse. Safe request metadata (HTTP status, response/request IDs, finish reason, output ceiling and reported reasoning count) survives in `model.request`; prompts, answers, hidden reasoning and raw provider errors do not.

The three-model registry and historical benchmark evidence were copied from the failed isolated pilot, preserving failure health. The existing focused benchmark workflow then reran `instruction-json` and `reasoning-order` once per model. Groq 120B passed both. Groq 20B passed the instruction check but failed reasoning, so it lost REASONING capability. Nex Mini passed reasoning but failed the exact instruction check and became UNQUALIFIED. No failed qualification was overridden or rerun to obtain a pass. Health recovery for eligible Groq models came from actual successful benchmark responses.

Reference: [OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [Groq structured outputs](https://console.groq.com/docs/structured-outputs). Private diagnostic envelopes, benchmark records and API request audits remain under ignored `.data/free-blocker-*` and `.data/headquarters-blocker-fix-pilot`. They contain no credentials in the saved diagnostic metadata and are not Git artifacts.

## September 24 — single real follow-up result

Final validation: **38/38 targeted provider/router/context tests; 965/965 AI Office tests; 14/14 browser tests; TypeScript, ESLint and build PASS.** The first prototype browser run was cancelled by its timeout across the long interruption; the same prototype suite passed on an uninterrupted rerun (301.6 seconds). No other test failure was hidden. Configured-secret scan: eight changed tracked files and 70 client assets, zero matches. Generated build-only tsconfig additions were restored.

Exactly one new project was created through the normal local FREE_MULTI_MODEL form: **`8be6b869-16ae-48d8-a1db-3de91c34cadd`, Headquarters — Focus Counter**. It produced the requested small counter webpage and naturally completed all seven tasks: PO, Architect, UI/UX, Developer, QA, Code Review and Release. Final state **READY_FOR_REVIEW**, delivery **VERIFIED**. No forced states, fake responses, qualification overrides, paid fallback or increased retries were used.

Nine external model requests used Groq GPT-OSS-120B (eight) and GPT-OSS-20B (one). Developer attempt 1 encountered two malformed structured answers, including an array where the contract requires an object. Both failures remained failures and their usage was recorded. The existing bounded retry completed Developer attempt 2 on 120B; the failure was resolved normally. The remaining tasks succeeded on 120B. OpenRouter was not used in this project because its focused requalification had failed. **Claude calls: 0. Recorded paid AI cost: $0.** No project execution blocker remains.

Live protected snapshots and video prove Developer WORKING, QA TESTING, Code Review REVIEWING and Release WORKING. Developer's direct live briefing assertion matched revision `79192cb38e97a91b8eb30786fdf625ac22d50af40cb113fa137899498524403e`.

The initial QA observer assertion raced between pages: one page had received TESTING while the briefing page still held QUEUED. That assertion remains recorded as an observer error; it was not erased. The open briefing then updated naturally. Review of the actual recording at **09:11:14 local / 14:11:14 UTC** proves the visible TESTING briefing, exact task, Groq 120B, attempt 1/3, RUNNING record and 2,941 tokens. Its full visible greeting was transcribed and checked against the saved authoritative snapshot **`6659c07c108da1d37b501974173300217a1de3bcfcfa7e3b5e059c94efc6598b`**, observed at 14:11:12.572 UTC. This is a recorded real-run match, not a fixture or a later rerun. Evidence: `qa-briefing-testing-video.png` and `qa-video-revision-match.json` in the ignored pilot folder.

A real successful downstream handoff is recorded in the main video at approximately 190 seconds: **Frontend Developer → QA, transfer phase, 09:11:29 local**, while QA was still actively testing. Developer had succeeded at 14:11:07.774 UTC; QA then succeeded at 14:11:31.725 UTC.

The real Release generated VERIFIED delivery transition `delivery:8589d3d1-202f-49eb-932e-4f759a9a8d97` at **14:11:38.845 UTC**, and the Vault displayed the real delivery. However, a completed physical **Release → Vault ceremony was NOT observed**. The main recording instead shows the preceding Code Review → Release carrier held at the Boss's location (`Owner nearby — keeping personal space`, around 270 seconds). The second observer stayed in its QA briefing after its initial assertion failed, so it did not supply independent ceremony evidence. A delivery event or static Vault item does not substitute for the requested completed ceremony.

| Acceptance item | Result |
| --- | --- |
| Developer active | PASS |
| QA actively TESTING | PASS |
| QA Boss briefing grounded in authoritative revision | MATCH — recorded-frame cross-check; initial observer assertion race disclosed |
| Code Review active | PASS |
| Release active | PASS |
| Successful downstream handoff | PASS — Developer to QA, followed by successful QA completion |
| Real VERIFIED delivery | PASS |
| Real Release → Vault ceremony | FAIL — not completed in captured observation |

**FINAL: NOT READY.** Free execution reached VERIFIED delivery; the remaining acceptance gap is the complete real Release-to-Vault visual ceremony. No second project, state replay, new Headquarters change, master merge or production change was made. Local observer/server/runner processes were stopped at the end of capture. All pilot databases, workspaces, videos, response audits, credentials and `.env.local` remain uncommitted under ignored paths. This phase stops here with that limitation explicit.


## September 24 — bounded visual ceremony follow-up

Base: `7d6f8fe43f4bc2b10683e62cea144368636b507f`. This follow-up changes only Headquarters presentation and its deterministic tests. No model request, project execution, routing change, backend state change, production configuration change, merge or deployment.

The visual deadlock came from adding personal-space holds to `pausedMs` every frame without a bound. A blocked carrier could remain current forever; its queued delivery could then expire under the 60-second freshness rule. Backend execution was already complete and was never the cause of this remaining gap.

Carriers now wait 1.2 seconds, try a bounded collision-checked offset route, and safely send the core above head height after four seconds of accumulated obstruction if no route is available. A 50-second movement deadline also bounds repeated detours. Agents keep their last safe body position and attempt a safe return; a blocked return parks without teleporting. Swept Boss clearance is 1.15 meters; other agents and padded furniture are checked too. An admitted VERIFIED delivery is prioritized and retained while a predecessor resolves. New/stale-event admission, initial-history consumption and event-ID deduplication remain enforced. Delivery presentation additionally requires a matching VERIFIED project in the authoritative delivery list. No backend transition is created by this animation.

Presentation-only review reuses project `8be6b869-16ae-48d8-a1db-3de91c34cadd` and unchanged event `delivery:8589d3d1-202f-49eb-932e-4f759a9a8d97` (original timestamp 14:11:38.845 UTC). The private browser harness reads a copy of the existing pilot database, releases the actual recorded transition IDs to the visual queue, and offsets only browser Date for freshness. It does not rerun tasks, alter delivery status or modify persisted events. A banner identifies the recording as a presentation replay. External/model requests and browser writes are blocked and audited.

With Boss at the preceding Code Review-to-Release path, the actual handoff safely resolved and the queued real delivery completed: Release carried its core toward the Vault, transferred it, the receiving pedestal signaled, the verified core appeared, Release returned and the queue emptied. Both animations together took 16.0 seconds; observed carrier-to-Boss clearance stayed at least 1.2096 meters. Actual movement, transfer and final placement screenshots/video are under ignored `.data/headquarters-ceremony-review/blocked-predecessor-*`. The original project's VERIFIED label remains visible. These are actual-event presentation replays, not a new live AI run.

Validation: **18/18 targeted Headquarters tests; 970/970 AI Office tests; 14/14 browser/E2E tests; TypeScript, ESLint and build PASS.** Deterministic tests cover safe detours, occupied destination, bounded predecessor plus queued delivery, completion without body teleport, stale refresh, deduplication, and rejection of FAILED/DONE/BLOCKED delivery events. The browser replay initially encountered a Playwright clock-instrumentation problem; a Date-only offset resolved the harness issue. The first walk to the second obstruction position was correctly stopped by Release's body; the observer route was adjusted around it. Neither issue changed backend state or triggered model calls.


Direct Boss obstruction of Release was also validated in the real browser using the same existing delivery event. Boss stood at approximately `(11.5, -14)`. Release advanced toward the Vault, held at its last safe position, attempted offset navigation, and used the overhead core transfer when the occupied destination remained unavailable. The ceremony completed in **8.433 seconds**, with **minimum observed clearance 1.1689 meters**, no solid intersection, one delivery start and an empty final queue. The body remained safely parked; it did not walk through Boss or teleport. Captured transfer and dock frames show the receiving pedestal pulse and final verified core. This is distinct from the predecessor replay, where the new solid checks can resolve an obstructed carrier before it reaches Boss.

Repeated polling of the same event did not replay the ceremony (the direct obstruction test asserted an empty queue every 100 ms for 12 seconds). Refresh consumed historical events without replay. Both scenarios recorded zero browser errors. Their IDs, traces, results and videos remain in ignored `.data/headquarters-ceremony-review`; `results.json` records both completed scenarios. The fixture-free ceremony evidence is the original real VERIFIED project/event. Unverified-event rejection is additionally covered by deterministic and existing browser guard tests.

The final cleanup audit initially encountered SQLite `SQLITE_IOERR_DELETE` immediately after stopping the isolated server. A fresh read-only audit after shutdown passed `PRAGMA integrity_check` for both databases and confirmed **every logical table unchanged**, with source and copy both matching the pre-review SHA-256 `8b84695aacf2f63e28db4dcf17c6629292b1ba2d25c8c674696c4c3703f35a78`. Audit: `final-integrity.json`. **AI/model calls this phase: 0; project executions: 0; production changes: NONE.** No external request or browser mutation was allowed. Secret scan of eight changed files and 70 built client assets passed with zero matches and no forbidden paths; generated tsconfig additions were restored.

| Final visual acceptance item | Result |
| --- | --- |
| Boss obstruction, personal space, no collision or indefinite hold | PASS |
| Release moves toward Vault; safe send when destination occupied | PASS |
| Vault receiving activation | PASS |
| Verified Project Core placement | PASS |
| Ceremony finishes and queue empties | PASS — both actual-event replays |
| Verified-only guard | PASS |
| Duplicate suppression | PASS |
| Stale refresh replay prevention | PASS |

**FINAL: READY FOR OWNER/CHATGPT FINAL REVIEW.** The prior real project's completed roles, QA briefing match and VERIFIED delivery remain as documented above; this authorized presentation-only phase closes its final visual gap. No new AI project, model call, backend replay, master merge or production deployment occurred. Review evidence and credentials remain uncommitted. Stop after pushing the same feature branch.
