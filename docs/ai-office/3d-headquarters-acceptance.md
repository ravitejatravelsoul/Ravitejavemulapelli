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
