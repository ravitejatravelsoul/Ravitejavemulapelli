# Free multi-model local pilot — 2026-09-18

## Result

READY for a local pilot. Production was not deployed, merged, or reconfigured.

The clean project `017f2842-d1e7-4b4d-b552-c2f906ebdb74` reached READY_FOR_REVIEW;
its workspace reached VERIFIED. All seven roles completed in one attempt each:
Product Owner, Architect, UX, Frontend, QA, Code Review, Release.
The model API ledger recorded 10,650 tokens and $0.00. The harness observed
one OpenRouter request, six Groq requests, two existing local Ollama intent checks,
and zero Anthropic requests. Local intent checks retain their existing separate
accounting behavior; 10,650 is the external task API token total.

To exercise changing availability, the isolated pilot disabled Groq for its first
cycle through the existing provider control, then re-enabled it. Requirements
used OpenRouter Nex N2.5 Mini; the remaining tasks selected Groq GPT-OSS 20B.
No agent has a permanent model assignment. Normal routing may choose the same
qualified model repeatedly when its deterministic score remains highest.

## Architecture

- Kept AIProviderAdapter, ProviderRouter, LocalModelRouter, AgentRunner, the
  orchestrator, context budgets, existing retry/escalation, and usage ledger.
- Added opt-in free routing, a shared free-adapter factory, dynamic catalogs,
  server-side credentials, and owner provider/model controls on the existing page.
- Task intent plus role tendencies produces required capability sets. The
  orchestrator records classification; routing enforces every required capability.
- Models start unqualified. Successful catalog listing is not successful inference.
  Benchmarks establish health, structured-output support and qualified capabilities.
- Groq/Gemini require explicit free-account confirmation and configurable model
  allowlists. OpenRouter requires zero-priced free routes and sends zero-price
  routing constraints. Missing keys are non-fatal; paid Claude cannot be a fallback.
- Scoring uses qualification, benchmark scores, recent request success/structured
  reliability, latency, context/output fit, cooldowns and failure history.
- Fallback is bounded to three candidates. A throttled model is not immediately
  retried; Retry-After is recorded. Removed models become unavailable.
- Each request, including malformed responses and failed fallback candidates,
  records its usage. Final routing results and model task counts reflect downstream
  workspace/browser validation, not merely successful JSON generation.
- Claude has both routing and adapter-level disable checks. Local .env.local sets
  AI_OFFICE_CLAUDE_ENABLED=false; credentials were not committed.
- Fixed an existing intent-review evidence gap: the final reviewer now receives
  observed browser interactions, before/after text, button label and actual files.

## Real model evidence

| Provider/model | Latest per-scenario aggregate | Qualification |
|---|---:|---|
| Groq openai/gpt-oss-20b | 90/100, 11 probes | Qualified |
| Groq openai/gpt-oss-120b | 90/100, 11 probes | Qualified |
| OpenRouter nex-agi/nex-n2.5-mini:free | 82/100, 10 probes | Qualified except REVIEW / RESEARCH |
| OpenRouter google/gemma-4-26b-a4b-it:free | 10/100, stopped on real 429 | Unqualified |
| Ollama qwen2.5-coder:3b | 23.33/100, 3 probes | Unqualified |

Scores use the existing 90-point PASS band, not a claim of scientific model quality.
Failed initial runs are preserved. Focused reruns addressed real schema/effort
issues and a test-generation probe that incorrectly required code in the summary
rather than accepting the proper test-report artifact. The separate exact-output
instruction probe remains strict. Gemini has deterministic adapter coverage but
was not connected or claimed as a validated third API provider.

A separate cross-provider integration injected controlled Groq HTTP 429 responses,
then obtained a real successful OpenRouter response through AgentRunner. All
attempts and token usage were recorded. This is labelled fault injection, not a
claim that Groq actually throttled those particular requests. Real throttling was
also encountered during initial Groq benchmarks and the first OpenRouter model.

## Local state and reproduction

- Isolated evidence: `.data/free-pilot/pilot.db`, `project-evidence.json`,
  `fallback-evidence.json`, `benchmarks.json`, plus validation logs.
- Qualified model metadata and actual benchmark rows were imported into the local
  `.data/office.db` after a SQLite snapshot backup under `.data/free-pilot/`.
  Existing projects/tasks and provider/model enable preferences were preserved.
- Restart an already-running app/runner so it loads the new environment and code.
  In AI Models & Routing, qualified models and Claude: Disabled should appear.
  New projects must explicitly enable free-model orchestration.
- The Groq account was confirmed Free by the owner. OpenRouter authenticated as
  free tier. Do not upgrade provider billing while declaring it a free account.
- Set `AI_OFFICE_GROQ_FREE_MODELS` / `AI_OFFICE_GEMINI_FREE_MODELS` to currently
  eligible chat IDs. Discovery never assumes that every returned model is free.
- JSON Schema support and reasoning effort are optional provider configuration,
  not permanent model-name routing rules. See `.env.example`.

Commands (from the repository root; Node 24):

```powershell
node --env-file=.env.local --conditions=react-server scripts/ai-office-free-pilot.ts
node --env-file=.env.local --conditions=react-server scripts/ai-office-free-project-pilot.ts
node --env-file=.env.local --conditions=react-server scripts/ai-office-free-fallback-pilot.ts
```

The benchmark script accepts PILOT_PROVIDER, PILOT_MODELS (comma separated), and
optional PILOT_SCENARIOS for focused reruns. The project script optionally accepts
PILOT_FIRST_PROVIDER=openrouter to exercise changing provider availability.
All harnesses use the isolated pilot database. The evidence-import script is a
separate, local-only operation that backs up the office database before migration.

## Verification

- TypeScript: PASS.
- ESLint: no errors; one pre-existing unused-variable warning in an old generated
  `.data/ai-office-workspaces/.../js/storage.js`, outside this implementation.
- Unit suite: 907 passed. Added coverage includes zero direct Claude calls,
  qualification/free eligibility, task intent, context fit, cooldown recovery,
  dynamic discovery/removal, benchmark influence, credential-safe errors,
  malformed-output accounting and cross-provider fallback.
- Browser E2E: 7 passed, including local navigation and remote limited-production
  shell checks using isolated test servers. No production endpoint was deployed.
- Build: PASS (see local logs for final run).

The small Ollama model remains unqualified in the new registry rather than being
misrepresented as reliable. Existing local adapters and intent checks still run.
No guarantee is made that free providers have uninterrupted capacity; exhausted
eligible models flow through the existing bounded failure/escalation path.


## Focused hardening

Projects now store routingMode (STANDARD or FREE_MULTI_MODEL) independently of their standard provider. Migration 016 upgrades previous opt-ins; existing standard projects retain their behavior. Actual selected provider/model remains in runs, routing decisions and request events.

Free eligibility distinguishes LOCAL_FREE, PROVIDER_FREE_ROUTE and OWNER_CONFIRMED_FREE_TIER. Groq/Gemini require current owner confirmation plus the model allowlist; this is an owner attestation, not independently verified billing. OpenRouter uses free-route IDs, catalog zero-price filtering and request max-price constraints. Unknown or paid routes are refused before requests or zero-cost estimates. Request events record the eligibility basis.

Deterministic coverage exercises non-Ollama free projects, legacy migration, owner-confirmation revocation, unknown-price rejection, disabled Claude under CLAUDE_ONLY, and exhausted free fallback. No additional real API calls are needed for this hardening pass.
