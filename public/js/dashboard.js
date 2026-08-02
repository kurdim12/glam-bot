'use strict';

/* ── Config ─────────────────────────────────────────────────────────────── */
const STATUSES = ['new', 'contacted', 'booked', 'completed', 'cancelled'];
const STATUS_LABEL = {
  new: 'New',
  contacted: 'Contacted',
  booked: 'Booked',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const STATUS_COLOR = {
  new: '#ff5c00',
  contacted: '#ff8340',
  booked: '#6cb8ff',
  completed: '#58c896',
  cancelled: '#888886',
};

const PAGE_SIZE = 50;
const state = {
  status: '', q: '', occasion: '', bookings: [],
  stats: { total: 0, byStatus: {} },
  openId: null,
  page: 1, pages: 1, total: 0,
  view: 'table',
  prevNums: {},      // last rendered stat numbers (for count-up)
  boardCache: {},    // id -> booking, for board cards
  lastMaxId: 0,      // highest booking id seen (for live alerts)
};

/* ── Helpers ────────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Urgency + language + client-signal chips (whitelisted values only — nothing else renders). */
function badgeHtml(b) {
  let h = '';
  if (b.urgency === 'hot' || b.urgency === 'warm') h += `<span class="badge ${b.urgency}">${b.urgency}</span>`;
  if (b.date_clash === true) h += '<span class="badge clash">⚠ date clash</span>';
  if (Number(b.prior_bookings) > 0) h += '<span class="badge returning">↩ returning</span>';
  if (b.lang === 'ar' || b.lang === 'en') h += `<span class="badge lang">${b.lang.toUpperCase()}</span>`;
  return h;
}

/** fetch wrapper that bounces to login on session expiry. */
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    window.location.href = '/admin/login';
    throw new Error('unauthorized');
  }
  return res;
}

/* ── Data loading ───────────────────────────────────────────────────────── */
async function loadStats() {
  const res = await api('/api/admin/stats');
  const data = await res.json();
  state.stats = { total: data.total, byStatus: data.byStatus };
  renderStats();
}

async function loadBookings() {
  // Show a loading hint on the first paint (skip on pagination to avoid flicker).
  if (!state.bookings.length) {
    const stateEl = document.getElementById('state');
    stateEl.style.display = 'block';
    stateEl.textContent = 'Loading…';
  }

  const params = new URLSearchParams();
  if (state.status) params.set('status', state.status);
  if (state.q) params.set('q', state.q);
  if (state.occasion) params.set('occasion', state.occasion);
  params.set('page', state.page);
  params.set('limit', PAGE_SIZE);
  const res = await api('/api/admin/bookings?' + params.toString());
  const data = await res.json();
  state.bookings = data.bookings || [];
  state.total = data.total || 0;
  state.pages = data.pages || 1;
  state.page = data.page || 1; // server clamps the page; mirror it back
  renderTable();
  renderPager();
}

/* ── Rendering ──────────────────────────────────────────────────────────── */
function animateNumber(el, from, to) {
  if (from === to) { el.textContent = to.toLocaleString(); return; }
  const dur = 650;
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  (function step(now) {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(from + (to - from) * ease(t)).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  })(start);
}

function renderStats() {
  const cards = [{ key: '', label: 'Total' }].concat(
    STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s] }))
  );
  const wrap = document.getElementById('stats');
  wrap.innerHTML = cards
    .map(
      (c) => `
      <div class="stat ${state.status === c.key ? 'active' : ''}" data-status="${c.key}">
        <div class="stat-num" data-key="${c.key}">0</div>
        <div class="stat-label">${c.label}</div>
      </div>`
    )
    .join('');
  // Count up from the previous value to the current one.
  wrap.querySelectorAll('.stat-num').forEach((el) => {
    const key = el.dataset.key;
    const to = key === '' ? state.stats.total : state.stats.byStatus[key] || 0;
    const from = state.prevNums[key] != null ? state.prevNums[key] : 0;
    animateNumber(el, from, to);
    state.prevNums[key] = to;
  });
}

/* ── Analytics command center ───────────────────────────────────────────────── */
async function loadAnalytics() {
  const res = await api('/api/admin/analytics');
  const data = await res.json();
  renderTrend(data.daily || []);
  renderOccasion(data.byOccasion || []);
  renderPipeline();
  // The pivot lists real client names, so it needs the rows themselves —
  // not just the aggregate counts the analytics endpoint returns.
  const pres = await api('/api/admin/bookings?limit=200');
  const pdata = await pres.json();
  renderPivot(pdata.bookings || []);
}

