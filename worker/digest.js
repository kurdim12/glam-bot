// Daily stale-lead digest → owner's Telegram. Pure code, no LLM: it counts
// rows and formats one string. Runs from the cron trigger (05:00 UTC =
// 08:00 Amman; Jordan is UTC+3 year-round). Silence is the zero-state —
// a quiet day sends nothing.

import { ensureSchema } from './db.js';

/**
 * Names come from the public form, and Telegram auto-linkifies text — strip
 * anything URL-shaped (dots, slashes) so a crafted "name" can't plant a
 * tappable link next to our real wa.me links.
 */
function safeName(s) {
  const clean = String(s || '').replace(/[^\p{L}\p{N} '\-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 40) || '—';
}

/** "2025-07-18" (or anything Date can parse) → "Jul 18"; else the raw text. */
function shortDate(s) {
  const str = String(s || '').trim();
  if (!str) return '';
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str; // "Flexible"
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export async function runDigest(env) {
  try {
    await ensureSchema(env);

    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
    const staleCutoff = new Date(now - 20 * 3600 * 1000).toISOString();
    const touchCutoff = new Date(now - 3 * 24 * 3600 * 1000).toISOString();

    const [newRow, staleRow, totalRow, staleTop, touchRow, touchTop] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?').bind(dayAgo).first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'new' AND created_at < ?")
        .bind(staleCutoff)
        .first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'new'").first(),
      env.DB.prepare(
        `SELECT id, name, occasion, shoot_date FROM bookings
         WHERE status = 'new' AND created_at < ? ORDER BY created_at LIMIT 3`
      )
        .bind(staleCutoff)
        .all(),
      // Second touch: contacted, then nothing moved for 3+ days.
      env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'contacted' AND updated_at < ?")
        .bind(touchCutoff)
        .first(),
      env.DB.prepare(
        `SELECT name, phone_e164 FROM bookings
         WHERE status = 'contacted' AND updated_at < ? ORDER BY updated_at LIMIT 3`
      )
        .bind(touchCutoff)
        .all(),
    ]);
    const newCount = newRow?.n || 0;
    const staleCount = staleRow?.n || 0;
    const totalNew = totalRow?.n || 0;
    const touchCount = touchRow?.n || 0;
    if (!newCount && !staleCount && !totalNew && !touchCount) return; // quiet day → say nothing

    const lines = [`GLAMBOT — ${newCount} new lead${newCount === 1 ? '' : 's'} in the last 24h`];
    if (staleCount) {
      const names = (staleTop.results || []).map((b) => {
        const detail = [b.occasion, shortDate(b.shoot_date)].filter(Boolean).join(', ');
        return detail ? `${safeName(b.name)} (${detail})` : safeName(b.name);
      });
      if (staleCount > names.length) names.push(`+${staleCount - names.length} more`);
      lines.push(`⚠ ${staleCount} waiting >20h: ${names.join(', ')}`);
    }
    if (touchCount) {
      // Include a tappable wa.me link when we have a normalized number.
      const names = (touchTop.results || []).map((b) =>
        b.phone_e164 ? `${safeName(b.name)} → wa.me/${b.phone_e164.slice(1)}` : safeName(b.name)
      );
      if (touchCount > names.length) names.push(`+${touchCount - names.length} more`);
      lines.push(`📞 ${touchCount} contacted >3d ago, need a 2nd touch: ${names.join(', ')}`);
    }
    lines.push(`${totalNew} total in 'new' → glambotjo.com/admin`);

    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      console.error('Digest: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set, skipping send');
      return;
    }
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: lines.join('\n') }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error(`Digest: Telegram send failed (${res.status}):`, (await res.text()).slice(0, 200));
  } catch (err) {
    console.error('Digest failed:', err);
  }
}
