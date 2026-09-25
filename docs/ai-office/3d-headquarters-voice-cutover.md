# Voice Headquarters release gates

Base: `198afe400cc1c38ab8b508603438cd4e05153e72`.
Branch: `feature/ai-office-3d-headquarters-voice-cutover`.

## Presentation architecture

The existing sanitized world DTO feeds the existing deterministic briefing. That exact string, with its authoritative revision, is both the subtitle and the browser utterance. No prompt, provider response or extra inference is used to generate speech. Full briefings pin their spoken revision while playing; Ask for Update cancels it and refreshes the existing projection.

Role profiles configure rate, pitch, language and character. Voice selection accepts only `localService === true`, prefers the briefing language and a local default, then uses a stable voice URI ordering. It never falls back to a remote/default engine voice. If no local voice is exposed, the browser API is missing or playback fails, subtitles continue. [Browser local-service semantics](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

One controller owns at most one utterance. New proximity replaces stale speech, detailed interaction has priority, and walking away, hiding the page, closing a panel, disabling voice or leaving Headquarters cancels it. Existing semantic greeting cooldown remains. Start and total playback watchdogs bound broken browser engines; cancellation detaches utterance callbacks and clears timers. All document, page and voice-list listeners are removed on unmount.

Voice is initially enabled on this acceptance branch and its on/off preference is stored only in browser localStorage. Both the world and full briefing panel offer Voice and Stop Speaking controls. Native speech requires normal user interaction. A speaking agent has a subtle body/head and arm motion; reduced-motion settings suppress this animation while keeping text and voice accessible. Existing handoff, movement, execution and delivery queues remain independent of audio.

## Validation record

Native installed Edge exposed local Microsoft David, Mark and Zira voices. A real native utterance using a local voice emitted start and end events successfully, with audio unmuted. Headless Chromium exposed no voices; subtitle fallback is expected there. Deterministic browser mocks are used only for repeatable regression and are not live voice acceptance evidence.

26 targeted Headquarters tests pass, including eight controller/profile/preference/sanitization tests. Final browser, real-project, regression and cutover outcomes will be recorded below. No routing cutover or merge is authorized by implementation tests alone.

## Final attempt — stopped, NOT READY (2026-09-25)

Exactly one real project was created: `263595df-3ae9-4dfc-92b2-d6d12e1439b7`, Secure Task Notes. Its normal FREE_MULTI_MODEL runner reached BLOCKED; delivery is FAILED, not VERIFIED. Runner stopped immediately on the blocked projection. No replacement project, backend-state override, qualification bypass, routing change, cutover, merge or deployment was performed.

PO, Architect and UX completed. Developer executed and was reopened by two actual QA failures; QA was observed TESTING. Security, Code Review and Release never executed. Groq `openai/gpt-oss-120b` and `openai/gpt-oss-20b` were used. Recorded paid AI cost is $0; Claude calls are zero. Speech itself made no model calls.

QA twice rejected the candidate for missing demonstrated persistent notes, editing/deletion and validation. During the following Developer repair both models returned HTTP 429 (`rate_limit_exceeded`): 20b request `req_01m3cdg7x1eq8repezg2v7zcgr`, 120b request `req_01m3cdg82hegxr7ay6pphd1zag`. Both qualified models were UNAVAILABLE with active cooldowns. The next routing decision made zero provider attempts and reported no eligible enabled/healthy free CODING model. Safety gates remained intact; this report does not attribute the provider rate limit to voice.

Native local Edge speech for the active Orchestrator matched the exact subtitle and authoritative revision. Its screenshot shows 59 FPS. The live walk failed to capture required specialist speech: the scripted route collided near PO (-10.22, 5.19), then at (-4.98, 1.04), and a Resume exploration interaction timed out. Short early roles completed during these delays. These are acceptance failures, not proof of specialist voice success. An early real handoff transfer frame was captured, but the complete acknowledgement/receiver-active sequence was not established. No real VERIFIED delivery or Release-to-Vault ceremony occurred.

Evidence remains local and ignored under `.data/voice-cutover-pilot/`: SQLite database, sanitized request log, native speech event log, authoritative projections, video, screenshots and report. No database, credentials or raw evidence logs are committed.

Validation before the real run: 26/26 targeted tests PASS; Headquarters browser scenario PASS (including controller mock lifecycle, cooldown, pinned detail text, preference refresh, fallback and existing delivery regression); tsc PASS; ESLint PASS; production build PASS; configured client-bundle secret scan PASS (13 configured values, 70 assets, zero matches). Browser test harness corrections included a native utterance mock mismatch, hidden HUD assumptions, exact ENTER label and polling interval measurement. One transient QA caption timeout was not conclusively explained; the subsequent complete scenario passed.

The full AI Office and all-browser regression suites were not run in this phase after the real project blocked, honoring the explicit STOP rule. Final memory/payload/live lifecycle measurements were not completed. Implementation remains uncommitted on the feature branch, with no production configuration changes. `/office` remains Classic; `/office/classic` cutover was not implemented. Final gate: NOT READY.