function renderTrend(daily) {
  const map = Object.fromEntries(daily.map((d) => [d.day, d.n]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    days.push({ key: d.toISOString().slice(0, 10), n: map[d.toISOString().slice(0, 10)] || 0, date: d });
  }
  document.getElementById('an-trend-sum').textContent = days.reduce((s, d) => s + d.n, 0).toLocaleString();

  const W = 600, H = 150, gap = 8, bw = (W - (days.length - 1) * gap) / days.length;
  const max = Math.max(1, ...days.map((d) => d.n));
  const svg = document.getElementById('an-trend-svg');
  svg.innerHTML = days
    .map((d, i) => {
      const bh = d.n ? Math.max(5, (d.n / max) * (H - 12)) : 3;
      const x = i * (bw + gap);
      return `<rect class="${d.n ? '' : 'zero'}" x="${x.toFixed(1)}" y="${H}" width="${bw.toFixed(1)}" height="0" rx="2" data-y="${(H - bh).toFixed(1)}" data-h="${bh.toFixed(1)}"><title>${d.key}: ${d.n}</title></rect>`;
    })
    .join('');
  requestAnimationFrame(() =>
    svg.querySelectorAll('rect').forEach((r) => { r.setAttribute('y', r.dataset.y); r.setAttribute('height', r.dataset.h); })
  );

  const fmt = (dt) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  document.getElementById('an-trend-axis').innerHTML =
    `<span>${fmt(days[0].date)}</span><span>${fmt(days[7].date)}</span><span>${fmt(days[13].date)}</span>`;
}

function renderOccasion(list) {
  const el = document.getElementById('an-occ');
  if (!list.length) { el.innerHTML = '<div class="bcol-empty">No data yet.</div>'; return; }
  const max = Math.max(1, ...list.map((o) => o.n));
  el.innerHTML = list
    .map(
      (o) => `
      <div class="an-bar-row">
        <div class="an-bar-top"><b>${esc(o.occasion)}</b><span>${o.n}</span></div>
        <div class="an-bar-track"><div class="an-bar-fill" data-w="${((o.n / max) * 100).toFixed(1)}%"></div></div>
      </div>`
    )
    .join('');
  requestAnimationFrame(() => el.querySelectorAll('.an-bar-fill').forEach((f) => { f.style.width = f.dataset.w; }));
}

/** "#rrggbb" + alpha -> "rgba(...)" so cells can tint with the status color. */
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Pivot: occasions down the side, the status pipeline across the top. Each cell
 * lists the actual clients in that occasion/status bucket as chips (tap a name
 * to open its detail drawer). Tap an occasion to filter the bookings list/board.
 */
function renderPivot(bookings) {
  const table = document.getElementById('pivot');
  const clearBtn = document.getElementById('pivot-clear');

  // occasion -> status -> [booking]
  const byOcc = {};
  for (const b of bookings) {
    const occ = b.occasion && b.occasion.trim() ? b.occasion.trim() : 'Other';
    const cols = byOcc[occ] || (byOcc[occ] = {});
    (cols[b.status] || (cols[b.status] = [])).push(b);
    state.boardCache[b.id] = b; // so tapping a name opens the drawer instantly
  }
  const occasions = Object.keys(byOcc);

  if (!occasions.length) {
    table.innerHTML = `<tbody><tr><td class="pivot-empty">No inquiries yet.</td></tr></tbody>`;
    clearBtn.hidden = true;
    return;
  }

  const cell = (occ, k) => byOcc[occ][k] || [];
  const rowTotal = (occ) => STATUSES.reduce((s, k) => s + cell(occ, k).length, 0);
  occasions.sort((a, b) => rowTotal(b) - rowTotal(a) || a.localeCompare(b));

  const colTotals = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  let grand = 0;
  let maxRow = 1;
  for (const occ of occasions) maxRow = Math.max(maxRow, rowTotal(occ));

  const head =
    `<thead><tr><th class="pivot-occ-h">Occasion</th>` +
    STATUSES.map(
      (k) => `<th><i class="pivot-dot" style="background:${STATUS_COLOR[k]}"></i>${STATUS_LABEL[k]}</th>`
    ).join('') +
    `<th class="pivot-total-col">Total</th></tr></thead>`;

  const body = occasions
    .map((occ) => {
      const rt = rowTotal(occ);
      grand += rt;
      const cells = STATUSES.map((k) => {
        const list = cell(occ, k);
        colTotals[k] += list.length;
        const label = STATUS_LABEL[k];
        if (!list.length) return `<td class="pivot-cell empty" data-label="${label}"><span class="zero">·</span></td>`;
        const chips = list
          .map(
            (b) =>
              `<button type="button" class="pivot-name" data-id="${b.id}" title="${esc(b.name)}"
                style="background:${hexA(STATUS_COLOR[k], 0.14)};color:${STATUS_COLOR[k]}">${esc(b.name)}</button>`
          )
          .join('');
        return `<td class="pivot-cell" data-label="${label}"><div class="pivot-names">${chips}</div></td>`;
      }).join('');
      const barW = ((rt / maxRow) * 100).toFixed(1);
      const active = state.occasion === occ ? ' active' : '';
      return `<tr class="pivot-row${active}" data-occasion="${esc(occ)}">
        <td class="pivot-occ">${esc(occ)}</td>${cells}
        <td class="pivot-total-col">
          <span class="pivot-total-n">${rt}</span>
          <span class="pivot-total-bar"><i style="width:${barW}%"></i></span>
        </td>
      </tr>`;
    })
    .join('');

  const foot =
    `<tfoot><tr><td class="pivot-occ">All occasions</td>` +
    STATUSES.map((k) => `<td>${colTotals[k]}</td>`).join('') +
    `<td class="pivot-total-col">${grand}</td></tr></tfoot>`;

  table.innerHTML = head + `<tbody>${body}</tbody>` + foot;
  clearBtn.hidden = !state.occasion;
}

function renderPipeline() {
  const by = state.stats.byStatus || {};
  const total = STATUSES.reduce((s, k) => s + (by[k] || 0), 0);
  const bar = document.getElementById('an-pipe');
  const legend = document.getElementById('an-legend');
  if (!total) { bar.innerHTML = ''; legend.innerHTML = '<span class="an-leg">No bookings yet.</span>'; return; }
  bar.innerHTML = STATUSES.map((k) => {
    const n = by[k] || 0;
    return n ? `<span title="${STATUS_LABEL[k]}: ${n}" data-w="${((n / total) * 100).toFixed(2)}%" style="width:0;background:${STATUS_COLOR[k]}"></span>` : '';
  }).join('');
  requestAnimationFrame(() => bar.querySelectorAll('span').forEach((s) => { s.style.width = s.dataset.w; }));
  legend.innerHTML = STATUSES
    .map((k) => `<span class="an-leg"><i style="background:${STATUS_COLOR[k]}"></i>${STATUS_LABEL[k]} · ${by[k] || 0}</span>`)
    .join('');
}

function renderTable() {
  const tbody = document.getElementById('rows');
  const stateEl = document.getElementById('state');
  const count = document.getElementById('result-count');

  const filtered = state.status || state.q || state.occasion;
  count.textContent = `[ ${state.total.toLocaleString()} ${filtered ? 'MATCHED' : 'TOTAL'} ]`;

  if (!state.bookings.length) {
    tbody.innerHTML = '';
    stateEl.style.display = 'block';
    stateEl.textContent = filtered
      ? 'No bookings match this filter.'
      : 'No inquiries yet. They will appear here the moment one comes in.';
    return;
  }

  stateEl.style.display = 'none';
  tbody.innerHTML = state.bookings
    .map(
      (b) => `
      <tr data-id="${b.id}">
        <td class="name" data-label="Client">${esc(b.name)}${badgeHtml(b)}<span class="sub">${esc(b.email)}</span></td>
        <td class="hide-sm" data-label="Occasion">${esc(b.occasion) || '<span class="muted">—</span>'}</td>
        <td class="hide-sm" data-label="Shoot date">${fmtDate(b.shoot_date)}</td>
        <td class="hide-sm" data-label="Location">${esc(b.location) || '<span class="muted">—</span>'}</td>
        <td data-label="Status"><span class="pill ${b.status}">${STATUS_LABEL[b.status] || esc(b.status)}</span></td>
        <td class="hide-sm muted" data-label="Received">${fmtDateTime(b.created_at)}</td>
      </tr>`
    )
    .join('');
}

function renderPager() {
  const pager = document.getElementById('pager');
  if (!state.total) { pager.innerHTML = ''; return; }
  const from = (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(state.page * PAGE_SIZE, state.total);
  pager.innerHTML = `
    <button class="btn pg-btn" data-pg="prev" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span class="pager-info">${from.toLocaleString()}–${to.toLocaleString()} of ${state.total.toLocaleString()} · page ${state.page} / ${state.pages}</span>
    <button class="btn pg-btn" data-pg="next" ${state.page >= state.pages ? 'disabled' : ''}>Next →</button>`;
}

/** Reset to the first page and reload (used whenever a filter/search changes). */
function applyFilter() {
  state.page = 1;
  loadBookings();
}

/* ── Detail drawer ──────────────────────────────────────────────────────── */
const overlay = document.getElementById('overlay');
const drawer = document.getElementById('drawer');

function detailRow(label, valueHtml) {
  return `<div class="detail-row"><div class="detail-label">${label}</div><div class="detail-value">${valueHtml}</div></div>`;
}

async function openDrawer(id) {
  let b = state.bookings.find((x) => x.id === id) || state.boardCache[id];
  if (!b) {
    try {
      const r = await api('/api/admin/bookings/' + id);
      b = (await r.json()).booking;
    } catch { /* ignore */ }
  }
  if (!b) return;
  state.openId = id;

  document.getElementById('d-name').textContent = b.name;

  // Prefer the normalized number (enrichment) for tel:/wa.me; fall back to
  // the raw phone field for old or not-yet-enriched rows.
  const waNumber = String(b.phone_e164 || b.phone || '').replace(/[^\d]/g, '');
  const phoneHtml = b.phone_e164
    ? `<a href="tel:${esc(b.phone_e164)}">${esc(b.phone_e164)}</a>
       <span class="muted">·</span>
       <a href="https://wa.me/${esc(waNumber)}" target="_blank" rel="noopener">WhatsApp</a>`
    : waNumber
      ? `<a href="https://wa.me/${esc(waNumber)}" target="_blank" rel="noopener">${esc(b.phone)}</a>`
      : esc(b.phone) || '—';
  const body = [
    detailRow('Email', `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`),
    detailRow('Phone / WhatsApp', phoneHtml),
    b.ai_brief ? detailRow('AI Call Brief', `<div class="ai-brief">${esc(b.ai_brief)}</div>`) : '',
    '<div id="d-context"><!-- same-client history + date clashes, loaded async --></div>',
    detailRow('Occasion', esc(b.occasion) || '—'),
    detailRow('Shoot Date', fmtDate(b.shoot_date)),
    detailRow('Location', esc(b.location) || '—'),
    detailRow('Their Vision', b.notes ? esc(b.notes) : '<span class="muted">—</span>'),
    detailRow('Received', fmtDateTime(b.created_at)),
    detailRow(
      'Status',
      `<select class="field-select-dark drawer-control" id="d-status">
        ${STATUSES.map(
          (s) => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`
        ).join('')}
      </select>`
    ),
    detailRow(
      'Internal Notes',
      `<textarea class="notes-input drawer-control" id="d-notes" placeholder="Notes for your team...">${esc(b.admin_notes)}</textarea>`
    ),
    detailRow(
      'Invoices',
      `<div id="d-invoices" class="ctx-list"><span class="muted">Loading…</span></div>
      <button type="button" class="btn drawer-control" id="d-inv-new">＋ New Invoice</button>`
    ),
    detailRow(
      'WhatsApp Follow-up',
      `<button type="button" class="btn" id="draft-btn">✦ Draft WhatsApp</button>
      <div class="draft-panel" id="draft-panel" hidden>
        <textarea class="notes-input" id="draft-text" rows="5" aria-label="Draft message"></textarea>
        <div class="draft-actions">
          <button type="button" class="btn btn-solid" id="draft-open">Open WhatsApp</button>
          <button type="button" class="btn" id="draft-copy">Copy</button>
        </div>
        <p class="draft-hint">Review and edit before sending — nothing is sent automatically.</p>
      </div>
      <div class="draft-err" id="draft-err" hidden></div>`
    ),
  ].join('');

  document.getElementById('drawer-body').innerHTML = body;
  document.getElementById('save-hint').textContent = '';
  document.getElementById('save-hint').classList.remove('saved');

  drawer.classList.add('open');
  overlay.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');

  document.getElementById('d-status').addEventListener('change', saveOpen);
  document.getElementById('d-notes').addEventListener('blur', saveOpen);
  document.getElementById('draft-btn').addEventListener('click', () => requestDraft(id));
  document.getElementById('d-inv-new').addEventListener('click', () =>
    openInvoiceModal(null, {
      booking_id: id,
      client_name: b.name,
      client_contact: [b.phone_e164 || b.phone, b.email].filter(Boolean).join(' · '),
      lang: b.lang,
    })
  );
  loadContext(id); // best-effort, fills #d-context when it lands
  loadDrawerInvoices(id); // best-effort, fills #d-invoices
}

/* ── Drawer context: returning-client history + same-date bookings ──────── */
async function loadContext(id) {
  try {
    const res = await api(`/api/admin/bookings/${id}/context`);
    const data = await res.json();
    if (state.openId !== id || !data.ok) return; // drawer moved on
    const el = document.getElementById('d-context');
    if (!el) return;

    const item = (entryId, label) =>
      `<button type="button" class="ctx-item" data-id="${Number(entryId)}">${label}</button>`;
    const pill = (s) =>
      `<span class="pill ${STATUSES.includes(s) ? s : ''}">${STATUS_LABEL[s] || esc(s)}</span>`;

    let html = '';
    if (data.history && data.history.length) {
      const total = Number(data.history_total) || data.history.length;
      html += `<div class="detail-row"><div class="detail-label">↩ Returning client · ${total} other inquir${total === 1 ? 'y' : 'ies'}</div><div class="detail-value ctx-list">` +
        data.history.map((h) => item(h.id, `${esc(h.occasion) || '—'} · ${fmtDate(h.shoot_date)} ${pill(h.status)}`)).join('') +
        '</div></div>';
    }
    if (data.same_date && data.same_date.length) {
      html += `<div class="detail-row"><div class="detail-label">⚠ Same shoot date — possible double-booking</div><div class="detail-value ctx-list">` +
        data.same_date.map((s) => item(s.id, `${esc(s.name)} · ${esc(s.occasion) || '—'} ${pill(s.status)}`)).join('') +
        '</div></div>';
    }
    el.innerHTML = html;
    el.querySelectorAll('.ctx-item').forEach((btn) =>
      btn.addEventListener('click', () => openDrawer(Number(btn.dataset.id)))
    );
  } catch { /* context is a bonus — never block the drawer on it */ }
}

/* ── WhatsApp draft agent (drafts only — the owner sends) ───────────────── */
async function requestDraft(id) {
  document.getElementById('draft-btn').disabled = true;
  document.getElementById('draft-btn').textContent = 'Drafting…';
  document.getElementById('draft-err').hidden = true;

  try {
    const res = await api(`/api/admin/bookings/${id}/draft`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    // The drawer may have moved to another booking while we waited — never
    // wire this response's message/number into someone else's panel. (All
    // elements are re-resolved below because reopening the drawer re-renders
    // them; references captured before the await would be detached.)
    if (state.openId !== id) return;
    if (!res.ok || !data.ok || typeof data.message !== 'string') {
      const e = new Error(res.status === 404 ? 'draft-unsupported' : 'draft-failed');
      e.serverError = typeof data.error === 'string' ? data.error : '';
      throw e;
    }

    const ta = document.getElementById('draft-text');
    ta.value = data.message; // .value assignment — never innerHTML

    // Rebuild the wa.me link client-side at click time so the admin's edits
    // are respected (the server's wa_url only tells us the number exists).
    let digits = '';
    if (data.wa_url) {
      try { digits = new URL(data.wa_url).pathname.replace(/[^\d]/g, ''); } catch { /* copy-only */ }
    }
    const openBtn = document.getElementById('draft-open');
    openBtn.hidden = !digits; // no normalized phone → copy-only
    openBtn.onclick = () => {
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(ta.value)}`, '_blank', 'noopener');
    };
    document.getElementById('draft-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        toast('Draft copied.', 'success');
      } catch {
        ta.select();
        toast('Could not copy — text selected, press Ctrl/Cmd+C.', 'error');
      }
    };

    document.getElementById('draft-panel').hidden = false;
    document.getElementById('draft-btn').textContent = '↻ Redraft';
  } catch (err) {
    if (err.message === 'unauthorized' || state.openId !== id) return;
    const errEl = document.getElementById('draft-err');
    errEl.textContent = err.message === 'draft-unsupported'
      ? 'Drafting is only available on the Cloudflare deployment.'
      : err.serverError || 'Draft failed — try again.'; // textContent → safe
    errEl.hidden = false;
    document.getElementById('draft-btn').textContent = '↻ Retry draft';
  } finally {
    if (state.openId === id) document.getElementById('draft-btn').disabled = false;
  }
}

