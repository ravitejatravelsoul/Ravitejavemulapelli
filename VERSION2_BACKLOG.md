# Version 2 Backlog

This portfolio launched in its current form as a complete, production-ready
site. Everything below was deliberately deferred rather than shipped
half-finished — each item was either hidden gracefully in code (with a
`TODO(v2)` comment at the call site) or was never started. Nothing here
blocks launch.

## Content & media

- **Project galleries** — screenshots, architecture diagrams, and demo
  GIFs/videos per project. The data layer already supports this
  (`Project.gallery`, MDX frontmatter) and the gallery section renders
  automatically the moment real media is added — see
  `app/projects/[slug]/page.tsx` (search `TODO(v2)`) and each project's
  `public/projects/<slug>/README.txt` / `MEDIA_SPEC.md`.
- **Architecture diagrams** — one or two projects (API Automation Platform,
  MQE Intelligence Platform) would benefit most from a real system diagram
  rather than prose-only "Technical Approach" sections.
- **Demo videos** — short screen recordings of Snaptura, Screenshots360, and
  the mobile apps in actual use.
- **Travel content** — trip stories, photos, and a filled-in travel timeline.
  The Travel page's Timeline and Photo Gallery sections are hidden (not
  deleted) until real dated stories / photo URLs exist in
  `content/data/travel.json` — see `app/travel/page.tsx` (search
  `TODO(v2)`).

## Contact

- **Cal.com / Calendly booking link** — a "prefer a call?" scheduling card
  was scoped but is hidden until a real booking link exists. See
  `app/contact/page.tsx` (search `TODO(v2)`).

## Platform / CMS

- **Firebase-backed CMS** — the data layer already follows a
  repository/provider pattern specifically so a Firestore provider can be
  swapped in later with zero UI changes (see `lib/data/providers/`).
- **Admin dashboard** — an authenticated view for editing content, projects,
  and blog posts without touching JSON/MDX files directly.
- **Visitor analytics** — page views, referrers, and engagement tracking.
- **AI assistant** — a chat-style assistant that can answer visitor
  questions about experience, projects, and availability using the same
  content layer as the rest of the site.
- **Site search** — full-text search across projects, blog posts, and
  experience.
- **Guestbook / visitor comments** — a lightweight way for visitors to leave
  a note.
- **Media management** — an upload/asset pipeline (rather than manually
  dropping files into `public/`) once a CMS exists.

## Other ideas worth revisiting

- Verified credential links / live demo links for projects once they exist
  publicly (App Store, Play Store, public GitHub repos).
- A second, real certification if one exists beyond Tricentis Tosca
  Certified Professional.
- Revisit the "8+ years" experience framing as more time passes and the
  timeline in `content/data/experience.json` grows.
