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
import { enrichBooking } from './enrich.js';
import { generateDraft } from './draft.js';
import { runDigest } from './digest.js';
import { draftInvoiceItems, renderInvoiceHtml, computeTotals } from './invoice.js';
import { buildInvoicePdf } from './pdf.js';

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
  async fetch(request, env, ctx) {
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
        await db.ensureSchema(env);
        const id = await db.createBooking(env, result.value);
        // Enrichment (phone/lang/urgency + LLM call brief) runs after this
        // response is sent — the visitor never waits on, or fails because
        // of, an AI call. enrichBooking never rejects.
        ctx.waitUntil(enrichBooking(env, id));
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
      await db.ensureSchema(env);

      if (pathname === '/api/admin/stats' && method === 'GET') {
        return json({ ok: true, ...(await db.stats(env)) });
      }

      if (pathname === '/api/admin/analytics' && method === 'GET') {
        return json({ ok: true, ...(await db.analytics(env)) });
      }

      if (pathname === '/api/admin/bookings' && method === 'GET') {
        const status = url.searchParams.get('status') || undefined;
        const q = url.searchParams.get('q') || undefined;
        const occasion = url.searchParams.get('occasion') || undefined;
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 50, 1), 200);
        const total = await db.countBookings(env, { status, q, occasion });
        const pages = Math.max(1, Math.ceil(total / limit));
        const page = Math.min(Math.max(parseInt(url.searchParams.get('page'), 10) || 1, 1), pages);
        const bookings = await db.listBookings(env, { status, q, occasion, limit, offset: (page - 1) * limit });
        // Flag bookings whose shoot date is shared with another active booking.
        const clashes = await db.dateClashSet(env, bookings.map((b) => b.shoot_date));
        for (const b of bookings) b.date_clash = b.status !== 'cancelled' && clashes.has(b.shoot_date);
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

      // ── Invoices ──────────────────────────────────────────────────────
      if (pathname === '/api/admin/invoices' && method === 'GET') {
        const booking_id = parseInt(url.searchParams.get('booking_id'), 10) || undefined;
        const invoices = await db.listInvoices(env, { booking_id });
        return json({ ok: true, invoices, total: await db.countInvoices(env) });
      }
      if (pathname === '/api/admin/invoices' && method === 'POST') {
        const body = await readJson(request);
        if (!String(body.client_name || '').trim()) {
          return json({ ok: false, error: 'Client name is required.' }, 422);
        }
        const id = await db.createInvoice(env, body);
        return json({ ok: true, invoice: await db.getInvoice(env, id) }, 201);
      }

      const im = pathname.match(/^\/api\/admin\/invoices\/(\d+)(\/print|\/pdf)?$/);
      if (im) {
        const invoice = await db.getInvoice(env, Number(im[1]));
        if (!invoice) {
          return im[2]
            ? new Response('Invoice not found.', { status: 404 })
            : json({ ok: false, error: 'Not found.' }, 404);
        }
        // Print view: a full HTML page the browser prints to PDF.
        if (im[2] === '/print' && method === 'GET') {
          return new Response(renderInvoiceHtml(invoice), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        // Direct download: a real PDF file, generated in the Worker.
        if (im[2] === '/pdf' && method === 'GET') {
          return new Response(buildInvoicePdf(invoice, computeTotals(invoice.items, invoice.tax_rate)), {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="Invoice-${invoice.number}.pdf"`,
            },
          });
        }
        if (!im[2] && method === 'GET') return json({ ok: true, invoice });
        if (!im[2] && method === 'PATCH') {
          const body = await readJson(request);
          if (body.status !== undefined && !db.INVOICE_STATUSES.includes(body.status)) {
            return json({ ok: false, error: 'Unknown status.' }, 422);
          }
          return json({ ok: true, invoice: await db.updateInvoice(env, invoice.id, body) });
        }
        if (!im[2] && method === 'DELETE') {
          await db.deleteInvoice(env, invoice.id);
          return json({ ok: true });
        }
      }

      // Invoice agent: draft line-item DESCRIPTIONS from the booking. The
      // model never sets an amount — pricing stays with the owner.
      const ivd = pathname.match(/^\/api\/admin\/bookings\/(\d+)\/invoice-draft$/);
      if (ivd && method === 'POST') {
        const booking = await db.getBooking(env, Number(ivd[1]));
        if (!booking) return json({ ok: false, error: 'Not found.' }, 404);
        try {
          return json({ ok: true, items: await draftInvoiceItems(env, booking) });
        } catch (err) {
          console.error(`Invoice draft failed for booking ${booking.id}:`, err);
          const msg = String(err && err.message);
          let error = 'Draft failed, try again.';
          if (msg.includes('not set')) error = 'OpenRouter API key missing — add the OPENROUTER_API_KEY secret in Cloudflare and deploy.';
          else if (msg.includes('OpenRouter 401')) error = 'OpenRouter rejected the API key — re-check its value in Cloudflare.';
          else if (msg.includes('OpenRouter 402')) error = 'OpenRouter account has no credits — top up at openrouter.ai.';
          return json({ ok: false, error }, 502);
        }
      }

      // Drawer context: same-client history + same-date bookings.
      const cm = pathname.match(/^\/api\/admin\/bookings\/(\d+)\/context$/);
      if (cm && method === 'GET') {
        const booking = await db.getBooking(env, Number(cm[1]));
        if (!booking) return json({ ok: false, error: 'Not found.' }, 404);
        return json({ ok: true, ...(await db.bookingContext(env, booking)) });
      }

      // Draft a WhatsApp follow-up (agents draft, humans send — the admin
      // reviews/edits in the dashboard and sends via wa.me themselves).
      const dm = pathname.match(/^\/api\/admin\/bookings\/(\d+)\/draft$/);
      if (dm && method === 'POST') {
        const booking = await db.getBooking(env, Number(dm[1]));
        if (!booking) return json({ ok: false, error: 'Not found.' }, 404);
        try {
          const { message, wa_url } = await generateDraft(env, booking);
          return json({ ok: true, message, wa_url });
        } catch (err) {
          console.error(`Draft failed for booking ${booking.id}:`, err);
          // Tell the admin exactly what to fix — this panel is the only
          // place LLM problems ever surface (enrichment fails silently).
          const msg = String(err && err.message);
          let error = 'Draft failed, try again.';
          if (msg.includes('not set')) error = 'OpenRouter API key missing — add the OPENROUTER_API_KEY secret in Cloudflare and deploy.';
          else if (msg.includes('OpenRouter 401')) error = 'OpenRouter rejected the API key — re-check its value in Cloudflare.';
          else if (msg.includes('OpenRouter 402')) error = 'OpenRouter account has no credits — top up at openrouter.ai.';
          else if (msg.includes('OpenRouter 404')) error = 'OpenRouter found no usable model — check the privacy/data settings on openrouter.ai.';
          return json({ ok: false, error }, 502);
        }
      }

      // Single-booking responses carry the same date_clash flag as the list,
      // so a drawer save doesn't silently wipe the badge off the row.
      const annotateClash = async (booking) => {
        const clashes = await db.dateClashSet(env, [booking.shoot_date]);
        booking.date_clash = booking.status !== 'cancelled' && clashes.has(booking.shoot_date);
        return booking;
      };

      const m = pathname.match(/^\/api\/admin\/bookings\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if (method === 'GET') {
          const booking = await db.getBooking(env, id);
          return booking ? json({ ok: true, booking: await annotateClash(booking) }) : json({ ok: false, error: 'Not found.' }, 404);
        }
        if (method === 'PATCH') {
          const body = await readJson(request);
          if (body.status !== undefined && !db.STATUSES.includes(body.status)) {
            return json({ ok: false, error: 'Unknown status.' }, 422);
          }
          const booking = await db.updateBooking(env, id, { status: body.status, admin_notes: body.admin_notes });
          return booking ? json({ ok: true, booking: await annotateClash(booking) }) : json({ ok: false, error: 'Not found.' }, 404);
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

  // Daily stale-lead digest (05:00 UTC = 08:00 Amman, see wrangler.jsonc).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDigest(env));
  },
};