function closeDrawer() {
  drawer.classList.remove('open');
  overlay.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  state.openId = null;
}

async function saveOpen() {
  if (state.openId == null) return;
  const status = document.getElementById('d-status').value;
  const admin_notes = document.getElementById('d-notes').value;
  const hint = document.getElementById('save-hint');
  hint.textContent = 'Saving...';
  hint.classList.remove('saved');

  try {
    const res = await api(`/api/admin/bookings/${state.openId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, admin_notes }),
    });
    if (!res.ok) throw new Error('save');
    const { booking } = await res.json();
    // Keep local state in sync, refresh views + stats + analytics.
    const idx = state.bookings.findIndex((x) => x.id === booking.id);
    if (idx !== -1) state.bookings[idx] = booking;
    state.boardCache[booking.id] = booking;
    renderTable();
    await loadStats();
    await loadAnalytics();
    if (state.view === 'board') await loadBoard();
    hint.textContent = 'Saved ✓';
    hint.classList.add('saved');
  } catch {
    hint.textContent = 'Save failed';
    toast('Could not save changes. Try again.', 'error');
  }
}

async function deleteOpen() {
  if (state.openId == null) return;
  const b = state.bookings.find((x) => x.id === state.openId);
  if (!confirm(`Delete the inquiry from ${b ? b.name : 'this client'}? This cannot be undone.`)) return;

  const res = await api(`/api/admin/bookings/${state.openId}`, { method: 'DELETE' });
  if (res.ok) {
    closeDrawer();
    if (state.view === 'board') await loadBoard();
    else await loadBookings();
    await loadStats();
    await loadAnalytics();
    toast(`Deleted ${b ? b.name : 'booking'}.`, 'success');
  } else {
    toast('Could not delete this booking.', 'error');
  }
}

/* ── Kanban board view ──────────────────────────────────────────────────────── */
function boardCard(b) {
  return `<div class="bcard" draggable="true" data-id="${b.id}" style="border-left-color:${STATUS_COLOR[b.status]}">
    <div class="bcard-name">${esc(b.name)}${badgeHtml(b)}</div>
    <div class="bcard-meta">${esc(b.occasion) || '—'} · ${fmtDate(b.shoot_date)}</div>
    <div class="bcard-foot"><span>${esc(b.location) || ''}</span><span>${fmtDateTime(b.created_at)}</span></div>
  </div>`;
}

async function loadBoard() {
  const board = document.getElementById('board');
  if (!board.children.length) board.innerHTML = '<div class="bcol-empty">Loading…</div>';
  const occParam = state.occasion ? `&occasion=${encodeURIComponent(state.occasion)}` : '';
  const results = await Promise.all(
    STATUSES.map((s) =>
      api(`/api/admin/bookings?status=${s}&limit=50${occParam}`)
        .then((r) => r.json())
        .then((d) => ({ s, items: d.bookings || [], total: d.total || 0 }))
    )
  );
  state.boardCache = {};
  board.innerHTML = results
    .map(({ s, items, total }) => {
      items.forEach((b) => { state.boardCache[b.id] = b; });
      const cards = items.length ? items.map(boardCard).join('') : '<div class="bcol-empty">—</div>';
      return `<div class="bcol" data-status="${s}">
        <div class="bcol-head"><span class="bcol-title" style="color:${STATUS_COLOR[s]}">${STATUS_LABEL[s]}</span><span class="bcol-count">${total}</span></div>
        <div class="bcol-body">${cards}</div>
      </div>`;
    })
    .join('');
}

function showView(v) {
  state.view = v;
  document.getElementById('view-table').hidden = v !== 'table';
  document.getElementById('board').hidden = v !== 'board';
  document.getElementById('view-pivot').hidden = v !== 'pivot';
  document.getElementById('view-invoices').hidden = v !== 'invoices';
  document.querySelectorAll('.vt').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.getElementById('search').style.display = v === 'table' ? '' : 'none';
  document.getElementById('result-count').style.display = v === 'table' ? '' : 'none';
  if (v === 'board') loadBoard();
  if (v === 'pivot') loadAnalytics();
  if (v === 'invoices') loadInvoices();
}

/* ── Events ─────────────────────────────────────────────────────────────── */
document.getElementById('stats').addEventListener('click', (e) => {
  const card = e.target.closest('.stat');
  if (!card) return;
  state.status = card.dataset.status;
  renderStats();
  applyFilter();
});

/* A removable chip in the toolbar shows the active occasion filter in any view. */
function updateOccChip() {
  const chip = document.getElementById('active-occ');
  if (state.occasion) {
    chip.hidden = false;
    chip.innerHTML = `<span>Occasion · <b>${esc(state.occasion)}</b></span><button class="occ-x" type="button" aria-label="Clear occasion filter">✕</button>`;
  } else {
    chip.hidden = true;
    chip.innerHTML = '';
  }
}

/* Pivot: select an occasion to filter the list (select again to clear). */
function applyOccasion(next) {
  state.occasion = next;
  document.getElementById('pivot').querySelectorAll('.pivot-row').forEach((r) =>
    r.classList.toggle('active', !!next && r.dataset.occasion === next)
  );
  document.getElementById('pivot-clear').hidden = !next;
  updateOccChip();
  applyFilter();
  if (state.view === 'board') loadBoard();
}

document.getElementById('pivot').addEventListener('click', (e) => {
  const nameBtn = e.target.closest('.pivot-name');
  if (nameBtn) { openDrawer(Number(nameBtn.dataset.id)); return; }
  const row = e.target.closest('.pivot-row');
  if (!row) return;
  const occ = row.dataset.occasion;
  const next = state.occasion === occ ? '' : occ;
  applyOccasion(next);
  // Drill straight into the filtered list so the result is visible.
  if (next) showView('table');
});

document.getElementById('pivot-clear').addEventListener('click', () => applyOccasion(''));
document.getElementById('active-occ').addEventListener('click', (e) => {
  if (e.target.closest('.occ-x')) applyOccasion('');
});

document.getElementById('pager').addEventListener('click', (e) => {
  const btn = e.target.closest('.pg-btn');
  if (!btn || btn.disabled) return;
  state.page += btn.dataset.pg === 'next' ? 1 : -1;
  loadBookings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

document.getElementById('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr) openDrawer(Number(tr.dataset.id));
});

let searchTimer;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(() => {
    state.q = q;
    applyFilter();
  }, 250);
});

document.getElementById('drawer-close').addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);
document.getElementById('delete-btn').addEventListener('click', deleteOpen);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

/* View toggle (Table / Board) */
document.getElementById('view-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.vt');
  if (btn) showView(btn.dataset.view);
});

/* Board: drag a card onto a column to change its status. */
const board = document.getElementById('board');
let dragId = null;
let justDragged = false;
board.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.bcard');
  if (!card) return;
  dragId = Number(card.dataset.id);
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(dragId)); } catch { /* ignore */ }
});
board.addEventListener('dragend', (e) => {
  const card = e.target.closest('.bcard');
  if (card) card.classList.remove('dragging');
  document.querySelectorAll('.bcol.drop').forEach((c) => c.classList.remove('drop'));
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 50);
});
board.addEventListener('dragover', (e) => {
  if (e.target.closest('.bcol')) e.preventDefault();
});
board.addEventListener('dragenter', (e) => {
  const col = e.target.closest('.bcol');
  if (col) col.classList.add('drop');
});
board.addEventListener('dragleave', (e) => {
  const col = e.target.closest('.bcol');
  if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
});
board.addEventListener('drop', async (e) => {
  const col = e.target.closest('.bcol');
  if (!col || dragId == null) return;
  e.preventDefault();
  const status = col.dataset.status;
  const id = dragId;
  dragId = null;
  col.classList.remove('drop');
  const current = state.boardCache[id];
  if (current && current.status === status) return;
  const res = await api(`/api/admin/bookings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (res.ok) {
    toast(`Moved to ${STATUS_LABEL[status]}.`, 'success');
    await loadBoard();
    await loadStats();
    await loadAnalytics();
  } else {
    toast('Could not move booking.', 'error');
  }
});
board.addEventListener('click', (e) => {
  const card = e.target.closest('.bcard');
  if (card && !justDragged) openDrawer(Number(card.dataset.id));
});

/* Live: poll for new inquiries and surface them as toasts. */
function startLive() {
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const res = await api('/api/admin/bookings?limit=5&page=1');
      const items = (await res.json()).bookings || [];
      if (!items.length) return;
      const fresh = items.filter((b) => b.id > state.lastMaxId);
      if (state.lastMaxId > 0 && fresh.length) {
        fresh.reverse().forEach((b) => toast(`New inquiry from ${b.name}`, 'info', 6000));
        await loadStats();
        await loadAnalytics();
        if (state.view === 'board') await loadBoard();
        else if (state.page === 1 && !state.status && !state.q) await loadBookings();
      }
      state.lastMaxId = Math.max(state.lastMaxId, ...items.map((b) => b.id));
    } catch { /* ignore poll errors */ }
  }, 18000);
}

