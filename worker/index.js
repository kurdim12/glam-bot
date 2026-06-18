// GLAMBOT booking — Cloudflare Worker entrypoint.
//
// Mirrors the Express app's HTTP contract exactly, so the same frontend
// (served from ./public via the ASSETS binding) works unchanged. Data lives
// in Cloudflare D1 (env.DB); auth is an HMAC-signed cookie (worker/auth.js).
//
// Routing: wrangler.jsonc `run_worker_first` invokes this Worker only for
// /api/* and /admin* — every other path (the form, CSS, JS, images) is served
// straight from static assets without touching the Worker.

import * as db from './db.js';
import * as auth from './auth.js';
import { validateBooking } from './validate.js';

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const redirect = (location, status = 302) =>
  new Response(null, { status, headers: { Location: location } });

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Serve an asset file by its clean URL (html_handling resolves *.html).
function serveAsset(env, origin, pathname) {
  return env.ASSETS.fetch(new Request(new URL(pathname, origin), { method: 'GET' }));
}

async function buildCsv(env) {
  const cols = ['id', 'name', 'email', 'phone', 'shoot_date', 'occasion', 'location', 'status', 'notes', 'admin_notes', 'created_at'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let out = cols.join(',');
  // Stream through the table in batches so a huge export never blows the
  // Worker's memory or a single D1 query's result size.
  const limit = 5000;
  let offset = 0;
  for (;;) {
    const rows = await db.listBookings(env, { limit, offset });
    if (!rows.length) break;
    for (const r of rows) out += '\n' + cols.map((c) => esc(r[c])).join(',');
    offset += rows.length;
    if (rows.length < limit) break;
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, origin } = url;
    const method = request.method;
    const secure = url.protocol === 'https:';

    // ── Public: create a booking inquiry ──────────────────────────────────
    if (pathname === '/api/bookings' && method === 'POST') {
      const body = await readJson(request);
      // Honeypot: humans never fill the hidden "website" field.
      if (String(body.website || '').trim() !== '') return json({ ok: true }, 201);

      const result = validateBooking(body);
      if (!result.ok) return json({ ok: false, errors: result.errors }, 422);
      try {
        const id = await db.createBooking(env, result.value);
        return json({ ok: true, id }, 201);
      } catch (err) {
        console.error('Failed to save booking:', err);
        return json({ ok: false, error: 'Could not save your inquiry.' }, 500);
      }
    }

    // ── Admin auth ─────────────────────────────────────────────────────────
    if (pathname === '/api/admin/login' && method === 'POST') {
      const body = await readJson(request);
      if (!(await auth.checkPassword(env, body.password))) {
        return json({ ok: false, error: 'Incorrect password.' }, 401);
      }
      return json({ ok: true }, 200, { 'Set-Cookie': auth.sessionCookie(env, await auth.issueToken(env), secure) });
    }
    if (pathname === '/api/admin/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': auth.clearCookie(secure) });
    }
    if (pathname === '/api/admin/me' && method === 'GET') {
      return json({ ok: true, authed: await auth.isAuthed(request, env) });
    }

    // ── Guarded admin data API ─────────────────────────────────────────────
    if (pathname.startsWith('/api/admin/')) {
      if (!(await auth.isAuthed(request, env))) {
        return json({ ok: false, error: 'Not authenticated' }, 401);
      }

      if (pathname === '/api/admin/stats' && method === 'GET') {
        return json({ ok: true, ...(await db.stats(env)) });
      }

      if (pathname === '/api/admin/bookings' && method === 'GET') {
        const status = url.searchParams.get('status') || undefined;
        const q = url.searchParams.get('q') || undefined;
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 50, 1), 200);
        const total = await db.countBookings(env, { status, q });
        const pages = Math.max(1, Math.ceil(total / limit));
        const page = Math.min(Math.max(parseInt(url.searchParams.get('page'), 10) || 1, 1), pages);
        const bookings = await db.listBookings(env, { status, q, limit, offset: (page - 1) * limit });
        return json({ ok: true, bookings, total, page, pages, limit });
      }

      if (pathname === '/api/admin/export.csv' && method === 'GET') {
        return new Response(await buildCsv(env), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="glambot-bookings-${Date.now()}.csv"`,
          },
        });
      }

      const m = pathname.match(/^\/api\/admin\/bookings\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if (method === 'GET') {
          const booking = await db.getBooking(env, id);
          return booking ? json({ ok: true, booking }) : json({ ok: false, error: 'Not found.' }, 404);
        }
        if (method === 'PATCH') {
          const body = await readJson(request);
          if (body.status !== undefined && !db.STATUSES.includes(body.status)) {
            return json({ ok: false, error: 'Unknown status.' }, 422);
          }
          const booking = await db.updateBooking(env, id, { status: body.status, admin_notes: body.admin_notes });
          return booking ? json({ ok: true, booking }) : json({ ok: false, error: 'Not found.' }, 404);
        }
        if (method === 'DELETE') {
          const ok = await db.deleteBooking(env, id);
          return ok ? json({ ok: true }) : json({ ok: false, error: 'Not found.' }, 404);
        }
      }

      return json({ ok: false, error: 'Not found.' }, 404);
    }

    // ── Admin pages (gated, served from static assets) ─────────────────────
    if (pathname === '/admin') {
      return redirect((await auth.isAuthed(request, env)) ? '/admin/dashboard' : '/admin/login');
    }
    if (pathname === '/admin/login') {
      if (await auth.isAuthed(request, env)) return redirect('/admin/dashboard');
      return serveAsset(env, origin, '/admin/login');
    }
    if (pathname === '/admin/dashboard') {
      if (!(await auth.isAuthed(request, env))) return redirect('/admin/login');
      return serveAsset(env, origin, '/admin/dashboard');
    }

    // Any other /api/* or /admin* that reached the Worker is a 404 / asset.
    if (pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found.' }, 404);
    return env.ASSETS.fetch(request);
  },
};
