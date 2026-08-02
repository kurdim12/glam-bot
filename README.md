# GLAMBOT — Booking + Admin Dashboard

A self-contained booking system for **GLAMBOT** (cinematic robotic camera arm,
Jordan / MENA). A public inquiry form on the brand's signature dark, cinematic
look, backed by a simple password-protected admin dashboard to manage every
inquiry that comes in.

Deploys two ways from one codebase: as a **Node + SQLite** app on any Node host,
or fully serverless on **Cloudflare** (Workers + D1). The core booking + admin
system needs no third-party services or API keys; the optional agent layer
(Cloudflare only) adds AI call briefs, WhatsApp draft generation, and a daily
Telegram digest behind three secrets — and degrades gracefully without them.

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
- **Agent layer** (Cloudflare Worker only — see
  [The agent layer](#the-agent-layer-cloudflare-only)):
  - every new booking is enriched in the background: normalized phone,
    language (AR/EN), urgency score, and a 2-line AI call brief,
  - returning clients and same-date **double-booking clashes** are flagged
    automatically (badges + drawer detail, no AI involved),
  - a per-booking **"Draft WhatsApp"** button generates a follow-up message in
    the lead's language — the owner reviews, edits, and sends it personally,
  - **invoicing**: an Invoices tab + per-booking invoice editor on the brand
    template (line items, tax, print-to-PDF); the agent drafts the line-item
    *descriptions* from the booking — every price is typed by the owner,
  - a daily **8:00 AM (Amman) Telegram digest** of new + stale leads.

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

| Method   | Route                           | Auth  | Purpose                       |
| -------- | ------------------------------- | ----- | ----------------------------- |
| `POST`   | `/api/bookings`                 | —     | Submit an inquiry             |
| `POST`   | `/api/admin/login`              | —     | Start an admin session        |
| `POST`   | `/api/admin/logout`             | —     | End the session               |
| `GET`    | `/api/admin/stats`              | admin | Counts by status              |
| `GET`    | `/api/admin/bookings`           | admin | List (`?status=`, `?q=`)      |
| `GET`    | `/api/admin/bookings/:id`       | admin | One booking                   |
| `PATCH`  | `/api/admin/bookings/:id`       | admin | Update status / internal notes|
| `DELETE` | `/api/admin/bookings/:id`       | admin | Delete                        |
| `POST`   | `/api/admin/bookings/:id/draft` | admin | AI WhatsApp draft (Worker only) |
| `GET`    | `/api/admin/bookings/:id/context` | admin | Client history + date clashes (Worker only) |
| `GET/POST` | `/api/admin/invoices`         | admin | List / create invoices (Worker only) |
| `GET/PATCH/DELETE` | `/api/admin/invoices/:id` | admin | One invoice (Worker only) |
| `GET`    | `/api/admin/invoices/:id/print` | admin | Print-ready invoice page (Worker only) |
| `POST`   | `/api/admin/bookings/:id/invoice-draft` | admin | AI line-item descriptions (Worker only) |
| `GET`    | `/api/admin/export.csv`         | admin | Download all bookings as CSV  |

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

> ⚠ Both are **required in production** — the code falls back to the dev
> password `glambot` when `ADMIN_PASSWORD` is unset. Verify with
> `npx wrangler secret list`.

The agent layer needs three more (all optional — every feature degrades
gracefully when its secret is missing):

```bash
npx wrangler secret put OPENROUTER_API_KEY   # call briefs + WhatsApp drafts
npx wrangler secret put TELEGRAM_BOT_TOKEN   # daily digest
npx wrangler secret put TELEGRAM_CHAT_ID     # daily digest recipient
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

## The agent layer (Cloudflare only)

Three small agents run inside the Worker. Two hard rules govern all of them:

1. **The public booking path never waits on, or fails because of, an AI
   call.** Enrichment runs *after* the visitor's `201` via `ctx.waitUntil()`,
   and every LLM failure degrades silently to "no brief" — never to a failed
   booking.
2. **Agents draft, humans send.** No message reaches a customer unless the
   owner presses send in WhatsApp themselves. There is no WhatsApp API, no
   auto-reply, no auto-email.

### Intake enrichment (background, per new booking)

On every new inquiry the Worker writes deterministic fields first — normalized
phone (`phone_e164`, e.g. `+962790123456`), language (`lang`: `ar`/`en`, from
Arabic script detection), and urgency (`hot` ≤ 7 days out / `warm` ≤ 30 /
`normal`) — then makes one LLM call (OpenRouter, Gemini Flash Lite with a
fallback model) for a 2-line call brief (`ai_brief`). If the LLM is down or
`OPENROUTER_API_KEY` is unset, the booking still gets the deterministic
fields; the brief just stays empty. The dashboard shows urgency/language
badges, the brief, and `tel:`/`wa.me` links off the normalized number.

### WhatsApp draft button (dashboard)

Each booking's drawer has **✦ Draft WhatsApp**: one LLM call writes a
follow-up in the lead's language (spoken Jordanian Arabic for `ar` leads, not
formal فصحى). The message lands in an editable textarea; **Open WhatsApp**
opens `wa.me` with the *edited* text prefilled, **Copy** copies it. Drafts are
never stored and never sent automatically.

### Returning clients & date clashes (no LLM)

Two deterministic signals, computed from the data itself:

- **↩ returning** — at intake, the Worker counts earlier bookings with the
  same email or phone (`prior_bookings`). The badge appears on the row, and
  the drawer lists the client's previous inquiries (tap one to open it).
- **⚠ date clash** — any shoot date shared by two or more active
  (non-cancelled) bookings is flagged on every affected row, and the drawer
  lists the other bookings on that date. Flexible dates never clash.

### Invoicing (agent drafts descriptions, the owner sets every price)

The **Invoices** tab (and an "Invoices" section in each booking's drawer)
manages numbered invoices — `GB-<year>-0001` — on the GLAMBOT invoice
template: client details, line items, tax %, notes, and a
`draft → sent → paid` status. **⎙ Print / PDF** opens a print-ready page of
the branded template; use the browser's Print → Save as PDF.

The invoice agent (**✦ Draft items**, on invoices created from a booking)
writes the line-item *descriptions* from the booking's occasion, date,
location, and notes. It is forbidden from inventing prices — every amount is
entered by the owner, and all totals are recomputed server-side.

**Sending an invoice:** a saved invoice gets a *Send to client* panel with a
prefilled, editable WhatsApp message (in the lead's language) and:

- **⬇ Download PDF** — a real PDF generated by the Worker itself
  (`/api/admin/invoices/:id/pdf`, hand-built, no libraries). Note: it uses
  the built-in Helvetica fonts, so it's Latin-text only — for Arabic client
  names use the ⎙ Print view, which is full-Unicode.
- **📎 Share PDF + message** (phones/tablets) — hands the PDF straight to
  WhatsApp via the system share sheet; the message is also copied to the
  clipboard in case the share target drops it.
- **Open WhatsApp** — opens the chat with the (edited) message prefilled;
  attach the downloaded PDF there. Nothing is ever sent automatically.

### Daily stale-lead digest (Telegram, no LLM)

A cron trigger (05:00 UTC = **8:00 AM Amman**) sends the owner one Telegram
message: new leads in the last 24 h, leads sitting in `new` for over 20 h
(named, up to 3), leads marked `contacted` with no movement for 3+ days
(named, with tappable wa.me links), and the total `new` count. A completely
quiet day sends nothing.

**Telegram setup:** create a bot with [@BotFather](https://t.me/BotFather) →
that's `TELEGRAM_BOT_TOKEN`. Send your bot any message, then open
`https://api.telegram.org/bot<token>/getUpdates` and read `chat.id` from the
response → that's `TELEGRAM_CHAT_ID`.

Test the cron locally:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+5+*+*+*"
```

### Schema note

The agent columns (`phone_e164`, `lang`, `urgency`, `ai_brief`,
`enriched_at`, `prior_bookings`) are added by the Worker itself on first use — `ensureSchema`
diffs `PRAGMA table_info(bookings)` and `ALTER TABLE`s what's missing, so
there is **no migration to run** and existing rows stay valid. (They are
intentionally not in `migrations/`; the Node/Express backend doesn't use
them.)

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
│   ├── index.js           # router: API + gated admin pages + cron handler
│   ├── db.js              # D1 queries (same SQL as src/db.js)
│   ├── auth.js            # signed-cookie sessions (Web Crypto)
│   ├── validate.js        # booking input validation
│   ├── llm.js             # OpenRouter client (model fallback array)
│   ├── enrich.js          # intake enrichment: phone/lang/urgency + AI brief
│   ├── draft.js           # WhatsApp draft agent (drafts only, humans send)
│   └── digest.js          # daily stale-lead Telegram digest (no LLM)
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