/* ── Invoices (agent drafts descriptions — the owner sets every price) ──── */
const INV_STATUS_LABEL = { draft: 'Draft', sent: 'Sent', paid: 'Paid' };
const invModal = { id: null, booking_id: null, number: '', lang: 'en' };

/** Can this device hand a PDF straight to WhatsApp via the share sheet? */
const canShareFiles = (() => {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }));
  } catch { return false; }
})();

function invParseItems(inv) {
  try {
    const items = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items || [];
    return Array.isArray(items) ? items : [];
  } catch { return []; }
}
function invTotals(items, taxRate) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const subtotal = r2(items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
  const tax = r2((subtotal * (Number(taxRate) || 0)) / 100);
  return { subtotal, tax, total: r2(subtotal + tax) };
}
function invPill(status) {
  const s = ['draft', 'sent', 'paid'].includes(status) ? status : 'draft';
  return `<span class="pill inv-${s}">${INV_STATUS_LABEL[s]}</span>`;
}

async function loadInvoices() {
  const tbody = document.getElementById('inv-rows');
  const stateEl = document.getElementById('inv-state');
  try {
    const res = await api('/api/admin/invoices');
    const data = await res.json();
    const invoices = data.invoices || [];
    if (!invoices.length) {
      tbody.innerHTML = '';
      stateEl.style.display = 'block';
      stateEl.textContent = 'No invoices yet. Create one from a booking, or with ＋ New Invoice.';
      return;
    }
    stateEl.style.display = 'none';
    tbody.innerHTML = invoices
      .map((inv) => {
        const t = invTotals(invParseItems(inv), inv.tax_rate);
        return `<tr data-inv="${inv.id}">
          <td data-label="No."><b>${esc(inv.number)}</b></td>
          <td data-label="Client">${esc(inv.client_name)}</td>
          <td class="hide-sm" data-label="Date">${esc(inv.issued_at)}</td>
          <td data-label="Total">${t.total.toFixed(2)} ${esc(inv.currency)}</td>
          <td data-label="Status">${invPill(inv.status)}</td>
          <td data-label="">
            <button type="button" class="btn inv-open-pdf" data-inv="${inv.id}" title="Download PDF">⬇</button>
            <button type="button" class="btn inv-open-print" data-inv="${inv.id}" title="Print view">⎙</button>
          </td>
        </tr>`;
      })
      .join('');
    tbody.querySelectorAll('tr[data-inv]').forEach((tr) =>
      tr.addEventListener('click', async (e) => {
        const id = Number(tr.dataset.inv);
        if (e.target.closest('.inv-open-print')) {
          window.open(`/api/admin/invoices/${id}/print`, '_blank', 'noopener');
          return;
        }
        if (e.target.closest('.inv-open-pdf')) {
          downloadInvoicePdf(id);
          return;
        }
        const inv = invoices.find((x) => x.id === id);
        if (inv) openInvoiceModal(inv);
      })
    );
  } catch (err) {
    if (err.message !== 'unauthorized') {
      stateEl.style.display = 'block';
      stateEl.textContent = 'Could not load invoices.';
    }
  }
}

