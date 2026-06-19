'use strict';

// Live timecode in the hero — a small touch of camera-UI realism.
(function tick() {
  const el = document.getElementById('timecode');
  if (!el) return;
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  el.textContent = `[ ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())} ]`;
  setTimeout(tick, 1000);
})();

const form = document.getElementById('inquiry-form');
const btn = document.getElementById('submit-btn');

// Field refs by id (avoid form.name — that resolves to the form's own name).
const nameInput = document.getElementById('name');
const emailInput = document.getElementById('email');
const phoneInput = document.getElementById('phone');
const dateField = document.getElementById('date');
const flexDate = document.getElementById('flex-date');
const locationInput = document.getElementById('venue');
const notesInput = document.getElementById('notes');
const occasionInput = document.getElementById('occasion');
const chipsWrap = document.getElementById('occasion-chips');
const honeypot = form.querySelector('[name="website"]');
const STORE_KEY = 'glambot_form';

if (dateField) dateField.min = new Date().toISOString().split('T')[0];

/* ── Errors ─────────────────────────────────────────────────────────────── */
function clearErrors() {
  form.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
}
function showError(fieldName, message) {
  const field = form.querySelector(`[data-field="${fieldName}"]`);
  if (!field) return;
  field.classList.add('invalid');
  const slot = field.querySelector('.field-error');
  if (slot) slot.textContent = message;
}

/* ── Occasion chips ─────────────────────────────────────────────────────── */
if (chipsWrap) {
  chipsWrap.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chipsWrap.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    occasionInput.value = chip.dataset.value;
    const field = form.querySelector('[data-field="occasion"]');
    if (field) field.classList.remove('invalid');
    saveDraft();
  });
}

/* ── Flexible date ──────────────────────────────────────────────────────── */
if (flexDate) {
  flexDate.addEventListener('change', () => {
    dateField.disabled = flexDate.checked;
    if (flexDate.checked) dateField.value = '';
    saveDraft();
  });
}

/* Clear a field's error as soon as the user edits it, and autosave. */
form.addEventListener('input', (e) => {
  const field = e.target.closest('.field');
  if (field) field.classList.remove('invalid');
  saveDraft();
});

/* WhatsApp number with the +962 prefix (unless they typed their own +code). */
function fullPhone() {
  const v = (phoneInput.value || '').trim();
  if (!v) return '';
  return v.startsWith('+') ? v : '+962 ' + v;
}

/* ── Autosave to localStorage (survives an accidental bounce) ────────────── */
let saveTimer;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        name: nameInput.value, email: emailInput.value, phone: phoneInput.value,
        occasion: occasionInput.value, date: dateField.value, flex: flexDate.checked,
        location: locationInput.value, notes: notesInput.value,
      }));
    } catch { /* storage may be unavailable */ }
  }, 300);
}
function restoreDraft() {
  let d;
  try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { d = null; }
  if (!d) return;
  if (d.name) nameInput.value = d.name;
  if (d.email) emailInput.value = d.email;
  if (d.phone) phoneInput.value = d.phone;
  if (d.location) locationInput.value = d.location;
  if (d.notes) notesInput.value = d.notes;
  if (d.flex) { flexDate.checked = true; dateField.disabled = true; }
  else if (d.date) dateField.value = d.date;
  if (d.occasion) {
    const safe = window.CSS && CSS.escape ? CSS.escape(d.occasion) : d.occasion.replace(/"/g, '\\"');
    const chip = chipsWrap.querySelector(`.chip[data-value="${safe}"]`);
    if (chip) { chip.classList.add('active'); occasionInput.value = d.occasion; }
  }
}
restoreDraft();

/* ── Submit ─────────────────────────────────────────────────────────────── */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  // Only Name, WhatsApp and Occasion are required.
  let bad = false;
  if (!nameInput.value.trim()) { showError('name', 'Please tell us your name.'); bad = true; }
  if (!phoneInput.value.trim()) { showError('phone', 'A phone or WhatsApp number is required.'); bad = true; }
  if (!occasionInput.value) { showError('occasion', 'Pick the type of shoot.'); bad = true; }
  if (bad) {
    toast('Please complete the highlighted fields.', 'error');
    const first = form.querySelector('.field.invalid');
    if (first) {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const input = first.querySelector('input, .chip');
      if (input) input.focus();
    }
    return;
  }

  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Sending';

  const payload = {
    name: nameInput.value.trim(),
    email: emailInput.value.trim(),
    phone: fullPhone(),
    occasion: occasionInput.value,
    shoot_date: flexDate.checked ? 'Flexible' : dateField.value,
    location: locationInput.value.trim(),
    notes: notesInput.value.trim(),
    website: honeypot ? honeypot.value : '',
  };

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      form.classList.add('submitted');
      window.scrollTo({ top: form.offsetTop - 100, behavior: 'smooth' });
      return;
    }
    if (res.status === 422) {
      const data = await res.json().catch(() => ({}));
      Object.entries((data && data.errors) || {}).forEach(([field, message]) => showError(field, message));
      throw new Error('validation');
    }
    throw new Error('server');
  } catch (err) {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = 'Send Inquiry';
    if (err.message === 'validation') toast('Please check the highlighted fields.', 'error');
    else toast('Something went wrong. Please email book@glambotjo.com directly.', 'error');
  }
});

/* ── Cinematic scroll-reveal ────────────────────────────────────────────── */
(function reveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );
  items.forEach((el) => io.observe(el));
})();
