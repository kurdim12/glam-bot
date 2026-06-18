# GLAMBOT — Booking + Admin Dashboard

A self-contained booking system for **GLAMBOT** (cinematic robotic camera arm,
Jordan / MENA). A public inquiry form on the brand's signature dark, cinematic
look, backed by a simple password-protected admin dashboard to manage every
inquiry that comes in.

Deploys two ways from one codebase: as a **Node + SQLite** app on any Node host,
or fully serverless on **Cloudflare** (Workers + D1). No third-party services or
API keys either way.

---

## What's inside

- **Public form** (`/`) — the "Reserve the machine" booking inquiry: name,
  email, WhatsApp/phone, shoot date, occasion, location, and notes. Validated
  client- and server-side, with a honeypot to deter spam bots.
- **Admin dashboard** (`/admin`) — password login, then:
  - stat cards (Total / New / Contacted / Booked / Completed / Cancelled) that
    double as one-click filters,
  - searchable, **paginated** table (50 per page) that stays fast at tens of
    thousands of inquiries,
  - a detail drawer to read the full brief, click-to-WhatsApp / email the
    client, move a booking through its status pipeline, and jot internal notes,
  - delete, and a one-click **CSV export** of all bookings.

## Tech — runs two ways

The same frontend (`public/`) and database schema (`migrations/0001_init.sql`)
power two interchangeable backends. Pick whichever host you're deploying to:

| Target | Runtime | Storage | Entry point |
| --- | --- | --- | --- |
| **Node host** (Render, Railway, VPS) | Node ≥ 22.5 + Express | `node:sqlite` file (`data/glambot.db`) | `server.js` |
| **Cloudflare** (edge) | Workers + Static Assets | **D1** (serverless SQLite) | `worker/index.js` |

