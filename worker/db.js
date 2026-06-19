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
  ]);
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

function buildWhere({ status, q } = {}) {
  const where = [];
  const params = [];
  if (status && STATUSES.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR location LIKE ? OR occasion LIKE ?)');
    params.push(like, like, like, like, like);
  }
  return { clause: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

export async function listBookings(env, { status, q, limit, offset } = {}) {
  const { clause, params } = buildWhere({ status, q });
  const args = [...params];
  let sql = 'SELECT * FROM bookings' + clause + ' ORDER BY created_at DESC, id DESC';
  if (limit != null) {
    sql += ' LIMIT ? OFFSET ?';
    args.push(limit, offset || 0);
  }
  const res = await env.DB.prepare(sql).bind(...args).all();
  return res.results || [];
}

export async function countBookings(env, { status, q } = {}) {
  const { clause, params } = buildWhere({ status, q });
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
  return { daily: dailyRes.results || [], byOccasion: occRes.results || [] };
}
