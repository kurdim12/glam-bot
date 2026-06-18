'use strict';

/**
 * GLAMBOT booking server.
 *
 *   Public:   /                      cinematic booking inquiry form
 *             POST /api/bookings     create an inquiry
 *
 *   Admin:    /admin                 dashboard (password-protected)
 *             POST /api/admin/login  start a session
 *             ... CRUD over /api/admin/bookings
 *
 * Storage is a single SQLite file (data/glambot.db). See README.md.
 */

// Load .env if present (tiny parser — avoids a dotenv dependency).
require('./src/env').load();

const path = require('node:path');
const express = require('express');

const db = require('./src/db');
const auth = require('./src/auth');
const { validateBooking } = require('./src/validate');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

const PUBLIC_DIR = path.join(__dirname, 'public');
const VIEWS_DIR = path.join(__dirname, 'views');

// ─── Public site ────────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Create a booking inquiry.
app.post('/api/bookings', (req, res) => {
  // Honeypot: real users never fill the hidden "website" field. Bots do.
  if (req.body && String(req.body.website || '').trim() !== '') {
    return res.status(201).json({ ok: true });
  }

  const result = validateBooking(req.body || {});
  if (!result.ok) {
    return res.status(422).json({ ok: false, errors: result.errors });
  }

  try {
    const booking = db.createBooking(result.value);
    return res.status(201).json({ ok: true, id: booking.id });
  } catch (err) {
    console.error('Failed to save booking:', err);
    return res.status(500).json({ ok: false, error: 'Could not save your inquiry.' });
  }
});

// ─── Admin auth ──────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const password = req.body && req.body.password;
  if (!auth.checkPassword(password)) {
    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
  }
  auth.setSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ ok: true, authed: auth.isAuthed(req) });
});

// ─── Admin data API (guarded) ────────────────────────────────────────────────
app.get('/api/admin/stats', auth.requireAuth, (req, res) => {
  res.json({ ok: true, ...db.stats() });
});

app.get('/api/admin/bookings', auth.requireAuth, (req, res) => {
  const { status, q } = req.query;
  res.json({ ok: true, bookings: db.listBookings({ status, q }) });
});

app.get('/api/admin/bookings/:id', auth.requireAuth, (req, res) => {
  const booking = db.getBooking(Number(req.params.id));
  if (!booking) return res.status(404).json({ ok: false, error: 'Not found.' });
  res.json({ ok: true, booking });
});

app.patch('/api/admin/bookings/:id', auth.requireAuth, (req, res) => {
  const { status, admin_notes } = req.body || {};
  if (status !== undefined && !db.STATUSES.includes(status)) {
    return res.status(422).json({ ok: false, error: 'Unknown status.' });
  }
  const updated = db.updateBooking(Number(req.params.id), { status, admin_notes });
  if (!updated) return res.status(404).json({ ok: false, error: 'Not found.' });
  res.json({ ok: true, booking: updated });
});

app.delete('/api/admin/bookings/:id', auth.requireAuth, (req, res) => {
  const ok = db.deleteBooking(Number(req.params.id));
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found.' });
  res.json({ ok: true });
});

// CSV export of all inquiries.
app.get('/api/admin/export.csv', auth.requireAuth, (req, res) => {
  const rows = db.listBookings({});
  const cols = [
    'id', 'name', 'email', 'phone', 'shoot_date', 'occasion',
    'location', 'status', 'notes', 'admin_notes', 'created_at',
  ];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(',')]
    .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(',')))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="glambot-bookings-${Date.now()}.csv"`);
  res.send(csv);
});

// ─── Admin pages ─────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.redirect(auth.isAuthed(req) ? '/admin/dashboard' : '/admin/login');
});

app.get('/admin/login', (req, res) => {
  if (auth.isAuthed(req)) return res.redirect('/admin/dashboard');
  res.sendFile(path.join(VIEWS_DIR, 'login.html'));
});

app.get('/admin/dashboard', (req, res) => {
  if (!auth.isAuthed(req)) return res.redirect('/admin/login');
  res.sendFile(path.join(VIEWS_DIR, 'dashboard.html'));
});

// ─── Fallbacks ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found.' });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  GLAMBOT booking running`);
  console.log(`  ▸ Form       http://localhost:${PORT}/`);
  console.log(`  ▸ Admin      http://localhost:${PORT}/admin`);
  if (auth.ADMIN_PASSWORD === 'glambot') {
    console.log(`  ⚠ Using the default admin password "glambot" — set ADMIN_PASSWORD before deploying.`);
  }
  console.log('');
});
