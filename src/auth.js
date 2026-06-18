'use strict';

/**
 * Minimal, dependency-free admin auth.
 *
 * On a correct password we hand the browser a stateless, HMAC-signed cookie
 * (payload.signature). Every admin request re-verifies the signature and the
 * embedded expiry — there is no server-side session store to keep in sync.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COOKIE_NAME = 'glambot_admin';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'glambot';
const SESSION_TTL_MS =
  (Number(process.env.SESSION_TTL_HOURS) || 12) * 60 * 60 * 1000;

// A stable secret keeps logins valid across restarts. If the operator did not
// supply one, generate it once and persist it under data/ (gitignored).
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(__dirname, '..', 'data', '.session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}
const SECRET = loadSecret();

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkPassword(input) {
  return safeEqual(input || '', ADMIN_PASSWORD);
}

function issueToken() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

/** Tiny cookie-header parser (avoids pulling in cookie-parser). */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function isAuthed(req) {
  return verifyToken(readCookie(req, COOKIE_NAME));
}

function setSessionCookie(res) {
  res.cookie(COOKIE_NAME, issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Express middleware guarding the admin JSON API. */
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  return res.status(401).json({ ok: false, error: 'Not authenticated' });
}

module.exports = {
  COOKIE_NAME,
  ADMIN_PASSWORD,
  checkPassword,
  isAuthed,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
};
