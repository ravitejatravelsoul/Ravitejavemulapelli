# 3D headquarters integration — audit and plan

Base: d725bcbb70beaae7295fcc240d067405c6bff172. Remote master is b1775117daf1b297900e5c4458493acefaf7b893 and is an ancestor. Approved V2.1 already includes the free-model baseline and Living Office levels 1–3. Preserve both approved branches; no merge/deployment.

## Audit

- getOfficeDb is the existing local/remote read boundary. Remote mode hydrates authoritative GitHub project bundles; local uses the durable SQLite DB. The protected layout and each action independently verify sessions. Disabled production renders the limited shell.
- getOfficeFloorView / mapAgentVisualState already derive the eleven catalog roles from tasks, attempts, leases, project pause and approval state. Provider/model come from persisted runs, never project routing policy. AgentWorkspace is driven by /office?project=...&agent=... and remains intact.
- getOfficeInteractionView / deriveOfficeTransitions prove handoffs using dependency edges, successful predecessor runs and started successor runs. Remediation targets come from persisted failed-run events. Existing queues establish bounded identity and stale-event rules.
- createProjectAction owns validation, FREE_MULTI_MODEL selection and deterministic planProject. The independent runner owns task execution, leases, retries, QA/security/review remediation and release verification. No browser animation may call or pause it.
- Approval actions already route local/remote writes through exact-scope, idempotent domain services. Office and project controls are existing authorized actions. Human escalation remains with its existing service.
- Budget, model registry/routing decisions, incident records and workspace delivery state are persisted read sources. Office Engineer is a separate maintenance capability. VERIFIED delivery must also have an eligible completed project and completed tasks before displaying a completed core.
- V2.1 world-campus is presentation configuration only. The approved environment/city remains static; dynamic actors and contextual panels are a separate layer. Classic Office, mobile and non-WebGL paths must remain available.

## Integration sequence

A. Add an explicit allowlisted world DTO and authenticated, no-store conditional read endpoint using getOfficeDb. Local visible polling every 1.5s; remote at 10s to respect existing snapshot architecture; hidden tabs stop. Content revision enables unchanged responses. Current truth plus bounded recent evidence handles missed events without replaying history.
B. Configure all seeded roles plus Office Engineer on the approved floor. Reuse bot design with role equipment; generic IDs and campus slots retain expansion support.
C. Reuse proven transition evidence for bounded physical/holographic handoffs. Keep animation state ephemeral and independent of execution.
D–H. Deterministic owner greetings/briefings, existing workspace/history links, real Command DAG, Owner approvals/budget/control, Infrastructure models/incidents, verified-only Delivery and existing new-project workflow. No new orchestration or inference for interaction.
I. Test safe DTOs, mapping, placement/navigation, briefing grounding, transitions/reconciliation, delivery/incident/approval/model/budget semantics; unit, browser, typecheck, lint and build. Run one authorized free-only local project with Claude disabled; preserve real evidence and report any actual failure honestly.

The new route remains opt-in until full parity and owner review. Classic Office is not removed and production configuration remains unchanged.


## Implemented boundary and interaction

`/office/headquarters` is an opt-in authenticated view. `/office/headquarters-state` projects safe display fields using the existing mode-aware DB boundary. It performs no inference, worker dispatch, or repairs. Its SHA-256 ETag omits observation time; 304 responses avoid resending unchanged DTOs. This is conditional snapshot polling, not a field-level patch protocol. Visible cadence is 1.5 seconds locally and 10 seconds for remote snapshots, with one request in flight. Hidden tabs stop polling. Reconnection synchronizes current truth without replaying history. Model cooldown expiry changes the revision even without another recorded model call.

All eleven seeded roles and the separate Office Engineer have configured placements and distinct equipment. The approved campus definitions and 20/60-agent expansion fixtures remain intact. Future roles need presentation configuration; no domain roster is duplicated. Static environment geometry is memoized separately. Changed actor DTOs preserve unchanged object identities. Physical DAG nodes are capped at 24, task details at 200, project choices at 100, recent events at 100 and retained transition identities at 256. The vault displays three physical cores and the latest 30 verified projects with a full archive link.

A handoff uses the existing dependency/run evidence, then a 12-second local movement/transfer/return sequence. Only newly observed transitions younger than 20 seconds are candidates. Rapid transitions are coalesced instead of queued indefinitely. Closed, paused, hidden, stale and reduced-motion states stop operational movement. Animation never mutates a task or gates the runner. The actor carries a core to the receiver, followed by a brief transfer into its workstation. Remediation uses the same existing QA/security/code-review evidence rather than invented events.

Agent briefings are deterministic text assembled by `agentBriefing`; this pure function and the panel's explicit interaction boundary are future voice/conversation extension points. No TTS service or conversational inference was added. The Command Core reuses `NewProjectForm`; owner controls call the existing office, project and approval server actions. Workspace links reuse the existing Premium Agent Workspace. Project detail now honors supported workspace/activity/technical query tabs. The classic dashboard remains the primary entry pending complete acceptance and owner approval.

## Validation, 2026-09-21

