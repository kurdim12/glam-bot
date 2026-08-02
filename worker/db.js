// Data layer for the Cloudflare Worker — same queries as src/db.js, but run
// against Cloudflare D1 (which is SQLite) via env.DB prepared statements.

export const STATUSES = ['new', 'contacted', 'booked', 'completed', 'cancelled'];

// Auto-create the schema on first DB use (once per isolate). This mirrors
// migrations/0001_init.sql so a Git-push / CI deploy "just works" against a
// brand-new D1 database without a separate `wrangler d1 migrations apply` step.
// All statements are idempotent (IF NOT EXISTS), so it's safe to re-run.
let schemaReady = false;
export async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
        shoot_date TEXT, occasion TEXT, location TEXT, notes TEXT,
        status TEXT NOT NULL DEFAULT 'new', admin_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`
    ),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_status_created ON bookings(status, created_at)'),
    // Serves the date-clash lookups (and same-date drawer context).
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_shoot_date ON bookings(shoot_date)'),
  ]);

  // Agent-layer columns, added after the fact — ALTER TABLE has no IF NOT
  // EXISTS in SQLite, so diff against PRAGMA table_info instead. All nullable,
  // no defaults: pre-existing rows stay valid, un-enriched rows read as NULL.
  // Invoices (agent layer): line items live as a JSON array in `items`
  // ([{description, amount}]); totals are recomputed server-side on render so
  // stored JSON is never trusted for money math.
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL UNIQUE,
        booking_id INTEGER,
        client_name TEXT NOT NULL,
        client_contact TEXT NOT NULL DEFAULT '',
        items TEXT NOT NULL DEFAULT '[]',
        tax_rate REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'JOD',
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        issued_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`
    ),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at)'),
  ]);

  // Invoice columns added after the first release — same PRAGMA-diff pattern.
  const invInfo = await env.DB.prepare('PRAGMA table_info(invoices)').all();
  const invHave = new Set((invInfo.results || []).map((c) => c.name));
  for (const [name, type] of [
    ['payment_terms', 'TEXT'], // template meta field, e.g. "50% deposit to confirm"
    ['event_date', 'TEXT'], // the shoot date the invoice covers
  ]) {
    if (!invHave.has(name)) {
      try {
        await env.DB.prepare(`ALTER TABLE invoices ADD COLUMN ${name} ${type}`).run();
      } catch (err) {
        if (!/duplicate column/i.test(String(err) + String(err?.cause || ''))) throw err;
      }
    }
  }

  const info = await env.DB.prepare('PRAGMA table_info(bookings)').all();
  const have = new Set((info.results || []).map((c) => c.name));
  const wanted = [
    ['phone_e164', 'TEXT'], // normalized phone (+962...), NULL if unparseable
    ['lang', 'TEXT'], // 'ar' | 'en'
    ['urgency', 'TEXT'], // 'hot' | 'warm' | 'normal'
    ['ai_brief', 'TEXT'], // 2-line LLM call brief
    ['enriched_at', 'TEXT'], // ISO timestamp of successful LLM enrichment
    ['prior_bookings', 'INTEGER'], // same-client bookings that existed at intake
  ];
  for (const [name, type] of wanted) {
    if (!have.has(name)) {
      try {
        await env.DB.prepare(`ALTER TABLE bookings ADD COLUMN ${name} ${type}`).run();
      } catch (err) {
        // Two fresh isolates can race the PRAGMA check; the loser's ALTER
        // hits "duplicate column name". The column exists — that's success.
        if (!/duplicate column/i.test(String(err) + String(err?.cause || ''))) throw err;
      }
    }
  }

  schemaReady = true;
}