D1 *is* SQLite, so the schema and every SQL query are identical across both —
only the runtime glue (auth via Web Crypto vs `node:crypto`, D1 vs `node:sqlite`)
differs. See [**Deploy to Cloudflare**](#deploy-to-cloudflare) below.

## Brand

- Palette and type live in [`public/css/brand.css`](public/css/brand.css).
- Fonts follow Hassan's spec — **Futura** (display) + **Proxima Nova** (body) —
  with free stand-ins (**Jost** + **Inter**) loaded from Google Fonts. With an
  Adobe Fonts kit, swap the `<link>` tags and update `--font-display` /
  `--font-body`.
- The logo lives at `public/assets/logo.png`.

---

## Run it

```bash
npm install
npm start
```

Then open:

- Booking form → <http://localhost:3000/>
- Admin dashboard → <http://localhost:3000/admin>

The default admin password is **`glambot`** — change it before deploying (see below).

For live-reload during development:

```bash
npm run dev
```

## Configuration

Copy `.env.example` to `.env` and edit (the app also runs on defaults without one):

| Variable            | Default      | Purpose                                            |
| ------------------- | ------------ | -------------------------------------------------- |
| `PORT`              | `3000`       | Port to listen on.                                 |
| `ADMIN_PASSWORD`    | `glambot`    | Password for `/admin`. **Change this.**            |
| `SESSION_SECRET`    | _generated_  | Signs admin session cookies. Auto-persists in `data/.session-secret` if unset. |
| `SESSION_TTL_HOURS` | `12`         | How long an admin stays logged in.                 |

```bash
cp .env.example .env
# then edit ADMIN_PASSWORD
```

## API (used by the front-end)

| Method   | Route                        | Auth  | Purpose                       |
| -------- | ---------------------------- | ----- | ----------------------------- |
| `POST`   | `/api/bookings`              | —     | Submit an inquiry             |
| `POST`   | `/api/admin/login`           | —     | Start an admin session        |
| `POST`   | `/api/admin/logout`          | —     | End the session               |
| `GET`    | `/api/admin/stats`           | admin | Counts by status              |
| `GET`    | `/api/admin/bookings`        | admin | List (`?status=`, `?q=`)      |
| `GET`    | `/api/admin/bookings/:id`    | admin | One booking                   |
| `PATCH`  | `/api/admin/bookings/:id`    | admin | Update status / internal notes|
| `DELETE` | `/api/admin/bookings/:id`    | admin | Delete                        |
| `GET`    | `/api/admin/export.csv`      | admin | Download all bookings as CSV  |

## Scale & performance

Built and load-tested to handle **50,000+ bookings** comfortably on a single
small instance. Measured on a 50,000-row database (single Node process):

| Path                                   | Result                                  |
| -------------------------------------- | --------------------------------------- |
| Admin bookings list (paginated)        | ~7 ms/call · **~970 req/s** · 15 KB/page |
| Filter by status / search (50k rows)   | 6–20 ms (index-backed)                  |
| Stats (the six cards)                  | ~6 ms                                   |
| Booking submissions (writes)           | ~680/sec one-by-one (far past real need)|
| Storage                                | ~240 bytes/row → 50k ≈ 11 MB, 1M ≈ 230 MB |

What keeps it fast at volume:

- **Server-side pagination** — the dashboard fetches one 50-row page at a time
  (`/api/admin/bookings?page=&limit=`), never the whole table.
- **Indexes** on `created_at` and `(status, created_at)` so listing, filtering,
  and "newest first" ordering are index-only (no full-table sort).
- Aggregate **stats** run as a single grouped query.

SQLite's own ceiling is ~281 TB, so storage is never the limit. The signal to
move to a hosted Postgres/Supabase is needing *multiple* app servers or
sustained heavy write concurrency — not row count.

## Deploy to a Node host

Any host that runs Node 22.5+ works (Render, Railway, Fly, a VPS, etc.):

1. Set `ADMIN_PASSWORD` and a long random `SESSION_SECRET` in the host's env.
2. Run `npm install --omit=dev` then `npm start`.
3. Persist the `data/` directory (that's where the SQLite file lives) so
   bookings survive restarts/redeploys.
4. Serve over HTTPS in production — the session cookie is marked `secure` when
   `NODE_ENV=production`.

## Deploy to Cloudflare

Runs as a **Worker** (API + gated admin pages) with **Static Assets** (the form,
CSS/JS, logo) and a **D1** database — fully serverless, no `data/` directory to
persist. Prerequisite: a Cloudflare account and `npm install` (which pulls in
`wrangler`).

**1. Create the D1 database** and paste its id into `wrangler.jsonc`:

```bash
npm run cf:db:create          # wrangler d1 create glambot
# copy the printed database_id → wrangler.jsonc → d1_databases[0].database_id
```

**2. Apply the schema:**

```bash
npm run cf:migrate            # applies migrations/0001_init.sql to remote D1
```

**3. Set the secrets** (do NOT commit these):

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET     # a long random string
```

**4. Deploy:**

```bash
npm run cf:deploy             # wrangler deploy
```

**Local Cloudflare-parity dev** (Workers runtime + local D1 via Miniflare):

```bash
cp .dev.vars.example .dev.vars        # local ADMIN_PASSWORD / SESSION_SECRET
npm run cf:migrate:local              # seed the local D1
npm run cf:dev                        # → http://localhost:8787
```

The session cookie is automatically marked `Secure` on HTTPS (production) and
left off on local `http://localhost`, so login works in both.

## Project layout

```
glam-bot/
├── server.js              # Node/Express entry point
├── src/                   # Node backend
│   ├── db.js              # node:sqlite (runs migrations/0001_init.sql)
│   ├── auth.js            # signed-cookie sessions (node:crypto)
│   ├── validate.js        # booking input validation
│   └── env.js             # tiny .env loader
├── worker/                # Cloudflare Worker backend (ESM)
│   ├── index.js           # router: API + gated admin pages
│   ├── db.js              # D1 queries (same SQL as src/db.js)
│   ├── auth.js            # signed-cookie sessions (Web Crypto)
│   └── validate.js        # booking input validation
├── migrations/
│   └── 0001_init.sql      # shared schema — D1 migrations AND node:sqlite
├── wrangler.jsonc         # Cloudflare config (assets + D1 bindings)
├── public/                # shared frontend (served by both backends)
│   ├── index.html         # the booking form
│   ├── admin/             # login.html, dashboard.html
│   ├── css/               # brand.css, admin.css
│   ├── js/                # form.js, login.js, dashboard.js
│   └── assets/            # logo.png, favicon.svg
└── data/                  # local SQLite DB (Node only; git-ignored)
```

```
glam-bot/
├── server.js              # Express app + routes
├── src/
│   ├── db.js              # node:sqlite schema + queries
│   ├── auth.js            # signed-cookie admin sessions
│   ├── validate.js        # booking input validation
│   └── env.js             # tiny .env loader
├── public/                # static assets served to the browser
│   ├── index.html         # the booking form
│   ├── css/               # brand.css, admin.css
│   ├── js/                # form.js, login.js, dashboard.js
│   └── assets/            # logo.png, favicon.svg
├── views/                 # server-rendered admin pages
│   ├── login.html
│   └── dashboard.html
└── data/                  # SQLite DB (auto-created, git-ignored)
```
