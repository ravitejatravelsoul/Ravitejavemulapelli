# 02 — Current Portfolio Assessment

Findings from direct repository inspection on 2026-09-11, on a clean
`master` (now `feature/teja-ai-office`), before any AI Office code exists.

## 1. Framework & versions

| | |
|---|---|
| Framework | Next.js **16.2.10**, App Router, React Server Components |
| React | **19.2.4** |
| Language | TypeScript, `strict: true` |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`), shadcn/ui (`components.json`, style `radix-nova`, base color `neutral`) |
| Animation | `motion` (Framer Motion) |
| Theming | `next-themes` — class-based, dark default, no flash |
| Forms/validation | `react-hook-form` + `zod` |
| Content | Local JSON + MDX (`gray-matter`, `next-mdx-remote`, `rehype-pretty-code`/`shiki`) |
| Package manager | npm (`package-lock.json` present) |
| Node | 20+ per `README.md` prerequisites |

**Important — this is not the Next.js in most training data.** Confirmed
via `node_modules/next/dist/docs/` (this project's own installed docs,
per `AGENTS.md`'s instruction to read them before writing code):

- **Middleware is renamed to Proxy.** The convention is a single
  `proxy.ts` at the project root (same level as `app/`), exporting a
  `proxy` function, not `middleware.ts`. Functionally equivalent to what
  "middleware" meant in older Next.js versions.
- The documented App Router auth pattern (relevant to
  [08-security-plan.md](./08-security-plan.md)) is: Server Actions for
  credential handling, `jose` for signing a session payload,
  `next/headers` `cookies()` for an HttpOnly session cookie, `proxy.ts`
  for *optimistic* redirect checks only, and a Data Access Layer (DAL)
  with a `verifySession()` function (wrapped in React's `cache`) as the
  actual authorization boundary in Server Components, Server Actions, and
  Route Handlers. Optimistic checks in `proxy.ts` must never be the only
  gate.
- File conventions `unauthorized.ts` / `forbidden.ts` and the
  `authInterrupts` config exist in this version and are candidates for
  the owner-only gate (see [08](./08-security-plan.md)).

No dependency install, upgrade, or docs-reading obligation applies beyond
this planning task, but any future implementer **must** re-check
`node_modules/next/dist/docs/` before writing AI Office auth/routing code
— API surface may keep moving across Next.js releases in this
repository's lockfile.

## 2. Routing structure

```
app/
  layout.tsx            root layout: theme, nav, footer, motion chrome
  page.tsx               home
  about/  achievements/  blog/  blog/[slug]/  certifications/
  contact/  experience/  projects/  projects/[slug]/  resume/  skills/
  api/contact/route.ts   only existing API route (contact form)
  error.tsx  not-found.tsx  manifest.ts  opengraph-image.tsx
  robots.ts  sitemap.ts  globals.css  favicon.ico
```

Every route is a flat top-level segment under `app/` — no route groups,
no nested layouts beyond root, no parallel/intercepting routes, no
existing `proxy.ts`. This is a fully public, statically-generatable site
(`generateStaticParams` for `projects/[slug]` and `blog/[slug]`).

## 3. Styling system

- Tailwind v4, config lives in `app/globals.css` (no separate
  `tailwind.config.*` — v4 CSS-first config).
- shadcn/ui components under `components/ui/`, generated via the
  `shadcn` CLI per `components.json` (style `radix-nova`, icon library
  `lucide-react`, no prefix, CSS variables on).
- Dark-default theme, light/dark toggle via `next-themes`, synced theme
  color via `components/theme/theme-color-sync.tsx`.
- Motion primitives centralized in `components/motion/` (page transition,
  cursor glow, route progress bar, starfield background) — reusable for
  the Office's "futuristic" visual direction without inventing a new
  animation system.

## 4. Reusable components

```
components/
  common/        generic building blocks
  layout/        navbar, footer
  motion/        page-transition, cursor-glow, route-progress-bar, stars
  sections/      homepage section blocks
  theme/         theme-provider, theme-color-sync
  ui/            shadcn primitives (button, dialog, tooltip, sonner toast, etc.)
  blog/ projects/ resume/ certifications/ contact/ travel/   domain-specific
