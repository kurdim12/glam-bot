'use strict';

/**
 * Data layer — built on Node's built-in SQLite (node:sqlite).
 * No native compilation, no external database server. The whole dataset
 * lives in a single file under data/glambot.db.
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'glambot.db'));

// Pragmas for a small, single-writer web app.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Schema is the same SQL file Cloudflare D1 uses (migrations/0001_init.sql),
// so both backends stay in lockstep. D1 is SQLite too, hence the shared DDL.
const schema = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '0001_init.sql'),
  'utf8'
);
db.exec(schema);

/** The status pipeline a booking moves through. */
const STATUSES = ['new', 'contacted', 'booked', 'completed', 'cancelled'];

const insertStmt = db.prepare(`
  INSERT INTO bookings (name, email, phone, shoot_date, occasion, location, notes, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
`);

function createBooking(b) {
  const now = new Date().toISOString();
  const info = insertStmt.run(
    b.name,
    b.email,
    b.phone,
    b.shoot_date || null,
    b.occasion || null,
    b.location || null,
    b.notes || null,
    now,
    now
  );
  return getBooking(Number(info.lastInsertRowid));
}

function getBooking(id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) || null;
}

/** Build the shared WHERE clause + bound params for a status/search filter. */
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

/**
 * List bookings with optional status filter and free-text search, newest
 * first. Pass `limit`/`offset` to fetch a single page; omit `limit` to get
 * every matching row (used by the CSV export).
 *
 * created_at is stored as an ISO-8601 string, so a plain DESC sort is both
 * chronological and index-friendly (idx_bookings_created) — no per-row
 * datetime() call, which keeps this fast at tens of thousands of rows.
 */
function listBookings({ status, q, limit, offset } = {}) {
  const { clause, params } = buildWhere({ status, q });
  const args = [...params];

  let sql = 'SELECT * FROM bookings' + clause + ' ORDER BY created_at DESC, id DESC';
  if (limit != null) {
    sql += ' LIMIT ? OFFSET ?';
    args.push(limit, offset || 0);
  }
  return db.prepare(sql).all(...args);
}

/** Count bookings matching the same filters (drives pagination totals). */
function countBookings({ status, q } = {}) {
  const { clause, params } = buildWhere({ status, q });
  return db.prepare('SELECT COUNT(*) AS n FROM bookings' + clause).get(...params).n;
}

function updateBooking(id, { status, admin_notes }) {
  const existing = getBooking(id);
  if (!existing) return null;

  const nextStatus =
    status !== undefined && STATUSES.includes(status) ? status : existing.status;
  const nextNotes =
    admin_notes !== undefined ? String(admin_notes).slice(0, 4000) : existing.admin_notes;

  db.prepare(
    'UPDATE bookings SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?'
  ).run(nextStatus, nextNotes, new Date().toISOString(), id);

  return getBooking(id);
}

function deleteBooking(id) {
  const info = db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  return info.changes > 0;
}

/** Aggregate counts used by the dashboard stat cards. */
function stats() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS n FROM bookings GROUP BY status')
    .all()) {
    byStatus[row.status] = row.n;
  }
  return { total, byStatus };
}

/** Data for the analytics panel: 14-day trend + occasion breakdown. */
function analytics() {
  const cutoff = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const daily = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
       FROM bookings WHERE created_at >= ? GROUP BY day ORDER BY day`
    )
    .all(cutoff);
  const byOccasion = db
    .prepare(
      `SELECT COALESCE(NULLIF(occasion, ''), 'Other') AS occasion, COUNT(*) AS n
       FROM bookings GROUP BY occasion ORDER BY n DESC, occasion LIMIT 8`
    )
    .all();
  return { daily, byOccasion };
}

module.exports = {
  db,
  STATUSES,
  createBooking,
  getBooking,
  listBookings,
  countBookings,
  updateBooking,
  deleteBooking,
  stats,
  analytics,
};