async function loadDrawerInvoices(bookingId) {
  try {
    const res = await api(`/api/admin/invoices?booking_id=${bookingId}`);
    const data = await res.json();
    if (state.openId !== bookingId) return;
    const el = document.getElementById('d-invoices');
    if (!el) return;
    const invoices = data.invoices || [];
    if (!invoices.length) { el.innerHTML = '<span class="muted">No invoices for this booking yet.</span>'; return; }
    el.innerHTML = invoices
      .map((inv) => {
        const t = invTotals(invParseItems(inv), inv.tax_rate);
        return `<button type="button" class="ctx-item inv-drawer-item" data-inv="${inv.id}">
          ${esc(inv.number)} · ${t.total.toFixed(2)} ${esc(inv.currency)} ${invPill(inv.status)}</button>`;
      })
      .join('');
    el.querySelectorAll('.inv-drawer-item').forEach((btn) =>
      btn.addEventListener('click', () => {
        const inv = invoices.find((x) => x.id === Number(btn.dataset.inv));
        if (inv) openInvoiceModal(inv);
      })
    );
  } catch { /* invoices list is a bonus — never block the drawer */ }
}

/* ── Invoice editor modal ───────────────────────────────────────────────── */
function invItemRow(desc, amt) {
  const row = document.createElement('div');
  row.className = 'inv-item';
  row.innerHTML = `
    <input class="notes-input inv-input inv-item-desc" placeholder="Service or package" maxlength="200" />
    <input class="notes-input inv-input inv-item-amt" type="number" min="0" step="0.01" placeholder="0.00" />
    <button type="button" class="inv-item-x" aria-label="Remove line">✕</button>`;
  row.querySelector('.inv-item-desc').value = desc || ''; // .value — never innerHTML
  row.querySelector('.inv-item-amt').value = amt === 0 || amt ? amt : '';
  row.querySelector('.inv-item-x').addEventListener('click', () => { row.remove(); invRefreshTotals(); });
  return row;
}
function invCollectItems() {
  return [...document.querySelectorAll('#inv-items .inv-item')]
    .map((row) => ({
      description: row.querySelector('.inv-item-desc').value.trim(),
      amount: Number(row.querySelector('.inv-item-amt').value) || 0,
    }))
    .filter((it) => it.description);
}
function invRefreshTotals() {
  const t = invTotals(invCollectItems(), document.getElementById('inv-tax').value);
  document.getElementById('inv-totals').innerHTML = `
    <span>Subtotal <b>${t.subtotal.toFixed(2)}</b></span>
    <span>Tax <b>${t.tax.toFixed(2)}</b></span>
    <span class="inv-grand">Total <b>${t.total.toFixed(2)} JOD</b></span>`;
}

