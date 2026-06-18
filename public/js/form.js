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

// Prevent past dates on the date picker.
const dateField = document.getElementById('date');
if (dateField) {
  dateField.setAttribute('min', new Date().toISOString().split('T')[0]);
}

const form = document.getElementById('inquiry-form');
const btn = document.getElementById('submit-btn');

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

// Clear a field's error as soon as the user edits it.
form.addEventListener('input', (e) => {
  const field = e.target.closest('.field');
  if (field) field.classList.remove('invalid');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  btn.disabled = true;
  btn.textContent = 'Sending...';

  const payload = Object.fromEntries(new FormData(form).entries());

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      form.classList.add('submitted');
      window.scrollTo({ top: form.offsetTop - 100, behavior: 'smooth' });
      return;
    }

    if (res.status === 422) {
      const data = await res.json().catch(() => ({}));
      const errors = (data && data.errors) || {};
      Object.entries(errors).forEach(([field, message]) => showError(field, message));
      const first = form.querySelector('.field.invalid .field-input, .field.invalid .field-select');
      if (first) first.focus();
      throw new Error('validation');
    }

    throw new Error('server');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Send Inquiry';
    if (err.message !== 'validation') {
      alert('Something went wrong. Please email book@glambotjo.com directly.');
    }
  }
});
