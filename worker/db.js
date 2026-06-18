// Data layer for the Cloudflare Worker — same queries as src/db.js, but run
// against Cloudflare D1 (which is SQLite) via env.DB prepared statements.

export const STATUSES = ['new', 'contacted', 'booked', 'completed', 'cancelled'];

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
