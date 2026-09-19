# Living Office 2.0 — Levels 2 and 3

Base: e5d9a61a7854a92d0160205bd1950e701c0a269a. Feature work branches from Level 1; no merge, deployment or production configuration changes.

## Audit and Level 2 gate

Reviewed the Level 1 state adapter, registered artwork geometry, task dependencies, attempts/runs, structured remediation events, approvals, honest delivery rules, budget ledger, Office Engineer incidents, existing workspace/actions, local runner and the shared local/remote hydration boundary. No execution policy or separate approval/artifact system is introduced.

Level 2 gate passed before Level 3 implementation: 15 deterministic transition/queue tests and the browser interaction gate. Browser verification measures actual moving packet coordinates, refresh deduplication, static reduced-motion remediation meaning, motion-off cleanup and operations consoles. Existing Level 1 browser scenarios also passed during integration. An initial static SVG motion issue was detected by the movement assertion and replaced with a bounded Web Animations transform with explicit cleanup.

Handoffs require both an actual dependency and persisted predecessor success / successor run. Remediation uses explicit recorded target task IDs. Approval and incident transitions use their existing rows and timestamps. Delivery requires a succeeded release and a verified completed project. Events have stable evidence-based IDs; queue capacity is eight, recent history is capped, and per-project session storage contains only bounded IDs and a timestamp watermark. Hidden/off motion consumes events without replaying stale work.

## Level 3 and visual acceptance

The Command Table lays out actual dependency edges and task states, with active recorded models, progress, blocked/next work, approvals and recorded cost. Manual workstation focus is deliberately restrained (1.035 scale), optional, and disabled for reduced motion. Fresh plan and verified-delivery acknowledgments last 3.2 seconds and are deduplicated across reloads. Existing Premium Agent Workspace, approval actions and delivery/workspace destinations are reused.

Inspected 1920×1080, 1440×900, 1366×768, 820×1180 tablet and 390×844 mobile output. Desktop keeps the approved office artwork; tablet/mobile use the existing readable workstation list with the new consoles, map and feed. Keyboard selection, workspace access, motion pause and reduced motion passed. Browser assertions measured moving packet coordinates over time; this was not screenshot-only animation verification.

## Deterministic validation

- 939 unit tests passed, including 21 new transition, DAG, moment and read-model cases.
- 12 browser tests passed: living office, navigation/authentication and production-disabled shell.
- TypeScript passed. ESLint has zero errors; one existing warning in ignored generated pilot workspace storage.js.
- Production build passed. No production configuration or execution policy was changed.
- Extended fixture run: 170.942 seconds, 300 transitions, eight project switches, six workspace selections, maximum one packet, zero browser errors. Forced-GC heap grew from 5,812,148 to 7,493,408 bytes (+1,681,260). DOM nodes 1,166 to 1,224. Measured main-thread task time 0.921 seconds. These are bounded-session measurements, not a claim of hours-long profiling.
- Observer requests: 72 across repeated navigations; six refreshes in the final stationary 30 seconds. The 1,564 total RSC requests include navigation/prefetch requests and are not polling traffic. Animation frame interval p95: 16.8 ms active, 16.7 ms paused on this machine.

## Real local pilot

Normal UI created exactly one FREE_MULTI_MODEL project, `b489617b-fb2f-42e8-9c7c-641a194cc7a3` (Living Studio — Reading Card), in an isolated ignored local database. The normal standalone runner completed all seven tasks; final status READY_FOR_REVIEW and delivery VERIFIED. No execution-policy modifications or forced failures were used.

The browser observed seven actual handoffs (PO → Architect; Architect → UX and Frontend; UX → Frontend; Frontend → QA; QA → Code Review; Code Review → Release) plus Release → Delivery. Orchestrator WORKING, Frontend WORKING, QA TESTING and completed role states were observed; some very short runs completed between refreshes. The active Premium Agent Workspace opened successfully. No task retry occurred; deterministic cases cover remediation. Eight outgoing requests used Groq openai/gpt-oss-20b and openai/gpt-oss-120b, explicitly owner-confirmed free-tier allowlists. The release run fell back to the second eligible model; no paid route or Anthropic request was allowed. Recorded cost $0; Claude calls zero; browser errors zero. The pilot runner was stopped afterward.

Local screenshots, measurements, request host/model audit and detailed evidence remain under ignored `.data/living-office-v2/` and `.data/living-office-v23-pilot/`; databases, generated credentials and logs are not committed. Initial browser-harness timing failures created no projects; the successful pilot is the only created project.

## Integrity, security and limits

The visual projection makes no model calls, dispatches no Actions and does not manage runner lifecycle. Only allowlisted event descriptions and typed task/run/approval/incident metadata reach the new client view; raw payloads, prompts, run outputs and diagnoses are excluded. Existing authentication and private local/remote read boundaries remain unchanged. Production configuration is untouched; no merge or deployment.

The five-second active refresh can miss intermediate states of very fast runs. Recent transitions are intentionally coalesced/expired rather than replayed exhaustively. Remote snapshots inherit their existing update latency. Large DAGs scroll inside the Command Table. Camera focus is manual rather than automatic. Flattened artwork supports subtle cropped character motion, not skeletal body animation. The stress test lasts about three minutes, not hours. Groq eligibility relies on explicit owner confirmation of the free account; it is not independent billing verification.