```

`TooltipProvider` and `Toaster` (sonner) are already mounted globally in
`app/layout.tsx` — available for reuse without new providers.

## 5. Authentication

**None exists today.** No login route, no session handling, no user
table, no auth dependency in `package.json`. `ADMIN_SPEC.md` and
`FIREBASE_MIGRATION.md` describe a *planned, unbuilt* `/admin` CMS behind
Firebase Auth — explicitly "not built, not scheduled." AI Office must not
assume Firebase exists; it needs its own lightweight local-first auth
(see [08-security-plan.md](./08-security-plan.md)) that does not depend
on that unbuilt plan ever being executed.

## 6. Data / storage patterns

The content layer already follows a strict repository/provider pattern
(`README.md` §Architecture), which the AI Office data layer should mirror
for consistency, without merging into the *same* content domain:

```
lib/
  data/
    types.ts                  domain types (Project, Experience, Skill, ...)
    repositories/*.ts          interfaces, one per content domain
    providers/local/*.ts       current impl — reads content/*.json and *.mdx
    providers/index.ts         provider selection
    index.ts                   the ONLY module pages/components import from
  services/contact.service.ts  the one existing "write" path (console-logs, no persistence)
  validation/contact.ts        zod schema example
```

`content/data/*.json` + `content/{projects,blog}/*.mdx` are the existing
static content — portfolio case studies, resume, skills, etc. **The AI
Office's data (projects it builds, agent runs, tasks, budgets) is a
completely different domain and must not be modeled as new files under
`content/`** — that directory is the public portfolio's content, and
mixing operational/private data into it risks it becoming public (it's
not gitignored) or accidentally rendered by an existing page. AI Office
gets its own storage (SQLite, see [06-data-model.md](./06-data-model.md))
outside `content/`.

## 7. Existing tests

**None.** No `*.test.*` / `*.spec.*` files, no test runner in
`devDependencies`, no CI config found in the repository. `npm run lint`
(ESLint 9 flat config) and `npm run typecheck` (`tsc --noEmit`) are the
only existing verification scripts. This is a gap for the *whole*
project, not something AI Office introduces — see
[10-testing-strategy.md](./10-testing-strategy.md) for how AI Office adds
its own test coverage without assuming a pre-existing suite to extend.

## 8. Build scripts

```json
"dev": "next dev"        // Turbopack per README
"build": "next build"
"start": "next start"
"lint": "eslint"
"typecheck": "tsc --noEmit"
```

No test script exists to add to yet; Phase 3+ should add one (e.g.
`"test"`) only when a test runner is actually introduced, per the
dependency policy in [00-master-plan.md](./00-master-plan.md).

## 9. Deployment configuration

- `README.md` documents Vercel as the recommended target, "or any Node.js
  host that supports Next.js." No `vercel.json`, no CI/CD workflow files
  found in the repo.
- No environment variables are currently required to run the site at all
  (`README.md` §Environment Variables) — contact form submissions are
  logged server-side, not sent anywhere external.
- `.gitignore` already excludes `.env*` (with a `.env.example` exception),
  `.vercel/`, and — notably — a set of **private planning docs**
  (`ADMIN_SPEC.md`, `CMS_ARCHITECTURE.md`, `FIREBASE_MIGRATION.md`,
  `LAUNCH.md`, `MEDIA_GUIDE.md`, `AGENTS.md`, `CLAUDE.md`) with an
  explicit comment: *"private planning/ops notes — for the site owner,
  not public consumption."* This repository already has an established
  convention for keeping owner-only planning material out of the public
  repo. `docs/ai-office/**` (this package) is arguably the same category
  — and, per
  [08-security-plan.md](./08-security-plan.md) §12, is now explicitly
  classified as internal planning material regardless of how this
  particular question is resolved — and could be added to that
  `.gitignore` block. Flagged as a decision for Raviteja rather than made
  unilaterally here (see [14-open-questions.md](./14-open-questions.md)
  §1, which also covers the "no git history rewrite" constraint on
  whatever is decided); no `.gitignore` change has been made in this
  task.

## 10. Files & directories AI Office may safely use (read/reference, no modification needed)

- `components/ui/**`, `components/motion/**`, `components/theme/**` —
  reuse directly for the Office UI.
- `lib/utils.ts`, `lib/format.ts` — generic helpers, safe to import.
- `app/layout.tsx` — read as a reference pattern; **not edited** until
  Phase 1 actually needs a nav entry (see below).
- Existing `lib/data/*` pattern — copied *as a pattern*, not extended
  in-place, for the new `lib/ai-office/data/*` domain.

## 11. Files & directories AI Office may modify later (specific, minimal touch points)

| File | Phase | Change |
|---|---|---|
| `components/layout/navbar.tsx` | Phase 1 | Add an "AI Office" nav link |
| `app/robots.ts` | Phase 1 | Disallow `/office/` (keep `/ai-office` crawlable) |
| `app/sitemap.ts` | Phase 1 | Ensure `/office/**` is never emitted; optionally add `/ai-office` |
| `package.json` | Phase 3+ | Add SQLite/session/testing dependencies (see [dependency policy](./00-master-plan.md)) — **not touched in this planning task** |
| `.gitignore` | Owner decision | Optionally add `docs/ai-office/` and any local `*.sqlite` DB file (a `*.sqlite` pattern already exists in `.gitignore`, so the DB file itself is already safely ignored) |

## 12. Files & directories that should remain untouched unless absolutely necessary

- `content/**` — public portfolio content. AI Office must never read or
  write here.
- `app/{about,achievements,blog,certifications,contact,experience,
  projects,resume,skills}/**` — existing public routes; zero reason for
  AI Office work to touch them.
- `lib/data/**` (the existing content-domain provider/repository files)
  — a parallel `lib/ai-office/**` tree keeps the two domains from
  entangling.
- `ADMIN_SPEC.md`, `CMS_ARCHITECTURE.md`, `FIREBASE_MIGRATION.md`,
  `LAUNCH.md`, `MEDIA_GUIDE.md`, `VERSION2_BACKLOG.md` — pre-existing
  owner planning docs for a *different*, unbuilt feature (the CMS admin).
  Do not merge AI Office planning into these; they describe unrelated
  future work and should stay independently readable.
- `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`,
  `tsconfig.json` — only touch if a concrete Phase 3+ need arises (e.g. a
  new `paths` alias), and even then prefer the existing `@/*` alias
  pattern already in place rather than adding new ones.

## 13. Likely integration risks

1. **Route collision / nav clutter** — adding `/ai-office` and `/office`
   is low-risk (no existing routes at those paths), but the navbar is a
   shared, hand-tuned component; adding a nav entry must not break its
   responsive layout (it already has mobile-viewport handling via
   `lib/use-is-mobile-viewport.ts`).
2. **Build-time cost** — a SQLite file and any `better-sqlite3`-style
   native dependency must not be required at *build* time for the public
   site's static pages; the public portfolio pages must remain
   staticly generated with zero dependency on the Office's database being
   present or reachable.
3. **Bundle weight** — the Office's admin-style UI (tables, forms, live
   activity feed) must stay code-split under `/office/**` and not inflate
   the public site's shared JS bundle. Next.js route-based code splitting
   handles this by default as long as Office components aren't imported
   from shared/public-facing modules.
4. **`proxy.ts` scope** — a single `proxy.ts` is shared project-wide
   (Next.js only supports one). Its matcher must be scoped tightly
   (`/office/:path*`) so it never adds latency or risk to the public
   site's existing routes.
5. **Secrets sprawl** — introducing `.env.local` for the first time in
   this project (session secret, later a Claude API key) changes a
   currently zero-config app into one with required environment
   variables for the Office routes only; the public site must keep
   working with **no** env vars set, same as today (Office routes simply
   won't function without them, which is correct — see
   [08-security-plan.md](./08-security-plan.md)).
6. **TypeScript project-wide strictness** — `tsconfig.json` has no
   path exclusions; new `lib/ai-office/**` and `app/office/**` code is
   automatically included in `tsc --noEmit` and `next build` type
   checking for the whole repo, meaning a type error in Office code can
   fail the *existing* portfolio's build. This is actually desirable
   (forces correctness) but means CI/build discipline for Office code is
   not optional.

## 14. Rollback strategy

Because every AI Office addition is either (a) a new, isolated file/
directory or (b) a small, additive edit to a handful of named files
(§11), rollback is cheap at every phase:

- **Any single phase**: `git revert` the phase's commit(s); nothing
  outside the listed touch points changes, so no other phase is affected.
- **Whole feature, pre-merge**: the entire effort lives on
  `feature/teja-ai-office` and is never merged to `master` until
  Raviteja explicitly approves; deleting the branch fully removes it with
  zero effect on `master`.
- **Whole feature, post-merge**: because the only edits to *existing*
  files are the three rows in §11 (navbar link, robots, sitemap), a full
  rollback after merge is: remove `app/office/**`, `app/ai-office/**`,
  `lib/ai-office/**`, the local SQLite file, revert the navbar/robots/
  sitemap diffs, remove the added dependencies from `package.json`. No
  data migration, no schema coupling to existing content — the public
  portfolio has zero structural dependency on the Office existing.
- **Data-only rollback**: since Office data lives in one SQLite file
  outside `content/` and outside version control, deleting that file
  resets all Office state without touching the git history or the public
  site at all.