/** Prefilled client message — deterministic, in the lead's language; the admin edits freely. */
function invDefaultMessage() {
  const first = (document.getElementById('inv-client').value.trim().split(/\s+/)[0]) || '';
  const t = invTotals(invCollectItems(), document.getElementById('inv-tax').value);
  return invModal.lang === 'ar'
    ? `مرحبا ${first}! هاي فاتورة GLAMBOT رقم ${invModal.number} — المجموع ${t.total.toFixed(2)} دينار. الفاتورة PDF مرفقة، ولأي سؤال أنا موجود ✨`
    : `Hi ${first}! Here's your GLAMBOT invoice ${invModal.number} — total ${t.total.toFixed(2)} JOD. The PDF is attached. Let me know if you have any questions ✨`;
}
function invClientDigits() {
  const m = document.getElementById('inv-contact').value.match(/\+?[\d][\d\s\-().]{7,}/);
  return m ? m[0].replace(/[^\d]/g, '') : '';
}
function invRefreshSend() {
  const send = document.getElementById('inv-send');
  send.hidden = invModal.id == null;
  if (invModal.id == null) return;
  const msg = document.getElementById('inv-msg');
  if (!msg.value.trim()) msg.value = invDefaultMessage();
  document.getElementById('inv-share').hidden = !canShareFiles;
  document.getElementById('inv-wa').hidden = !invClientDigits();
  document.getElementById('inv-send-hint').textContent = canShareFiles
    ? 'Share sends the PDF straight to WhatsApp — pick the chat there. Nothing is sent automatically.'
    : 'Download the PDF, then attach it in the WhatsApp chat — nothing is sent automatically.';
}

