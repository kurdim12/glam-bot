# GLAMBOT — Booking + Admin Dashboard

A self-contained booking system for **GLAMBOT** (cinematic robotic camera arm,
Jordan / MENA). A public inquiry form on the brand's signature dark, cinematic
look, backed by a simple password-protected admin dashboard to manage every
inquiry that comes in.

No external services, no API keys, no database server — just Node and a single
SQLite file.

---

## What's inside

- **Public form** (`/`) — the "Reserve the machine" booking inquiry: name,
  email, WhatsApp/phone, shoot date, occasion, location, and notes. Validated
  client- and server-side, with a honeypot to deter spam bots.
- **Admin dashboard** (`/admin`) — password login, then:
  - stat cards (Total / New / Contacted / Booked / Completed / Cancelled) that
    double as one-click filters,
  - searchable, sortable table of every inquiry,
  - a detail drawer to read the full brief, click-to-WhatsApp / email the
    client, move a booking through its status pipeline, and jot internal notes,
  - delete, and a one-click **CSV export** of all bookings.

## Tech

- **Node.js ≥ 22.5** with the built-in `node:sqlite` module (no native build step).
- **Express** is the only runtime dependency.
- Storage is one file: `data/glambot.db` (created automatically, git-ignored).

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

## Deploying

Any host that runs Node 22.5+ works (Render, Railway, Fly, a VPS, etc.):

1. Set `ADMIN_PASSWORD` and a long random `SESSION_SECRET` in the host's env.
2. Run `npm install --omit=dev` then `npm start`.
3. Persist the `data/` directory (that's where the SQLite file lives) so
   bookings survive restarts/redeploys.
4. Serve over HTTPS in production — the session cookie is marked `secure` when
   `NODE_ENV=production`.

## Project layout

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
