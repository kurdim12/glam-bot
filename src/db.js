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

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL,
    phone       TEXT    NOT NULL,
    shoot_date  TEXT,
    occasion    TEXT,
    location    TEXT,
    notes       TEXT,
    status      TEXT    NOT NULL DEFAULT 'new',
    admin_notes TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);');
db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at);');

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

/**
 * List bookings with optional status filter and free-text search.
 * Sorted newest first.
 */
function listBookings({ status, q } = {}) {
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

  const sql =
    'SELECT * FROM bookings' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY datetime(created_at) DESC, id DESC';

  return db.prepare(sql).all(...params);
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

module.exports = {
  db,
  STATUSES,
  createBooking,
  getBooking,
  listBookings,
  updateBooking,
  deleteBooking,
  stats,
};
