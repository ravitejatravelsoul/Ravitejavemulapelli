# 08 — Security Plan

## 1. Owner authentication (localhost MVP)

Single-owner credential, no third-party auth vendor:

- One row in `users` (email + hashed password), seeded via a local-only
  setup step (env-driven seed script or one-time setup route disabled
  after first use) — never a public sign-up form; there is nothing to
  sign up for.
- Password hashed with `bcrypt` (or `argon2`) — **never** stored or
  logged in plaintext, never included in any `messages_events`/
  `audit_log` payload.
- Login is a Server Action (`app/office/actions/auth.ts`), matching the
  documented Next.js 16 App Router pattern (form → Server Action →
  validate with `zod`, same shape already used for the existing contact
  form's `contactSchema`).

## 2. Session handling

Follows the project's own installed Next.js 16 docs
(`node_modules/next/dist/docs/01-app/02-guides/authentication.md`)
exactly, since this version's authentication guidance is the one that
matters for this codebase:

1. A session secret in `.env.local` (`OFFICE_SESSION_SECRET`, generated
   once via `openssl rand -base64 32`) — the **first** environment
   variable this project has ever required, and required only for
   `/office/**` routes; the public site continues to need zero env vars.
2. Session payload (`{ userId, expiresAt }` — **minimal**, no PII, no
   role details beyond what's needed) signed with `jose` (`SignJWT`/
   `jwtVerify`), stored in an **HttpOnly, Secure, SameSite=lax** cookie
   via `next/headers` `cookies()`.
3. **`proxy.ts`** (this Next.js version's renamed `middleware.ts`) does
   an **optimistic** check only — decrypts the cookie, redirects
   unauthenticated requests to `/office/login` for any `/office/:path*`
   route. It must never be the only gate (per the docs' own explicit
   warning) and must never perform a database lookup (keeps it fast,
   keeps it correctly scoped to "optimistic").
4. A **Data Access Layer** (`lib/ai-office/auth/dal.ts`) exports
   `verifySession()`, wrapped in React's `cache()`, as the **real**
   authorization boundary — called at the top of every Server Component
   under `app/office/**`, every Server Action, and every Route Handler
   under `app/api/office/**`. This is the actual security control;
   `proxy.ts` is UX-latency optimization on top of it, not a substitute.
5. Session lifetime: short-ish default (e.g. 7 days) with sliding
   refresh on activity, matching the documented "updating/refreshing
   sessions" pattern. Logout deletes the cookie server-side.

## 3. CSRF

Server Actions in this Next.js version include built-in CSRF protection
(origin-checked POST requests) — no separate CSRF token scheme is needed
for the Server Action-based flows that make up nearly all Office
mutations. The few Route Handlers under `app/api/office/**` (if any end
up necessary — e.g. a polling endpoint) must still be `verifySession()`-
gated and treated as public-facing-equivalent endpoints per the docs'
explicit guidance, even though they sit behind the auth boundary.

## 4. XSS

- No `dangerouslySetInnerHTML` for agent-produced content. Artifacts
  (markdown/JSON) render through the same sanitized MDX/markdown
  rendering path already used for blog/project content
  (`lib/mdx-components.tsx` pattern), not raw HTML injection.
- Agent-produced text is *never* trusted as executable — treated as data
  to render, identical in spirit to how the existing contact form
  treats user input as data, never as a template/command.

## 5. Authorization boundaries

- Exactly one role (`owner`) exists in Phase 0–9. There is no "editor"/
  "viewer" tier to design for — the `users.role` column exists for
  future-proofing (§ data model) but every check today is simply
  "is there a valid session."
- **Agent roles are not authorization roles.** An `AgentRoleDefinition`'s
  `permittedActions` (see
  [04-agent-architecture.md](./04-agent-architecture.md) §2) constrains
  what the *orchestration code* will allow that role's output to trigger
  — it is an application-level allowlist enforced in `AgentRunner`, not a
  session/identity concept. No agent ever authenticates as a user; agents
  never have session cookies or credentials of their own.
- Every mutation Server Action re-checks `verifySession()` itself — never
  relies on the calling page having already checked (per the docs'
  explicit warning about layouts not re-running checks on client-side
  navigation).

## 6. API keys / model credentials (Phase 7+, not present yet)

- `ANTHROPIC_API_KEY` (and any future provider key) lives only in
  `.env.local`, already covered by the existing `.gitignore` `.env*`
  rule — no new gitignore work needed.
- Read only inside `lib/ai-office/providers/claude-adapter.ts` (server-
  only code, never imported by a Client Component) — mark provider
  adapter modules with `import "server-only"` the same way the Next.js
  docs mark session logic, so a build-time error catches any accidental
  client-side import instead of a runtime leak.
- Never included in any `Artifact`, `Event` payload, or client-visible
  response — the Budget/`AIUsage` records store token counts and cost,
  never the key or raw request/response bodies that might echo it.

## 7. GitHub credentials (future, if/when agents get repo write access)

Not needed through Phase 8 as scoped in
[11-implementation-phases.md](./11-implementation-phases.md) (agents
work in a sandboxed project workspace, not this portfolio repo, and
"GitHub operations" are explicitly in the public-must-never-see list and
the owner-approval-gate list). If a future phase adds real GitHub
integration: use a scoped fine-grained PAT or GitHub App installation
token, stored the same way as the AI provider key (`.env.local`,
server-only), and every repo-mutating action (push, PR creation, merge)
is an owner-approval-gated action per §9, never autonomous.

## 8. Logs & secrets masking

- No secret (session secret, API keys, password hashes) is ever written
  to `messages_events`, `audit_log`, or console output. A shared
  `redactSecrets()` helper wraps anything logged from provider adapter
  responses before it's persisted, stripping known key patterns as a
  defense-in-depth measure even though keys shouldn't appear in agent
  I/O in the first place.
- `AIUsage`/`agent_runs.raw` (the provider's raw response, kept for
  debugging) is scoped to server-only reads — never sent to the client
  bundle or rendered directly without going through an artifact
  formatter.

## 9. Owner approval gates (full list, expands the brief's examples)

Every one of these creates an `approvals` row (kind = listed below) and
**blocks** the triggering workflow step until `APPROVED`:

| Kind | Trigger |
|---|---|
| `production_deploy` | Any step that would deploy outside the local sandbox |
| `paid_service_purchase` | An agent's plan requires a paid third-party service |
| `budget_increase` | Raising the monthly cap or a project cap |
| `destructive_db_action` | Drop/truncate/irreversible delete proposed by any agent |
| `repository_deletion` | Any repo-deletion action |
| `major_architecture_replacement` | Architect proposes replacing an already-approved architecture decision |
| `external_account_creation` | Any new third-party account/signup |
| `secrets_access` | An agent's task would require reading a secret value directly (should essentially never fire, since agents don't get key access — its presence is a safety net, not an expected path) |
| `production_credentials` | Any credential scoped to a production/deployed target |
| `irreversible_operation` | Catch-all for anything flagged irreversible that doesn't fit the above |

Approvals are decided only by the authenticated owner, from the
`/office/approvals` queue, each with enough context (§ product spec) to
decide without needing to inspect raw logs.

## 10. Rate limiting (future deployment)

Not applicable to a single-user `localhost` MVP with no public write
endpoints beyond the existing contact form (already unaffected by this
feature). **If** the Office is ever deployed publicly-reachable (Phase
10, optional, not planned): add rate limiting to `/office/login` (brute
force protection) and any Route Handler under `app/api/office/**`,
following the same reasoning `FIREBASE_MIGRATION.md` §7 already applies
to the (also unbuilt) contact-message write path — this is a recurring,
sound pattern in this repo's own planning docs, not a new idea.

## 11. Local vs. deployed security differences

| Concern | Localhost MVP | Future deployment |
|---|---|---|
| Transport | HTTP is acceptable locally; cookie `Secure` flag should still be conditionally set (true when `NODE_ENV=production`/HTTPS detected) so the same code path works in both | HTTPS required, `Secure` cookie mandatory |
| Auth strength | Single password, no MFA | Recommend adding TOTP-based MFA (e.g. via `otpauth`) before any public exposure |
| Rate limiting | None needed | Required, per §10 |
| Secrets | `.env.local`, developer's own machine | A real secrets manager or hosting platform's env var store, never committed either way |
| Session storage | Cookie-only is sufficient | Consider database-backed sessions (§ docs' "Database Sessions" pattern) for revocation-on-demand at scale |

## 12. Internal documentation boundary

**This entire `docs/ai-office/**` package — this document included — is
internal planning material, not public content.** It contains
implementation-level detail (session/cookie mechanics, the full owner
approval gate list, budget enforcement internals, the data model,
retry/escalation internals, operational workflow internals) that must
never reach the public portfolio surface. This is a distinct concern
from the *product* boundary already covered in
[01-product-spec.md](./01-product-spec.md) §5 and
[07-ui-ux-spec.md](./07-ui-ux-spec.md) §2 (what the built `/ai-office`
page shows visitors) — this section is about the *planning documents
themselves*, which are far more detailed than anything the public page
will ever render.

Concretely, never expose to a public audience:
- Security implementation details (this document, in full).
- Agent permission internals — the `permittedActions` allowlist
  mechanism, escalation trigger logic
  ([04-agent-architecture.md](./04-agent-architecture.md)).
- Budget enforcement internals — `BudgetService.authorize()`'s decision
  logic, cap values, pricing tables
  ([09-budget-and-cost-controls.md](./09-budget-and-cost-controls.md)).
- Credential design — session signing, cookie handling, secrets masking
  (this document §2, §6, §8).
- Retry/escalation implementation — lease/timeout mechanics, crash
  recovery ([03-system-architecture.md](./03-system-architecture.md)
  §9, [04-agent-architecture.md](./04-agent-architecture.md) §3, §6).
- Internal data model details — table/column-level schema
  ([06-data-model.md](./06-data-model.md)).
- Operational workflow internals — the orchestration state machine,
  role-selection rule table
  ([05-orchestration-workflow.md](./05-orchestration-workflow.md)).

The public `/ai-office` page's content is scoped independently and
deliberately shallow (per
[07-ui-ux-spec.md](./07-ui-ux-spec.md) §2: concept, role names,
one-line responsibilities, a high-level capability flow, a *conceptual*
architecture sketch, and the ownership disclosure) — an implementer
building that page should treat this whole `docs/ai-office/` package as
background research, never as copy to lift from directly.

**Open decision, not resolved by this note**: before this branch is
ever merged into `master` or any part of it is deployed publicly, a
decision is needed on *how* this internal package is kept out of the
public production branch/artifact — e.g. keeping `docs/ai-office/**`
tracked on `feature/teja-ai-office` (and any successor working branches)
but excluding it at merge/release time, moving it to a
gitignored/untracked location before merge, or a build/export step that
strips internal docs from whatever becomes "the public repo." **Per
explicit instruction, git history is not to be rewritten to achieve
this** — the resolution must be forward-only (e.g. a future exclusion
takes effect from a certain commit onward, not by erasing this package's
existing history on this branch). Tracked as an open question in
[14-open-questions.md](./14-open-questions.md) §1; must be resolved
before Phase 10 (optional deployment) and is worth resolving before any
`master` merge even for Phases 1–9's local-only work, so it isn't
decided under time pressure later.

## 13. What this security plan deliberately does *not* build (yet)

- No OAuth/social login — unnecessary complexity for one owner who
  already has a password.
- No RBAC beyond the single `owner` role.
- No third-party auth SaaS (Clerk/Auth0/etc.) — the docs' own resource
  list offers these, but for one user with no compliance requirement,
  the plain session-cookie pattern the framework itself documents is
  simpler, has no recurring cost, and has no external dependency to
  break.