function openInvoiceModal(inv, prefill) {
  invModal.id = inv ? inv.id : null;
  invModal.booking_id = inv ? inv.booking_id : (prefill && prefill.booking_id) || null;
  invModal.number = inv ? inv.number : '';
  invModal.lang = (prefill && prefill.lang) || (inv && inv.lang) || 'en';

  document.getElementById('inv-title').textContent = inv ? `Invoice ${inv.number}` : 'New Invoice';
  document.getElementById('inv-client').value = inv ? inv.client_name : (prefill && prefill.client_name) || '';
  document.getElementById('inv-contact').value = inv ? inv.client_contact : (prefill && prefill.client_contact) || '';
  document.getElementById('inv-date').value = inv ? inv.issued_at : new Date().toISOString().slice(0, 10);
  document.getElementById('inv-tax').value = inv ? inv.tax_rate : 0;
  document.getElementById('inv-notes').value = inv ? inv.notes : '';
  document.getElementById('inv-hint').textContent = '';
  document.getElementById('inv-err').hidden = true;

  const itemsEl = document.getElementById('inv-items');
  itemsEl.innerHTML = '';
  const items = inv ? invParseItems(inv) : [];
  (items.length ? items : [{ description: '', amount: '' }]).forEach((it) =>
    itemsEl.appendChild(invItemRow(it.description, it.amount))
  );

  document.getElementById('inv-status-row').hidden = !inv;
  if (inv) document.getElementById('inv-status').value = ['draft', 'sent', 'paid'].includes(inv.status) ? inv.status : 'draft';
  document.getElementById('inv-print').hidden = !inv;
  document.getElementById('inv-delete').hidden = !inv;
  document.getElementById('inv-draft-items').hidden = !invModal.booking_id;
  document.getElementById('inv-msg').value = '';

  invRefreshTotals();
  invRefreshSend();
  document.getElementById('inv-overlay').hidden = false;
}
function closeInvoiceModal() {
  document.getElementById('inv-overlay').hidden = true;
  invModal.id = null;
  invModal.booking_id = null;
}

