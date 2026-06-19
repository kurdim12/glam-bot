'use strict';

/* GLAMBOT hero cinematics: boot intro, cursor spotlight + parallax, dust. */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Cinematic boot-up (once per session) ──────────────────────────────────── */
(function boot() {
  const el = document.getElementById('boot');
  if (!el) return;

  if (reduceMotion || sessionStorage.getItem('glambot_booted')) {
    el.remove();
    return;
  }

  document.body.classList.add('booting');
  let frames = 0;
  const tc = document.getElementById('boot-tc');
  const pad = (n) => String(n).padStart(2, '0');
  const ticker = setInterval(() => {
    frames += 1;
    if (tc) tc.textContent = `00:00:${pad(Math.floor(frames / 25) % 60)}:${pad(frames % 25)}`;
  }, 30);

  const finish = () => {
    clearInterval(ticker);
    el.remove();
    document.body.classList.remove('booting');
    sessionStorage.setItem('glambot_booted', '1');
  };
  const open = () => {
    el.classList.add('open');
    setTimeout(finish, 650);
  };

  const t1 = setTimeout(open, 1300);
  el.addEventListener('click', () => { clearTimeout(t1); open(); }); // skip
})();

/* ── Cursor spotlight + subtle title parallax ──────────────────────────────── */
(function spotlight() {
  const hero = document.getElementById('hero');
  if (!hero || window.matchMedia('(hover: none)').matches) return;
  const top = hero.querySelector('.hero-top');

  hero.addEventListener('mouseenter', () => hero.classList.add('spot-on'));
  hero.addEventListener('mouseleave', () => {
    hero.classList.remove('spot-on');
    if (top) top.style.transform = '';
  });
  hero.addEventListener('mousemove', (e) => {
    const r = hero.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    hero.style.setProperty('--spot-x', x + 'px');
    hero.style.setProperty('--spot-y', y + 'px');
    if (top) {
      const cx = x / r.width - 0.5;
      const cy = y / r.height - 0.5;
      top.style.transform = `translate(${cx * -12}px, ${cy * -8}px)`;
    }
  });
})();

/* ── Drifting dust motes ───────────────────────────────────────────────────── */
(function particles() {
  const canvas = document.getElementById('hero-particles');
  if (!canvas || reduceMotion) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0, parts = [];

  const make = () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: (Math.random() * 1.6 + 0.4) * dpr,
    vx: (Math.random() - 0.5) * 0.12 * dpr,
    vy: (-Math.random() * 0.25 - 0.04) * dpr,
    a: Math.random() * 0.4 + 0.12,
  });
  const size = () => {
    const r = canvas.getBoundingClientRect();
    w = canvas.width = Math.max(1, r.width * dpr);
    h = canvas.height = Math.max(1, r.height * dpr);
    parts = Array.from({ length: r.width < 560 ? 22 : 46 }, make);
  };
  const tick = () => {
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -6) { p.y = h + 6; p.x = Math.random() * w; }
      if (p.x < -6) p.x = w + 6; else if (p.x > w + 6) p.x = -6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 170, 120, ${p.a})`;
      ctx.fill();
    }
    requestAnimationFrame(tick);
  };
  size();
  window.addEventListener('resize', size);
  tick();
})();
