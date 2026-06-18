'use strict';

/**
 * Tiny on-brand toast notifications — replaces native alert().
 * Usage: toast('Saved', 'success' | 'error' | 'info').
 * Self-contained: lazily creates its own container, no markup needed.
 */
(function () {
  function container() {
    let el = document.getElementById('glam-toasts');
    if (!el) {
      el = document.createElement('div');
      el.id = 'glam-toasts';
      el.className = 'toast-wrap';
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'false');
      document.body.appendChild(el);
    }
    return el;
  }

  window.toast = function (message, type = 'info', timeout = 4200) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;

    const dismiss = () => {
      el.classList.remove('show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400); // fallback
    };
    el.addEventListener('click', dismiss);

    container().appendChild(el);
    // next frame → trigger the enter transition
    requestAnimationFrame(() => el.classList.add('show'));
    if (timeout) setTimeout(dismiss, timeout);
    return el;
  };
})();
