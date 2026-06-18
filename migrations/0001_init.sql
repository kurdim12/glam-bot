-- GLAMBOT bookings schema.
-- Single source of truth shared by both backends:
--   • Cloudflare D1  → applied via `wrangler d1 migrations apply`
--   • Local Node     → executed by src/db.js against node:sqlite
-- Keep this portable SQLite DDL only (no PRAGMAs — D1 manages those itself).

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

CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at);

-- Composite index serves "filter by status, newest first" (and status-only
-- counts via its prefix) without a sort — keeps the dashboard fast at 50k+.
CREATE INDEX IF NOT EXISTS idx_bookings_status_created ON bookings(status, created_at);
