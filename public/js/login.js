'use strict';

const form = document.getElementById('login-form');
const btn = document.getElementById('login-btn');
const errorEl = document.getElementById('login-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Checking...';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });

    if (res.ok) {
      window.location.href = '/admin/dashboard';
      return;
    }
    throw new Error('bad');
  } catch {
    errorEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Enter';
    document.getElementById('password').select();
  }
});
