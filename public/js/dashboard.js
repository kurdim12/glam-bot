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
  renderPivot(data.occasionPivot || []);
  renderPipeline();
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

/**
 * Pivot table: occasions down the side, the status pipeline across the top,
 * counts in the cells, totals on the edges. Clicking an occasion row filters
 * the bookings list (and board) to that occasion.
 */
function renderPivot(rows) {
  const table = document.getElementById('pivot');
  const clearBtn = document.getElementById('pivot-clear');

  // occasion -> { status: n }
  const byOcc = {};
  for (const r of rows) {
    (byOcc[r.occasion] || (byOcc[r.occasion] = {}))[r.status] = r.n;
  }
  const occasions = Object.keys(byOcc);

  if (!occasions.length) {
    table.innerHTML = `<tbody><tr><td class="pivot-empty">No inquiries yet.</td></tr></tbody>`;
    clearBtn.hidden = true;
    return;
  }

  const rowTotal = (occ) => STATUSES.reduce((s, k) => s + (byOcc[occ][k] || 0), 0);
  occasions.sort((a, b) => rowTotal(b) - rowTotal(a) || a.localeCompare(b));

  const colTotals = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  let grand = 0;

  const head =
    `<thead><tr><th class="pivot-occ-h">Occasion</th>` +
    STATUSES.map((k) => `<th>${STATUS_LABEL[k]}</th>`).join('') +
    `<th class="pivot-total-col">Total</th></tr></thead>`;

  const body = occasions
    .map((occ) => {
      const rt = rowTotal(occ);
      grand += rt;
      const cells = STATUSES.map((k) => {
        const n = byOcc[occ][k] || 0;
        colTotals[k] += n;
        return `<td class="${n ? '' : 'zero'}">${n || '·'}</td>`;
      }).join('');
      const active = state.occasion === occ ? ' active' : '';
      return `<tr class="pivot-row${active}" data-occasion="${esc(occ)}">
        <td class="pivot-occ">${esc(occ)}</td>${cells}
        <td class="pivot-total-col">${rt}</td>
      </tr>`;
    })
    .join('');

  const foot =
    `<tfoot><tr><td class="pivot-occ">All</td>` +
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
        <td class="name" data-label="Client">${esc(b.name)}<span class="sub">${esc(b.email)}</span></td>
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

  const waNumber = String(b.phone || '').replace(/[^\d]/g, '');
  const body = [
    detailRow('Email', `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`),
    detailRow(
      'Phone / WhatsApp',
      `<a href="https://wa.me/${esc(waNumber)}" target="_blank" rel="noopener">${esc(b.phone)}</a>`
    ),
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
  ].join('');

  document.getElementById('drawer-body').innerHTML = body;
  document.getElementById('save-hint').textContent = '';
  document.getElementById('save-hint').classList.remove('saved');

  drawer.classList.add('open');
  overlay.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');

  document.getElementById('d-status').addEventListener('change', saveOpen);
  document.getElementById('d-notes').addEventListener('blur', saveOpen);
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
    <div class="bcard-name">${esc(b.name)}</div>
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
  document.querySelectorAll('.vt').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.getElementById('search').style.display = v === 'table' ? '' : 'none';
  document.getElementById('result-count').style.display = v === 'table' ? '' : 'none';
  if (v === 'board') loadBoard();
}

/* ── Events ─────────────────────────────────────────────────────────────── */
document.getElementById('stats').addEventListener('click', (e) => {
  const card = e.target.closest('.stat');
  if (!card) return;
  state.status = card.dataset.status;
  renderStats();
  applyFilter();
});

/* Pivot: click an occasion row to filter the list (click again to clear). */
function applyOccasion(next) {
  state.occasion = next;
  const pivot = document.getElementById('pivot');
  pivot.querySelectorAll('.pivot-row').forEach((r) =>
    r.classList.toggle('active', !!next && r.dataset.occasion === next)
  );
  document.getElementById('pivot-clear').hidden = !next;
  applyFilter();
  if (state.view === 'board') loadBoard();
}

document.getElementById('pivot').addEventListener('click', (e) => {
  const row = e.target.closest('.pivot-row');
  if (!row) return;
  const occ = row.dataset.occasion;
  applyOccasion(state.occasion === occ ? '' : occ);
});

document.getElementById('pivot-clear').addEventListener('click', () => applyOccasion(''));

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
