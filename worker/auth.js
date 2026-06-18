// Admin auth for the Cloudflare Worker — mirrors src/auth.js but uses the
// Web Crypto API (crypto.subtle) instead of node:crypto, since Workers run on
// V8 isolates, not Node. Stateless HMAC-signed cookie: payload.signature.

const COOKIE_NAME = 'glambot_admin';

function ttlMs(env) {
  return (Number(env.SESSION_TTL_HOURS) || 12) * 60 * 60 * 1000;
}

// Secret for signing sessions. Prefer an explicit SESSION_SECRET; fall back to
// the admin password so it still works if the operator forgets to set one.
function sessionSecret(env) {
  return env.SESSION_SECRET || env.ADMIN_PASSWORD || 'glambot-dev-secret-change-me';
}

/* ── base64url helpers ──────────────────────────────────────────────────── */
function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const strToB64url = (str) => bytesToB64url(new TextEncoder().encode(str));
const b64urlToStr = (s) => new TextDecoder().decode(b64urlToBytes(s));

/* ── HMAC-SHA256 ────────────────────────────────────────────────────────── */
function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}
async function sign(secret, payload) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload));
  return bytesToB64url(new Uint8Array(sig));
}
async function verifySig(secret, payload, sigB64) {
  try {
    return await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      b64urlToBytes(sigB64),
      new TextEncoder().encode(payload)
    );
  } catch {
    return false;
  }
}

/* ── Tokens ─────────────────────────────────────────────────────────────── */
export async function issueToken(env) {
  const payload = strToB64url(JSON.stringify({ exp: Date.now() + ttlMs(env) }));
  const sig = await sign(sessionSecret(env), payload);
  return `${payload}.${sig}`;
}

export async function verifyToken(env, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!(await verifySig(sessionSecret(env), payload, sig))) return false;
  try {
    const { exp } = JSON.parse(b64urlToStr(payload));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

/* ── Password (constant-time over SHA-256 digests) ──────────────────────── */
async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
}
function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
export async function checkPassword(env, input) {
  const [a, b] = await Promise.all([sha256(input || ''), sha256(env.ADMIN_PASSWORD || 'glambot')]);
  return ctEqual(a, b);
}

/* ── Cookies ────────────────────────────────────────────────────────────── */
function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function isAuthed(request, env) {
  return verifyToken(env, readCookie(request, COOKIE_NAME));
}

export function sessionCookie(env, token, secure) {
  const maxAge = Math.floor(ttlMs(env) / 1000);
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure) {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