export async function createBooking(env, b) {
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `INSERT INTO bookings (name, email, phone, shoot_date, occasion, location, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
  )
    .bind(b.name, b.email, b.phone, b.shoot_date || null, b.occasion || null, b.location || null, b.notes || null, now, now)
    .run();
  return res.meta.last_row_id;
}

export async function getBooking(env, id) {
  return (await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first()) || null;
}

function buildWhere({ status, q, occasion } = {}) {
  const where = [];
  const params = [];
  if (status && STATUSES.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (occasion && occasion.trim()) {
    // Match the same bucket the pivot/analytics show — blank occasions roll up to 'Other'.
    where.push("COALESCE(NULLIF(occasion, ''), 'Other') = ?");
    params.push(occasion.trim());
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR location LIKE ? OR occasion LIKE ?)');
    params.push(like, like, like, like, like);
  }
  return { clause: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

export async function listBookings(env, { status, q, occasion, limit, offset } = {}) {
  const { clause, params } = buildWhere({ status, q, occasion });
  const args = [...params];
  let sql = 'SELECT * FROM bookings' + clause + ' ORDER BY created_at DESC, id DESC';
  if (limit != null) {
    sql += ' LIMIT ? OFFSET ?';
    args.push(limit, offset || 0);
  }
  const res = await env.DB.prepare(sql).bind(...args).all();
  return res.results || [];
}

export async function countBookings(env, { status, q, occasion } = {}) {
  const { clause, params } = buildWhere({ status, q, occasion });
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings' + clause).bind(...params).first();
  return row ? row.n : 0;
}

export async function updateBooking(env, id, { status, admin_notes }) {
  const existing = await getBooking(env, id);
  if (!existing) return null;

  const nextStatus = status !== undefined && STATUSES.includes(status) ? status : existing.status;
  const nextNotes = admin_notes !== undefined ? String(admin_notes).slice(0, 4000) : existing.admin_notes;

  await env.DB.prepare('UPDATE bookings SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?')
    .bind(nextStatus, nextNotes, new Date().toISOString(), id)
    .run();

  return getBooking(env, id);
}

export async function deleteBooking(env, id) {
  const res = await env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id).run();
  return res.meta.changes > 0;
}

/**
 * Which of these shoot dates are shared by 2+ active bookings — the machine
 * can't be in two places. Bounded to the caller's candidate dates (a page of
 * rows, or one booking) so the hot list endpoint stays index-backed instead
 * of scanning the whole table on every call. The booking form stores
 * shoot_date as either an ISO date or "Flexible"; only real dates can clash
 * (all the Flexibles would otherwise "collide"), so non-ISO values are
 * dropped before they ever reach SQL.
 */
export async function dateClashSet(env, dates) {
  const unique = [...new Set((dates || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')))];
  const out = new Set();
  // D1 caps bound parameters per statement — chunk large date lists.
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const res = await env.DB.prepare(
      `SELECT shoot_date FROM bookings
       WHERE status != 'cancelled' AND shoot_date IN (${chunk.map(() => '?').join(',')})
       GROUP BY shoot_date HAVING COUNT(*) > 1`
    )
      .bind(...chunk)
      .all();
    for (const r of res.results || []) out.add(r.shoot_date);
  }
  return out;
}

/** Other bookings by the same client (matched on email or phone). */
function sameClientQuery(select) {
  return `SELECT ${select} FROM bookings
     WHERE id != ? AND (LOWER(email) = LOWER(?) OR phone = ?
       OR (phone_e164 IS NOT NULL AND phone_e164 = ?))`;
}

export async function countPriorBookings(env, booking) {
  const row = await env.DB.prepare(sameClientQuery('COUNT(*) AS n'))
    .bind(booking.id, booking.email || '', booking.phone || '', booking.phone_e164 || '')
    .first();
  return row ? row.n : 0;
}

/** Drawer context: this client's other inquiries + same-date bookings. */
export async function bookingContext(env, booking) {
  const historyRes = await env.DB.prepare(
    sameClientQuery('id, occasion, shoot_date, status, created_at') +
      ' ORDER BY created_at DESC LIMIT 5'
  )
    .bind(booking.id, booking.email || '', booking.phone || '', booking.phone_e164 || '')
    .all();

  let same_date = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(booking.shoot_date || '')) {
    const res = await env.DB.prepare(
      `SELECT id, name, occasion, status FROM bookings
       WHERE id != ? AND shoot_date = ? AND status != 'cancelled'
       ORDER BY created_at DESC LIMIT 5`
    )
      .bind(booking.id, booking.shoot_date)
      .all();
    same_date = res.results || [];
  }
  const history = historyRes.results || [];
  // history is LIMITed to 5 — report the true total so the drawer label is honest.
  const history_total = history.length < 5 ? history.length : await countPriorBookings(env, booking);
  return { history, history_total, same_date };
}

/* ── Invoices ───────────────────────────────────────────────────────────── */

export const INVOICE_STATUSES = ['draft', 'sent', 'paid'];

/** Normalize client-supplied line items: strings + finite non-negative numbers only. */
export function sanitizeInvoiceItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({
      description: String(it && it.description ? it.description : '').trim().slice(0, 200),
      amount: Math.max(0, Math.round((Number(it && it.amount) || 0) * 100) / 100),
    }))
    .filter((it) => it.description)
    .slice(0, 20);
}

/** Next number in the GB-<year>-NNNN sequence (single-admin shop; no race expected). */
async function nextInvoiceNumber(env) {
  const year = new Date().getFullYear();
  const prefix = `GB-${year}-`;
  const row = await env.DB.prepare(
    'SELECT number FROM invoices WHERE number LIKE ? ORDER BY id DESC LIMIT 1'
  )
    .bind(prefix + '%')
    .first();
  const last = row ? parseInt(row.number.slice(prefix.length), 10) || 0 : 0;
  return prefix + String(last + 1).padStart(4, '0');
}

export async function createInvoice(env, inv) {
  const now = new Date().toISOString();
  const items = JSON.stringify(sanitizeInvoiceItems(inv.items));
  // One retry in case two isolates grab the same number (UNIQUE constraint).
  for (let attempt = 0; ; attempt++) {
    const number = await nextInvoiceNumber(env);
    try {
      const res = await env.DB.prepare(
        `INSERT INTO invoices (number, booking_id, client_name, client_contact, items, tax_rate, currency, notes, payment_terms, event_date, status, issued_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'JOD', ?, ?, ?, 'draft', ?, ?, ?)`
      )
        .bind(
          number,
          inv.booking_id || null,
          String(inv.client_name || '').slice(0, 120),
          String(inv.client_contact || '').slice(0, 200),
          items,
          Math.min(Math.max(Number(inv.tax_rate) || 0, 0), 100),
          String(inv.notes || '').slice(0, 1000),
          String(inv.payment_terms || '').slice(0, 200),
          String(inv.event_date || '').slice(0, 40),
          inv.issued_at || now.slice(0, 10),
          now,
          now
        )
        .run();
      return res.meta.last_row_id;
    } catch (err) {
      if (attempt >= 1 || !/unique/i.test(String(err) + String(err?.cause || ''))) throw err;
    }
  }
}

export async function getInvoice(env, id) {
  return (await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first()) || null;
}

export async function listInvoices(env, { booking_id, limit = 100, offset = 0 } = {}) {
  const res = booking_id
    ? await env.DB.prepare('SELECT * FROM invoices WHERE booking_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
        .bind(booking_id, limit, offset)
        .all()
    : await env.DB.prepare('SELECT * FROM invoices ORDER BY id DESC LIMIT ? OFFSET ?').bind(limit, offset).all();
  return res.results || [];
}

export async function countInvoices(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM invoices').first();
  return row ? row.n : 0;
}

export async function updateInvoice(env, id, patch) {
  const existing = await getInvoice(env, id);
  if (!existing) return null;
  const next = {
    client_name: patch.client_name !== undefined ? String(patch.client_name).slice(0, 120) : existing.client_name,
    client_contact:
      patch.client_contact !== undefined ? String(patch.client_contact).slice(0, 200) : existing.client_contact,
    items: patch.items !== undefined ? JSON.stringify(sanitizeInvoiceItems(patch.items)) : existing.items,
    tax_rate:
      patch.tax_rate !== undefined ? Math.min(Math.max(Number(patch.tax_rate) || 0, 0), 100) : existing.tax_rate,
    notes: patch.notes !== undefined ? String(patch.notes).slice(0, 1000) : existing.notes,
    payment_terms:
      patch.payment_terms !== undefined ? String(patch.payment_terms).slice(0, 200) : existing.payment_terms,
    event_date: patch.event_date !== undefined ? String(patch.event_date).slice(0, 40) : existing.event_date,
    status:
      patch.status !== undefined && INVOICE_STATUSES.includes(patch.status) ? patch.status : existing.status,
    issued_at: patch.issued_at !== undefined ? String(patch.issued_at).slice(0, 10) : existing.issued_at,
  };
  await env.DB.prepare(
    `UPDATE invoices SET client_name = ?, client_contact = ?, items = ?, tax_rate = ?, notes = ?, payment_terms = ?, event_date = ?, status = ?, issued_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      next.client_name,
      next.client_contact,
      next.items,
      next.tax_rate,
      next.notes,
      next.payment_terms,
      next.event_date,
      next.status,
      next.issued_at,
      new Date().toISOString(),
      id
    )
    .run();
  return getInvoice(env, id);
}

export async function deleteInvoice(env, id) {
  const res = await env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run();
  return res.meta.changes > 0;
}

export async function stats(env) {
  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings').first();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const res = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM bookings GROUP BY status').all();
  for (const r of res.results || []) {
    if (r.status in byStatus) byStatus[r.status] = r.n;
  }
  return { total: totalRow ? totalRow.n : 0, byStatus };
}

/** Data for the analytics panel: 14-day trend + occasion breakdown. */
export async function analytics(env) {
  const cutoff = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const dailyRes = await env.DB.prepare(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
     FROM bookings WHERE created_at >= ? GROUP BY day ORDER BY day`
  ).bind(cutoff).all();
  const occRes = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(occasion, ''), 'Other') AS occasion, COUNT(*) AS n
     FROM bookings GROUP BY occasion ORDER BY n DESC, occasion LIMIT 8`
  ).all();
  return {
    daily: dailyRes.results || [],
    byOccasion: occRes.results || [],
  };
}
