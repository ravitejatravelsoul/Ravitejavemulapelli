# Raviteja Vemulapelli — Portfolio

A production personal portfolio and career site built with Next.js 16 (App
Router) and React 19 — case studies for nine shipped products, an
interactive resume, a technical blog, and a content layer designed to
outlive any single redesign.

**Live site:** [ravitejavemulapelli.dev](https://ravitejavemulapelli.dev)

## Features

- **Project case studies** — problem, architecture, engineering decisions,
  challenges, and lessons learned for each project, not just a screenshot
  and a tech list
- **Interactive, ATS-friendly resume** with print support and PDF download
- **Technical writing** (MDX blog) with syntax highlighting, table of
  contents, and reading time
- **Experience timeline, skills map, achievements, and certifications**,
  all data-driven from a single content layer
- **Travel page** with an interactive US states map
- **Full SEO layer** — per-page metadata, Open Graph/Twitter images,
  JSON-LD structured data, sitemap, and robots.txt
- **Accessibility-first**: skip-to-content link, keyboard navigation, WCAG
  AA contrast, `prefers-reduced-motion` support throughout
- **PWA-ready manifest** with a full icon set (192/512/Apple touch/maskable)
- Dark, restrained visual design with purposeful motion (Framer Motion),
  built to feel like a product landing page rather than a template

## Technology Stack

| Layer | Choice |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router, React Server Components) |
| UI | [React 19](https://react.dev), TypeScript (strict) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) |
| Animation | [Motion](https://motion.dev) (Framer Motion) |
| Content | Local JSON + MDX (`gray-matter`, `next-mdx-remote`) |
| Forms | `react-hook-form` + `zod` |
| Maps | `react-simple-maps` |
| Code highlighting | `rehype-pretty-code` / `shiki` |

## Architecture

Content lives behind a repository/provider pattern so the data source can
change (e.g. local files → a headless CMS) without touching any UI code:

```
lib/data/
  types.ts                 # shared domain types (Project, Experience, Skill, ...)
  repositories/*.ts         # interfaces — one per content domain
  providers/local/*.ts      # current implementation, reads from /content
  index.ts                  # the only module pages/components import from
```

UI components and pages never import content files or a specific provider
directly — only `lib/data/index.ts`. This is what lets the entire content
layer be swapped later with zero changes to `app/` or `components/`.

```
app/            Route segments (App Router) — pages, layouts, metadata
components/     UI components (common, layout, motion, section, and
                domain-specific: projects, blog, resume, contact)
content/        Site content — JSON data files + MDX (projects, blog)
lib/            Data layer, formatting, validation, shared utilities
public/         Static assets (images, icons, resume PDF)
```

## Screenshots

_Add screenshots of the homepage, a project case study, and the resume
page here (e.g. `docs/screenshot-home.png`)._

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
git clone https://github.com/ravitejatravelsoul/Ravitejavemulapelli.git
cd Ravitejavemulapelli
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

None are required to run the site. All content is served from local
JSON/MDX files in `content/`, and the contact form (`app/api/contact`)
currently logs submissions server-side rather than calling an external
service — there is nothing to configure out of the box.

If you extend the contact form or content layer to call a real service
(email provider, database, CMS), add a `.env.local` file for any secrets
it needs. `.env*` is already git-ignored so local secrets are never
committed.

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |

## Deployment

The site is a standard Next.js App Router app and deploys cleanly to
[Vercel](https://vercel.com) (recommended) or any Node.js host that
supports Next.js:

```bash
npm run build
npm run start
```

No environment variables or external services are required for a working
deployment.

## Performance

- Static generation for every route (`generateStaticParams` for projects
  and blog posts)
- `next/image` throughout, with `priority` reserved for the actual LCP
  element per page
- Reduced-motion support via a hydration-safe `useSyncExternalStore` hook,
  so animations never mismatch between server and client render
- No unnecessary client component boundaries — interactive pieces (forms,
  filters, motion) are isolated; the rest renders on the server

## Accessibility

- Skip-to-content link (keyboard-focus only, moves real focus to `<main>`)
- Exactly one `<h1>` per page, correct heading hierarchy
- WCAG AA color contrast across all text
- Full keyboard navigation and visible focus states
- `aria-label`/`aria-describedby` on interactive elements and form errors
- Respects `prefers-reduced-motion` throughout

## SEO

- Per-page `title`, `description`, canonical URL, Open Graph, and Twitter
  card metadata
- JSON-LD structured data (`Person`, `AboutPage`, `CollectionPage`,
  `CreativeWork`, `Article`, `Blog`, `ContactPage`) with no duplicates
- Dynamic `sitemap.xml` and `robots.txt`
- A generated default social share image, with per-project/post images
  where available

## License

The code in this repository is licensed under the MIT License — see
[LICENSE](./LICENSE). This does **not** extend to the personal content in
`content/`, `public/profile/`, and `public/resume/` (bio, photos, resume,
project write-ups) — that content is Raviteja Vemulapelli's own and isn't
licensed for reuse.

## Author

**Raviteja Vemulapelli**
Senior Automation Engineer & AI Builder

- Portfolio: [ravitejavemulapelli.dev](https://ravitejavemulapelli.dev)
- GitHub: [@ravitejatravelsoul](https://github.com/ravitejatravelsoul)
- LinkedIn: [ravitejavemulapelli](https://www.linkedin.com/in/ravitejavemulapelli)

## Contact

Open to Staff Automation Engineering, AI Product Engineering, Platform
Engineering, and Full Stack Engineering opportunities — reach out via the
[contact page](https://ravitejavemulapelli.dev/contact) or
[email](mailto:ravitejavemulapelli@gmail.com).