- TypeScript: PASS. ESLint: PASS. Production build: PASS, isolated `.next-e2e-hq` output.
- AI Office unit tests: **954/954 PASS**, including eight new headquarters tests. Coverage includes DTO redaction/no inference, persisted task/run/model/attempt/cost fields, approval services, incident states, verified-only delivery, handoff/remediation/reconciliation, placement/navigation, remote projection, fallback telemetry, budget and cooldown expiry.
- Existing browser suites: **13/13 PASS**. Includes Classic/Living Office and all agent workspaces, production lockdown, narrow-screen project tabs, extended polling/memory checks and full approved V2.1 exploration/collision/demo/mobile/WebGL regression.
- New headquarters browser suite: **1/1 PASS** against an isolated production server with all model credentials blank and no runner. Actual existing pause/resume, approve/reject and open/close actions, persisted handoff ingestion, incident/model/vault panels, 304 responses, unauthenticated denial, stale-state action disabling, mobile fallback and hidden-tab polling were checked.
- Headquarters heap after forced GC: 28,762,128 to 28,999,356 bytes during a short 20-second observation with 14 visible polls (+237,228 bytes). This is a smoke measurement, not a long-duration leak guarantee.
- Real local pilot projection max: **21,466 bytes**; unchanged replies have no JSON body. Standalone Chromium observations around **60 FPS**; entry view approximately 722 draw calls / 300k triangles, varying with camera/culling. The Codex embedded browser varied around 31–60 FPS while other tests were running; that is not a controlled benchmark.
- Screenshots were inspected and the embedded-browser command/infrastructure panels used directly. Embedded-browser pointer capture is blocked; full walking tests used Chromium. The UI explains the Chrome/Edge option. Mobile and non-WebGL users retain Classic Office.

## Single real free-model acceptance project

Project: `95322a93-6a58-400c-82b3-a573f6a2aaa0`, **Headquarters — Reading Card**.

Created through Command Core → Start New Project → the existing FREE_MULTI_MODEL form. Isolated ignored database/workspaces under `.data/headquarters-pilot`; the user's existing active projects were not executed or changed. Existing registry and qualification evidence were copied into the isolated DB. Claude was disabled and a fetch guard allowed only configured owner-confirmed Groq free models or OpenRouter `:free` routes. The presentation server had model credentials blank. Eight external requests were logged by host/model only.

Result: **READY_FOR_REVIEW**, delivery **VERIFIED**. Seven tasks succeeded: Product Owner, Solution Architect, UI/UX, Frontend, QA, Code Review, Release. Each used task attempt 1; QA needed two routing attempts. Selected models were Groq `openai/gpt-oss-20b` and `openai/gpt-oss-120b`. No OpenRouter model was selected in this run. Recorded AI cost **$0**, Claude usage **0**. No real remediation was induced; QA/security/code-review remediation was tested with fixtures. The independent runner completed without browser lifecycle control and was stopped after terminal completion.

Four newly persisted real handoffs were consumed by the world: PO → Architect, Architect → Frontend, Frontend → QA, QA → Code Review. Their IDs were matched to the existing persisted transition projection; the browser did not invent them. Initial Orchestrator, PO and Frontend briefings were matched exactly to the received server revision. QA and Architect completed-work briefings were subsequently matched against the same real project's recorded task/run/model/attempts. The initial straight walking route hit the architect's real collision volume; the corrected tour used the side aisle, and UI/UX and Office Engineer placements were adjusted to preserve side-aisle clearance, with a regression test against docked-actor collision volumes. A corrected release-area walk reached the Release Agent and its Open Workspace action reached the existing Premium Agent Workspace. Delivery Vault → Open Workspace was also used directly in the embedded browser and the existing Workspace tab was selected correctly.

### Acceptance limits — do not overstate completion

The strict during-execution visual acceptance is **not fully satisfied**: the QA conversation was captured after project completion, and the real handoff screenshots were partially obscured by the released-mouse menu rather than documenting the entire source/core/receiver motion. Persisted handoff ingestion and deterministic motion tests pass, but those are not a substitute for the requested complete visual observation. No second real project was started to hide this gap: the brief authorized one. This remains a specific owner-review/acceptance item. The integration stays opt-in and must not replace Classic Office yet.

Remote mode uses the existing snapshot/action boundary and is covered by projection/regression tests; no live GitHub Actions execution or deployment was performed. Long-term GPU/memory behavior, subjective visual approval and full during-run owner walkthrough remain review items. No voice, extra playable floors, new orchestrator, new inference path or production configuration was added.

## Security and delivery

Safe DTOs exclude raw prompts, model outputs/reasoning, incident diagnosis/repair payloads, workspace files, credential-bearing event payloads and secrets. Configured secret values embedded in display text are redacted. Compile/client and changed-file scans checked actual configured secret values without printing them: PASS, 23 changed/new files and 70 client build files, zero secret matches or forbidden paths. API keys, `.env.local`, databases, request logs, generated workspaces and pilot evidence remain ignored. Test build directories and private `.data` artifacts are excluded from lint/commits.

Production configuration: **NONE changed**. No merge, manual deployment or remote worker run. Branch is for owner and ChatGPT review only. Final acceptance status: **NOT READY for claiming every requested real-time visual acceptance criterion**; implementation and deterministic regression are available for review.
