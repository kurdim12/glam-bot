# GLAMBOT Jordan — glambotjo.com

One-page marketing site for GLAMBOT Jordan's cinematic robotic camera arm.
Started as a faithful build of the **Option 2** design PDF, then evolved with the
client through video, brand assets, and content supplied along the way.

Node + Express + SQLite. Every inquiry from the booking form is stored in a
database and managed from a password-protected admin dashboard.

```bash
npm install
node server.js
```

- **Site**  http://localhost:3000/
- **Admin** http://localhost:3000/admin  (password from `ADMIN_PASSWORD`, default `glambot`)

---

## What's here

```
server.js             Express app: static site + booking API + admin routes
src/
  db.js               data layer (node:sqlite — no native build, no DB server)
  validate.js         server-side validation of the booking payload
  auth.js             admin session cookies
  env.js              tiny .env loader
migrations/
  0001_init.sql       bookings schema (shared with Cloudflare D1)
data/                 glambot.db lives here — gitignored, never commit
public/               everything served to the browser
  index.html          the site
  privacy / terms / booking-policy / safety .html
  assets/             styles.css, app.js, video, images, flags
  admin/              login + dashboard pages
  css/ js/            admin-only styles and scripts
brand/                logo exports (mark SVG/PNG, lockups, avatar)
higgsfield/           AI hero-video kit (unused — the hero runs real footage)
```

**When you edit `assets/styles.css` or `assets/app.js`, bump the `?v=` number in
all five HTML files** — that guarantees browsers can't pair stale styles with new markup.

## The booking form → database

The form posts JSON to `POST /api/bookings`. Fields map straight onto the
`bookings` table: `name`, `email`, `phone` (country code + number joined),
`shoot_date`, `occasion`, `location`, `notes` (the selected package is prepended
here). A hidden `website` field is a honeypot — anything that fills it gets a
silent `201` and is never stored.

Validation runs on both sides. Server-side failures return `422` with per-field
messages, which the form maps back onto the right inputs.

If the server is unreachable the form does **not** lose the inquiry: it falls
back to the WhatsApp / email hand-off with the details pre-composed.

Admin dashboard: stats, 14-day chart, occasion breakdown, pipeline, per-booking
status + notes, search/filter, and CSV export. All `/api/admin/*` routes are
session-guarded (they return `401` without a valid cookie).

## Deploying

Two supported backends, one schema:

- **Node** (what runs above) — `node server.js`, SQLite file in `data/`.
- **Cloudflare Workers + D1** — the upstream repo carries a `worker/` build and
  `wrangler.jsonc`; `migrations/0001_init.sql` is the shared DDL, so the same
  schema applies with `wrangler d1 migrations apply glambot --remote`.

Set `ADMIN_PASSWORD` (and ideally `SESSION_SECRET`) before putting this on a
public host — see `.env.example`.

## The page, top to bottom

| Section | What it does |
|---|---|
| **Hero** | Full-screen landscape showreel, cut to the strongest 30s of the client master (studio, McLarens, models — the first 35s of hand close-ups is trimmed off). MP4 + WebM + poster; reduced-motion pauses it; autoplay-blocked browsers retry on first touch. |
| **About** | Design's copy, scroll-reveal. |
| **Who We Work With** | Four segments; selecting swaps the slatted image; "Book this" jumps to the form with the occasion preselected. |
| **Portfolio** | Thumbnail rail swaps the stage image; arrow keys work. |
| **What's Included** | For Events / For Brands cards — hover lifts them, click selects one (orange glow, one at a time). |
| **How It Works** | The client's 7-step breakdown as a camera-timeline player: REC badge, STEP N/07 timecode, photo stage, chapter bars. Manual only — Prev/Next, a bar click, or arrow keys; it never advances on its own. |
| **Packages** | Three cards; icons spin in place with a chromatic shimmer, phase-offset; selecting a package carries into the booking form. |
| **Barrier tape** | Two CSS ribbons as a counter-scrolling ticker, both locked to the same speed (2.86vw/s). Exact logo geometry, measured angles and stripe pitch. |
| **Reserve The Machine** | Brand mark, then the booking form: flag country selector, occasion chips (arrow-key radiogroup), date min = today, auto-growing textarea, inline validation, hidden honeypot. Valid submit **saves to the database** and shows a confirmation; WhatsApp / email hand-off remains as an optional extra (and as the fallback if the server is down). Nav "Book Now" lands directly on the first field. |
| **Footer** | Service/policy links, contact, giant lockup, back-to-top. |

Keyboard accessible throughout; visible focus rings; skip link; `prefers-reduced-motion`
respected by every animation (tape, icons, player, hero video, REC blink).

## Brand facts (source-verified)

- **Mark geometry** is taken from the client's own `GlamBot Logo.svg` — the inline
  SVG paths in nav/footer/tape/favicon match it coordinate-for-coordinate.
  Navbar renders the orange-triangle variant at the client's request.
- **Wordmark font**: the client lockup was shape-scored against candidates —
  Century Gothic 700 (0.553) and Jost 700 (0.525) beat Montserrat (0.399).
  Stack: `'Century Gothic','Jost','Montserrat'` — Century Gothic when installed
  locally, Jost served from Google Fonts. Used for the tape lettering and the
  footer lockup only; body text is **Montserrat** (client's choice).
- **Width calibrations** at 1920px: footer lockup fills 1756px; tape cell ≈331px.
  Retune `letter-spacing`/`font-size` on `.tape__cell` and `.foot__word` if fonts change.
- **Contact**: email `book@glambotjo.com` (design), WhatsApp `+962 790944300`
  (client's breakdown PDF) — both live in `assets/app.js`.

## ⚠️ Still open before launch

1. **Change the admin password.** It defaults to `glambot`. Set `ADMIN_PASSWORD`
   in `.env` before this is reachable from the internet.
2. **"For Brands" copy** duplicates "For Events" word-for-word (it did in the design
   too) — likely wants four brand-specific lines.
3. **Policy pages** are drafted, not lawyered. Safety figures (3m / 147kg / 5m² /
   20 min) come from the design. Review before publishing.
4. **Back up `data/glambot.db`.** It is the only copy of every inquiry and is
   gitignored by design. Set up a routine copy before this takes real bookings.

## Testing

A Playwright suite (24 checks) covers interactions, form validation, the database
round-trip, anchors, image loading, multi-viewport overflow (2560 → 360), and the
policy pages. Green against the final state of this build, along with API-level
checks: honeypot stores nothing, `422` carries per-field errors, `/api/admin/*`
returns `401` unauthenticated, and no server source is reachable over HTTP.
