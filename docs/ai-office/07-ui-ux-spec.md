# 07 — UI/UX Spec

## 1. Design principles

- **Public preview**: impressive, cinematic, concept-first — this is a
  showcase page, held to the same visual bar as the rest of the portfolio
  (dark, restrained, purposeful motion — reuse `components/motion/**`
  rather than inventing a new animation vocabulary).
- **Owner workspace**: functional first, beautiful second (explicit brief
  requirement). Motion and the office/department metaphor should aid
  comprehension of system state, never obscure it. A owner triaging a
  failed task at 11pm needs clarity over spectacle.
- **One design system, two moods**: same tokens, type scale, and shadcn
  primitives throughout; the private workspace is a denser, data-forward
  variant of the same look, not a different product.

## 2. Public page — `/ai-office`

Sections, top to bottom:
1. **Hero** — name/concept, one strong visual (static or lightly animated
   — e.g. a subtle particle/constellation motif consistent with the
   existing `Stars` background component), primary CTA "Enter AI Office."
2. **What it is** — plain-language explanation (2–3 short paragraphs, not
   marketing copy overload).
3. **Agent roles gallery** — a grid/row of role cards (icon, name,
   one-line responsibility) reusing the existing card patterns from
   `components/projects/**`/`components/certifications/**` for visual
   consistency.
4. **Capabilities** — a horizontal or stepper visualization of idea → plan
   → build → test → review → approval (a single clear flow diagram, not a
   dense architecture diagram).
5. **High-level architecture** — conceptual only (Orchestrator, agent
   roles, provider-agnostic AI layer, owner approval gate) — explicitly
   *no* file paths, stack internals, cost figures, or anything from
   §"Public users must NEVER see" in the product spec.
6. **Ownership disclosure** — a clearly set-apart statement: this is a
   privately operated workspace belonging to Raviteja Vemulapelli, not a
   public product or service.
7. **CTA repeat** — "Enter AI Office" again at the bottom.

No data fetching from the Office's SQLite database on this page — it is
static content, safe to prerender at build time exactly like the rest of
the public site.

## 3. Login — `/office/login`

Minimal, restrained, deliberately *not* impressive — a plain centered
card (shadcn `Card`/`Input`/`Button`), a short line making clear this is
a restricted, owner-only sign-in, and nothing else. No "forgot password
via email" flow in the local MVP (see
[08-security-plan.md](./08-security-plan.md) for the recovery approach).

## 4. Owner dashboard — `/office`

### 4.1 Layout metaphor

An "office floor" visual metaphor, applied with restraint:
- A top status bar: Office state (Open/Closed pill), current month spend
  vs. cap (compact bar), notifications bell.
- A "department zones" panel: one compact tile per agent role showing its
  current task (if any) and a status color (idle/working/blocked) — this
  *is* the "agent workstations" requirement, implemented as a responsive
  grid of tiles rather than a literal illustrated floor plan (simpler to
  build, equally legible, scales to mobile — see §5).
- A live activity feed (reverse-chronological, from `messages_events`),
  auto-refreshing.
- Pending approvals list, prioritized above the fold.
- Failed tasks needing attention.
- Active/paused/completed project lists (tabs or sections).
- Recent decisions (from `project_decisions`).
- "Start New Project" as a persistent, prominent action (not buried).

### 4.2 Motion

- Subtle, purposeful: a status tile's color/pulse animates on state
  change (e.g. task moves to `RUNNING`), not continuously for its own
  sake. Reuse the existing reduced-motion-safe hook
  (`lib/use-safe-reduced-motion.ts`) so the Office respects
  `prefers-reduced-motion` exactly like the rest of the site already
  does — this is a hard requirement carried over from the existing
  accessibility bar, not optional polish.

## 5. Responsive behavior

| Breakpoint | Behavior |
|---|---|
| Desktop (≥1024px) | Full multi-column dashboard: status bar, department-zone grid (3–4 cols), activity feed as a side rail |
| Tablet (768–1023px) | Department zones collapse to 2 columns; activity feed moves below the fold instead of a side rail |
| Mobile (<768px) | Single column, stacked: status summary → pending approvals → department zones (2-col tile grid, reusing the existing mobile stat-counter fix pattern already proven on the homepage) → activity feed (collapsed/expandable) |

Project detail and approval pages follow the same single-column-on-mobile
pattern already used throughout the existing site's forms and lists.

## 6. Component reuse plan

| Need | Reuse from |
|---|---|
| Cards, tiles | `components/ui/card` (shadcn) |
| Status pills/badges | `components/ui/badge` (shadcn), new color variants only if none fit |
| Toasts (approval decided, task failed, etc.) | existing `Toaster`/`sonner`, already mounted globally |
| Tooltips | existing global `TooltipProvider` |
| Forms (new project, budget settings) | `react-hook-form` + `zod`, same pattern as `components/contact/**` |
| Page transitions | `components/motion/page-transition.tsx` |
| Theme | `next-themes`, same dark-default behavior |

No new UI/animation dependency is anticipated — the existing stack
covers every Office UI need identified so far.

## 7. Accessibility

Same bar as the rest of the site (per `README.md` §Accessibility), not a
lower one because this is an "internal tool": WCAG AA contrast, full
keyboard navigation, visible focus states, correct heading hierarchy,
`aria-label`s on icon-only status indicators (a colored dot alone is not
an accessible status signal — pair every color cue with text/label).