async function saveInvoice() {
  const hint = document.getElementById('inv-hint');
  const errEl = document.getElementById('inv-err');
  errEl.hidden = true;
  const body = {
    booking_id: invModal.booking_id,
    client_name: document.getElementById('inv-client').value.trim(),
    client_contact: document.getElementById('inv-contact').value.trim(),
    issued_at: document.getElementById('inv-date').value,
    tax_rate: Number(document.getElementById('inv-tax').value) || 0,
    items: invCollectItems(),
    notes: document.getElementById('inv-notes').value,
  };
  if (!body.client_name) { errEl.textContent = 'Client name is required.'; errEl.hidden = false; return; }
  if (invModal.id) body.status = document.getElementById('inv-status').value;
  hint.textContent = 'Saving...';
  hint.classList.remove('saved');
  try {
    const res = await api(invModal.id ? `/api/admin/invoices/${invModal.id}` : '/api/admin/invoices', {
      method: invModal.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error('save');
    invModal.id = data.invoice.id;
    invModal.number = data.invoice.number;
    document.getElementById('inv-title').textContent = `Invoice ${data.invoice.number}`;
    document.getElementById('inv-status-row').hidden = false;
    document.getElementById('inv-status').value = data.invoice.status;
    document.getElementById('inv-print').hidden = false;
    document.getElementById('inv-delete').hidden = false;
    invRefreshSend();
    hint.textContent = 'Saved ✓';
    hint.classList.add('saved');
    if (state.view === 'invoices') loadInvoices();
    if (state.openId != null) loadDrawerInvoices(state.openId);
  } catch (err) {
    if (err.message === 'unauthorized') return;
    hint.textContent = '';
    errEl.textContent = 'Could not save the invoice — try again.';
    errEl.hidden = false;
  }
}

async function draftInvoiceItemsUI() {
  if (!invModal.booking_id) return;
  const btn = document.getElementById('inv-draft-items');
  const errEl = document.getElementById('inv-err');
  btn.disabled = true;
  btn.textContent = 'Drafting…';
  errEl.hidden = true;
  try {
    const res = await api(`/api/admin/bookings/${invModal.booking_id}/invoice-draft`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !Array.isArray(data.items)) {
      errEl.textContent = typeof data.error === 'string' ? data.error : 'Draft failed — try again.';
      errEl.hidden = false;
      return;
    }
    const itemsEl = document.getElementById('inv-items');
    // Replace empty rows; keep any line the owner already filled in.
    [...itemsEl.querySelectorAll('.inv-item')].forEach((row) => {
      if (!row.querySelector('.inv-item-desc').value.trim()) row.remove();
    });
    data.items.forEach((it) => itemsEl.appendChild(invItemRow(it.description, '')));
    invRefreshTotals();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    errEl.textContent = 'Draft failed — try again.';
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ Draft items';
  }
}

async function deleteInvoiceUI() {
  if (invModal.id == null) return;
  if (!confirm('Delete this invoice? This cannot be undone.')) return;
  const res = await api(`/api/admin/invoices/${invModal.id}`, { method: 'DELETE' });
  if (res.ok) {
    closeInvoiceModal();
    if (state.view === 'invoices') loadInvoices();
    if (state.openId != null) loadDrawerInvoices(state.openId);
    toast('Invoice deleted.', 'success');
  } else {
    toast('Could not delete the invoice.', 'error');
  }
}

/* ── Send to client: direct PDF download + WhatsApp handoff ─────────────── */
function downloadInvoicePdf(id) {
  // The endpoint sets Content-Disposition: attachment, so this saves the file.
  const a = document.createElement('a');
  a.href = `/api/admin/invoices/${id}/pdf`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function shareInvoicePdf() {
  if (invModal.id == null) return;
  const btn = document.getElementById('inv-share');
  const message = document.getElementById('inv-msg').value;
  btn.disabled = true;
  try {
    const res = await api(`/api/admin/invoices/${invModal.id}/pdf`);
    if (!res.ok) throw new Error('pdf');
    const file = new File([await res.blob()], `Invoice-${invModal.number}.pdf`, { type: 'application/pdf' });
    // Some share targets drop the text when a file is attached — keep the
    // message on the clipboard so the admin can paste it in the chat.
    try { await navigator.clipboard.writeText(message); } catch { /* ignore */ }
    await navigator.share({ files: [file], text: message, title: `Invoice ${invModal.number}` });
    toast('Message copied too — paste it in the chat if it did not carry over.', 'info', 6000);
  } catch (err) {
    if (err && err.name === 'AbortError') return; // admin closed the share sheet
    toast('Could not share — use Download PDF instead.', 'error');
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('inv-download').addEventListener('click', () => {
  if (invModal.id != null) downloadInvoicePdf(invModal.id);
});
document.getElementById('inv-share').addEventListener('click', shareInvoicePdf);
document.getElementById('inv-wa').addEventListener('click', () => {
  const digits = invClientDigits();
  if (!digits) return;
  const text = document.getElementById('inv-msg').value;
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
});
document.getElementById('inv-copy-msg').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById('inv-msg').value);
    toast('Message copied.', 'success');
  } catch {
    toast('Could not copy — select the text manually.', 'error');
  }
});

document.getElementById('inv-new').addEventListener('click', () => openInvoiceModal(null));
document.getElementById('inv-close').addEventListener('click', closeInvoiceModal);
document.getElementById('inv-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('inv-overlay')) closeInvoiceModal();
});
document.getElementById('inv-save').addEventListener('click', saveInvoice);
document.getElementById('inv-delete').addEventListener('click', deleteInvoiceUI);
document.getElementById('inv-draft-items').addEventListener('click', draftInvoiceItemsUI);
document.getElementById('inv-add-item').addEventListener('click', () => {
  document.getElementById('inv-items').appendChild(invItemRow('', ''));
});
document.getElementById('inv-print').addEventListener('click', () => {
  if (invModal.id != null) window.open(`/api/admin/invoices/${invModal.id}/print`, '_blank', 'noopener');
});
document.getElementById('inv-items').addEventListener('input', invRefreshTotals);
document.getElementById('inv-tax').addEventListener('input', invRefreshTotals);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('inv-overlay').hidden) closeInvoiceModal();
});

/* ── Boot ───────────────────────────────────────────────────────────────── */
(async function init() {
  try {
    await loadStats();
    await loadBookings();
    await loadAnalytics();
    state.lastMaxId = state.bookings.reduce((m, b) => Math.max(m, b.id), 0);
    startLive();
  } catch (err) {
    if (err.message !== 'unauthorized') console.error(err);
  }
})();
