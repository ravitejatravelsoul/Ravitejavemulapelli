# Living Office 2.0 — Level 1

## Audit and scope

Base: master b1775117daf1b297900e5c4458493acefaf7b893. History reviewed: initial Living Office, the 2.5D scene, approved-art integration (848d0e6), Premium Agent Workspace (925c730), Office Engineer, unified local/remote shell, and free-model foundation.

The private `/office` page already composes project/DAG, tasks, attempts, agent runs, event/activity feeds, approvals, budget, workspace/artifacts, and Office Engineer health. The 11 roles come from the existing seeded catalog. Office Engineer remains a maintenance service and header control, not an invented twelfth worker. The URL's project and agent parameters select the project and existing Premium Agent Workspace. Authentication remains in the protected layout and independently authenticated actions. The public portfolio does not consume the new read model.

Local mode reads SQLite; Remote Mode hydrates the private GitHub runtime bundle through `getOfficeDb`. Both use the same projection. Visualization does not execute tasks, dispatch GitHub Actions, create approvals, sync models, benchmark, or call inference. Existing runner, budget gates, model registry and qualification, Claude kill switches, and artifact delivery are preserved.

## Rendering decision

Layered DOM and CSS transform/opacity animation reuse the approved 365 KB WebP. No renderer dependency, additional bitmap, video, or second office illustration. The background and small character fragments share the original optimized WebP in the browser cache. Native artwork coordinates register the character crops, monitor polygons and labels to the same aspect ratio as the existing hotspots. Heads sit above monitor overlays. SVG was evaluated during implementation; small composited DOM layers give simpler animation and accessibility without a game engine.

DOM buttons preserve keyboard navigation, state labels, selection and the existing URL-driven workspace. The monitor/character animation is decorative; text and icons carry all operational information. Tablets/phones use the existing workstation list with live summary, actual model and attempt detail. Desktop has task/model inspection on hover and focus, without obscuring the scene. A motion toggle, hidden-tab pausing and reduced-motion CSS apply to the scene.

## Authoritative state contract

`office-visual-state.ts` is the pure state adapter. `office-floor-data.ts` supplies persisted evidence; renderers consume its normalized states. Unknown task states are neutral IDLE. Current tasks take precedence over historical tasks for a role. DONE lasts 15 seconds, then returns to IDLE while retaining last-task information. QA is TESTING, security/code review is REVIEWING, product/research analysis is THINKING. Active later attempts are RETRYING. Dependency-ready work is QUEUED; dependency/approval waits are WAITING. Expired leases do not advertise active execution. Blocked, failed and paused states do not animate typing.

The Orchestrator reflects real planning, running tasks, approval waits and blockers. It never claims a model. Active-provider counts exclude the command desk and historical completed runs. A project's routing policy is not a selected model: provider/model labels require a real run. The one execution-adjacent change records each fallback candidate in its existing agent-run row immediately before invocation, so observers can see the actual in-flight provider; selection, budgets and retry policy are untouched.

Stable role IDs, task IDs, attempts and normalized states form the extension contract for a future transition consumer. Level 2 task movement and Level 3 cameras/sequences are not implemented.

## Refresh and safeguards

Reuse AutoRefresh: 5 seconds while projects are active or a completion signal is visible, 30 seconds when idle. Hidden tabs skip refresh; CSS motion pauses through one visibility listener with cleanup. The office can open from idle and discover background work. Closing the browser has no execution effect. Remote mode retains its existing background worker and read-only hydration boundaries.

Test fixtures are created only in disposable E2E databases. There is no production demo mode, fixture route, or randomized activity. Screenshot/runtime evidence stays in ignored `.data/living-office-v2`; credentials are never rendered or committed.

## Verification and performance

Deterministic tests cover all normalized states, exact run/task/attempt mapping, all 11 workstation identities, unknown states, lease expiry, approval waits and completion settling. Disposable browser fixtures exercise idle, PO thinking, architect/Groq, frontend/OpenRouter, QA testing, security reviewing, backend blocked, developer retry 2/3, release done, simultaneous activity and owner approval. Keyboard selection opens every existing Premium Agent Workspace. Reduced motion, manual pause, visibility changes, background refresh and zero console errors are asserted. Screenshots are reviewed at 1920×1080, 1440×900, 1366×768, 820×1180 and 390×844.

A pre-existing page transition left a full-page blur(0px) filter behind. With animated descendants this caused 83 ms p95 frames in local Chromium. The transition now clears its filter after entry, preserving the entrance effect; active and paused scenes both measured 16.7 ms p95 afterward. No perpetual JavaScript animation loop was added. Idle workstations have no operational animation. Listener/refresh cleanup and repeated route/workspace changes are covered by browser tests.

On the same 10-task, persisted-run fixture over 1,000 warmed projections, the old read model averaged 0.536 ms (p95 0.877 ms); the new model averaged 0.637 ms (p95 1.094 ms). The extra dependency/approval mapping adds approximately 0.10 ms per refresh. These are local measurements, not a cross-device performance guarantee.

## Level 1 limits

Refresh samples every five seconds while active and every thirty seconds at rest; very short executions may complete between samples. Remote updates also depend on the existing private runtime snapshot cadence. THINKING/TESTING/REVIEWING are role-and-task projections, not inferred model thoughts or fine-grained progress. The approved flattened artwork supports subtle registered head and monitor motion, not independent limb animation. Tablet/mobile intentionally use the simpler workstation list.

## Real free local validation

One isolated FREE_MULTI_MODEL project, 60861174-ce29-4dc8-ac83-35c268a385ec, used the normal planner and runner. Thirteen Groq requests and one OpenRouter free-route request were recorded; all fourteen usage entries total $0. Groq models were openai/gpt-oss-120b and openai/gpt-oss-20b; the OpenRouter fallback was nex-agi/nex-n2.5-mini:free. Claude remained disabled and its request count was zero. Registry/qualification evidence was copied from the existing local office; the pilot's DB, workspaces and synthetic observer credentials were isolated from the owner's office.

The browser captured 26 distinct persisted-state snapshots, including thinking, working, testing, retrying, done, queued, waiting and blocked; the existing Premium Agent Workspace opened successfully. The pilot did **not** deliver a completed project: QA/remediation exhausted the existing bounded workflow and left frontend BLOCKED. The final office reflected that real blocked state. This is a delivery failure, not a claimed successful end-to-end project; no orchestration remediation policy was changed for this visualization phase.

Validation: TypeScript PASS; ESLint zero errors and one pre-existing warning in an ignored generated workspace file; 918 unit tests PASS; 9 browser tests PASS; production build PASS. No deployment, production configuration change, merge, new renderer dependency, committed runtime database, or committed secret.
