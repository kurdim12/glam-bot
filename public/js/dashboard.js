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

const PAGE_SIZE = 50;
const state = {
  status: '', q: '', bookings: [],
  stats: { total: 0, byStatus: {} },
  openId: null,
  page: 1, pages: 1, total: 0,
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
function renderStats() {
  const cards = [{ key: '', label: 'Total', num: state.stats.total }].concat(
    STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], num: state.stats.byStatus[s] || 0 }))
  );
  document.getElementById('stats').innerHTML = cards
    .map(
      (c) => `
      <div class="stat ${state.status === c.key ? 'active' : ''}" data-status="${c.key}">
        <div class="stat-num">${c.num}</div>
        <div class="stat-label">${c.label}</div>
      </div>`
    )
    .join('');
}

function renderTable() {
  const tbody = document.getElementById('rows');
  const stateEl = document.getElementById('state');
  const count = document.getElementById('result-count');

  count.textContent = `[ ${state.total.toLocaleString()} ${state.status || state.q ? 'MATCHED' : 'TOTAL'} ]`;

  if (!state.bookings.length) {
    tbody.innerHTML = '';
    stateEl.style.display = 'block';
    stateEl.textContent = state.q || state.status
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

function openDrawer(id) {
  const b = state.bookings.find((x) => x.id === id);
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
    // Keep local state in sync, refresh table + stats.
    const idx = state.bookings.findIndex((x) => x.id === booking.id);
    if (idx !== -1) state.bookings[idx] = booking;
    renderTable();
    await loadStats();
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
    await loadBookings();
    await loadStats();
    toast(`Deleted ${b ? b.name : 'booking'}.`, 'success');
  } else {
    toast('Could not delete this booking.', 'error');
  }
}

/* ── Events ─────────────────────────────────────────────────────────────── */
document.getElementById('stats').addEventListener('click', (e) => {
  const card = e.target.closest('.stat');
  if (!card) return;
  state.status = card.dataset.status;
  renderStats();
  applyFilter();
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

/* ── Boot ───────────────────────────────────────────────────────────────── */
(async function init() {
  try {
    await loadStats();
    await loadBookings();
  } catch (err) {
    if (err.message !== 'unauthorized') console.error(err);
  }
})();
