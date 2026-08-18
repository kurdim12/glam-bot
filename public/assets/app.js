/* =========================================================
   GLAMBOT Jordan — interactions
   =========================================================

   ↓↓↓  EDIT THESE THREE LINES WITH THE REAL ACCOUNTS  ↓↓↓
   whatsapp : full international number, digits only, no "+"
              e.g. Jordan 07 9123 4567  ->  "962791234567"
              leave the X's in place and the WhatsApp buttons
              quietly fall back to email.
   ========================================================= */
const CONTACT = {
  email:     'book@glambotjo.com',
  whatsapp:  '962790944300',
  instagram: 'https://www.instagram.com/glambotjo/'
};

const hasWhatsApp = /^[0-9]{8,15}$/.test(CONTACT.whatsapp);
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------------------------------------------------------
   Contact links
   --------------------------------------------------------- */
(() => {
  const ig = $('#linkInsta');
  if (ig) ig.href = CONTACT.instagram;

  const wa = $('#linkWhats');
  if (wa) {
    if (hasWhatsApp) {
      wa.href = 'https://wa.me/' + CONTACT.whatsapp;
    } else {
      wa.href = 'mailto:' + CONTACT.email;
      wa.setAttribute('aria-label', 'Email GLAMBOT Jordan');
      wa.removeAttribute('target');
    }
  }
})();

/* ---------------------------------------------------------
   Hero reel — respect reduced motion, tolerate autoplay refusal
   --------------------------------------------------------- */
(() => {
  const v = $('#heroReel');
  if (!v) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    v.removeAttribute('autoplay');
    v.pause();
    return;
  }
  v.play().catch(() => {});
  // some browsers refuse autoplay until interaction — retry once on first touch
  addEventListener('pointerdown', () => v.paused && v.play().catch(() => {}), { once: true });
})();

/* ---------------------------------------------------------
   Nav — sticky background, mobile menu, active section
   --------------------------------------------------------- */
(() => {
  const nav    = $('#nav');
  const burger = $('#burger');
  const menu   = $('#mobileMenu');

  const onScroll = () => nav.classList.toggle('is-stuck', window.scrollY > 24);
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });

  const closeMenu = () => {
    nav.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
  };

  burger.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') === 'true';
    if (open) return closeMenu();
    nav.classList.add('is-open');
    burger.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
  });

  menu.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  // highlight the section currently in view
  const links = $$('.nav__links a');
  const map   = new Map();
  links.forEach(a => {
    const el = document.querySelector(a.getAttribute('href'));
    if (el) map.set(el, a);
  });

  if ('IntersectionObserver' in window && map.size) {
    const seen = new Set();
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => en.isIntersecting ? seen.add(en.target) : seen.delete(en.target));
      links.forEach(a => a.classList.remove('is-current'));
      const first = [...map.keys()].find(el => seen.has(el));
      if (first) map.get(first).classList.add('is-current');
    }, { rootMargin: '-45% 0px -50% 0px' });
    map.forEach((_, el) => io.observe(el));
  }
})();

/* ---------------------------------------------------------
   Scroll reveal
   --------------------------------------------------------- */
(() => {
  const items = $$('.reveal');
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) return items.forEach(i => i.classList.add('is-in'));

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      obs.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -12% 0px' });

  items.forEach(i => io.observe(i));
})();

/* ---------------------------------------------------------
   Audience — select a segment, swap the slatted image
   --------------------------------------------------------- */
(() => {
  const items = $$('.aud__item');
  const media = $('.aud__media');
  const img   = $('#audImg');
  if (!items.length || !img) return;

  items.forEach(btn => {
    btn.addEventListener('click', e => {
      const src = btn.dataset.img;

      if (!btn.classList.contains('is-active')) {
        items.forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');

        if (src && img.getAttribute('src') !== src) {
          media.classList.add('is-swapping');
          const next = new Image();
          next.onload = () => { img.src = src; media.classList.remove('is-swapping'); };
          next.onerror = () => media.classList.remove('is-swapping');
          next.src = src;
        }
      }

      // clicking the "Book this" affordance jumps to the form with the occasion set
      if (e.target.closest('.aud__go')) {
        setOccasion(btn.dataset.occasion);
        goTo('#book');
      }
    });
  });
})();

/* ---------------------------------------------------------
   Portfolio — thumbnails swap the stage, marker follows
   --------------------------------------------------------- */
(() => {
  const thumbs  = $$('.work__thumb');
  const stage   = $('.work__stage');
  const main    = $('#workMain');
  const caption = $('#workCaption');
  const marker  = $('#workMarker');
  if (!thumbs.length || !main) return;

  const place = () => {
    const active = $('.work__thumb.is-active');
    if (!active || !marker || getComputedStyle(marker).display === 'none') return;
    const top = active.offsetTop + active.offsetHeight / 2 - marker.offsetHeight / 2;
    marker.style.top = top + 'px';
  };

  const video = $('#workVideo');
  if (video && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.removeAttribute('autoplay');
    video.pause();
  }

  const select = (btn, play = false) => {
    thumbs.forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-pressed', 'false'); });
    btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', 'true');
    place();

    // the Jordan Create entry plays the showreel instead of a still
    if (btn.dataset.video) {
      caption.textContent = btn.dataset.caption || '';
      main.hidden = true;
      if (video) {
        video.hidden = false;
        if (play) {            // a fresh press always restarts from the top
          video.currentTime = 0;
          video.play().catch(() => {});
        }
      }
      return;
    }
    if (video) { video.pause(); video.hidden = true; }
    main.hidden = false;

    const src = btn.dataset.src;
    if (main.getAttribute('src') === src) return;
    stage.classList.add('is-swapping');
    const next = new Image();
    next.onload = () => {
      main.src = src;
      main.alt = btn.dataset.caption || '';
      caption.textContent = btn.dataset.caption || '';
      stage.classList.remove('is-swapping');
    };
    next.onerror = () => stage.classList.remove('is-swapping');
    next.src = src;
  };

  thumbs.forEach(btn => {
    btn.addEventListener('click', () => select(btn, true));
    btn.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i    = thumbs.indexOf(btn);
      const step = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
      const next = thumbs[(i + step + thumbs.length) % thumbs.length];
      next.focus();
      select(next, true);
    });
  });

  addEventListener('load', place);
  addEventListener('resize', place);
  place();
})();

/* ---------------------------------------------------------
   What's Included — cards select on click (one active)
   --------------------------------------------------------- */
(() => {
  const cards = $$('.inc__card');
  cards.forEach(card => card.addEventListener('click', () => {
    cards.forEach(c => { c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false'); });
    card.classList.add('is-active');
    card.setAttribute('aria-pressed', 'true');
  }));
})();

/* ---------------------------------------------------------
   Requirements — spec callouts light their connector
   --------------------------------------------------------- */
(() => {
  const specs = $$('.spec');
  const lite  = (id, on) => { const g = document.getElementById(id); if (g) g.classList.toggle('is-lit', on); };

  specs.forEach(spec => {
    const id = spec.dataset.conn;
    spec.addEventListener('mouseenter', () => lite(id, true));
    spec.addEventListener('mouseleave', () => lite(id, spec.classList.contains('is-on')));
    spec.addEventListener('focus',      () => lite(id, true));
    spec.addEventListener('blur',       () => lite(id, spec.classList.contains('is-on')));
    spec.addEventListener('click', () => {
      const on = !spec.classList.contains('is-on');
      specs.forEach(s => { s.classList.remove('is-on'); s.setAttribute('aria-pressed', 'false'); lite(s.dataset.conn, false); });
      if (on) { spec.classList.add('is-on'); spec.setAttribute('aria-pressed', 'true'); }
      lite(id, on);
    });
  });
})();

/* ---------------------------------------------------------
   How It Works — step-by-step player (manual navigation)
   --------------------------------------------------------- */
(() => {
  const player = $('#hiwPlayer');
  if (!player) return;

  const STEPS = [
    ['We arrive with the cases', 'The whole robot travels in a few boxes. We bring them in and clear a space of 5 by 5 meters.'],
    ['We build it', 'Base first, then the pedestal, then the arm. This step takes around 20 minutes.'],
    ['We calibrate', 'The arm runs through its full range so it knows exactly where it is. Nothing gets filmed until this is done.'],
    ['We test the moves', 'We run each path a few times and watch the speed and the framing, so by the time guests arrive we already know what it looks like.'],
    ['Guests come up', 'We show you where to stand and where to look, and that is really all you need to know.'],
    ['You move however you want', 'No holding still. Dance, laugh, throw your hands up. The arm handles the rest.'],
    ['You get your video right away', 'It lands on your phone before you sit back down.'],
  ];

  const stage = $('.hiw__stage');
  const img   = $('#hiwImg');
  const segs  = $$('.hiw__seg');
  $('.hiw').classList.add('hiw--static');   // no timed fill on the chapter bars

  let i = 0;

  const paint = n => {
    i = (n + STEPS.length) % STEPS.length;
    $('#hiwStep').textContent  = `Step ${i + 1}:`;
    $('#hiwTitle').textContent = STEPS[i][0];
    $('#hiwDesc').textContent  = STEPS[i][1];
    $('#hiwTc').innerHTML      = `STEP&nbsp;0${i + 1}&nbsp;/&nbsp;07`;

    stage.classList.add('is-swapping');
    const next = new Image();
    next.onload  = () => {
      img.src = next.src;
      img.alt = `Step ${i + 1} — ${STEPS[i][0]}`;
      stage.classList.remove('is-swapping');
    };
    next.onerror = () => stage.classList.remove('is-swapping');
    next.src = `assets/step-${i + 1}.jpg`;

    segs.forEach((sg, k) => {
      sg.classList.toggle('is-done', k < i);
      sg.classList.toggle('is-on',   k === i);
      sg.setAttribute('aria-current', k === i ? 'true' : 'false');
    });

    centreActive();
  };

  /* On a phone the 7-step strip is wider than the screen, so the active step
     can sit off-frame — which reads as "stuck". Keep it centred. Scrolls the
     strip only, never the page. */
  const timeline = $('#hiwTimeline');
  function centreActive() {
    if (!timeline || timeline.scrollWidth <= timeline.clientWidth + 1) return;
    const item = segs[i].closest('li') || segs[i];
    const strip = timeline.getBoundingClientRect();
    const box   = item.getBoundingClientRect();
    const delta = (box.left - strip.left) - (strip.width - box.width) / 2;
    if (Math.abs(delta) < 2) return;
    timeline.scrollBy({
      left: delta,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  segs.forEach(sg => sg.addEventListener('click', () => paint(+sg.dataset.i)));
  $('#hiwPrev').addEventListener('click', () => paint(i - 1));
  $('#hiwNext').addEventListener('click', () => paint(i + 1));
  player.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); paint(i - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); paint(i + 1); }
  });

  paint(0);
})();

/* ---------------------------------------------------------
   Packages — selecting one carries into the booking form
   --------------------------------------------------------- */
/* Card 1 carries the design's default emphasis; nothing is actually
   selected until the visitor picks a package, so the form stays clean. */
let selectedPackage = '';

(() => {
  const pkgs = $$('.pkg');
  const note = $('#pkgNote');
  const name = $('#pkgNoteName');
  const clr  = $('#pkgClear');

  const paint = () => {
    if (!note) return;
    note.hidden = !selectedPackage;
    if (selectedPackage) name.textContent = selectedPackage;
  };

  pkgs.forEach(pkg => {
    pkg.addEventListener('click', e => {
      pkgs.forEach(p => { p.classList.remove('is-active'); p.setAttribute('aria-pressed', 'false'); });
      pkg.classList.add('is-active');
      pkg.setAttribute('aria-pressed', 'true');
      selectedPackage = pkg.dataset.pkg;
      paint();
      if (e.target.closest('.pkg__pick')) goTo('#book');
    });
  });

  if (clr) clr.addEventListener('click', () => {
    selectedPackage = '';
    pkgs.forEach(p => { p.classList.remove('is-active'); p.setAttribute('aria-pressed', 'false'); });
    paint();
  });

  paint();
})();

/* ---------------------------------------------------------
   Shared helpers
   --------------------------------------------------------- */
function goTo(hash) {
  const el = document.querySelector(hash);
  if (!el) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav    = document.querySelector('.nav')?.offsetHeight || 0;
  const usable = innerHeight - nav;
  const r      = el.getBoundingClientRect();
  // Land on the section's real starting point, in priority order:
  //   1. an explicit [data-scroll-anchor]  (Book Now -> the form's first field)
  //   2. the rail line (divider + label + heading sit right under the nav)
  //   3. the section box itself
  const target = el.querySelector('[data-scroll-anchor]') || el.querySelector('.rail');
  const start  = target ? target.getBoundingClientRect().top : r.top;
  const top    = scrollY + start - nav - Math.min(28, usable * .035);
  scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
}

/* every in-page anchor uses the same centring scroll */
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const hash = a.getAttribute('href');
  if (hash === '#' || hash === '#top') return;      // '#top' keeps native scroll-to-top
  if (!document.querySelector(hash)) return;
  e.preventDefault();
  goTo(hash);
  history.replaceState(null, '', hash);
});

function setOccasion(value) {
  if (!value) return;
  const chip = $$('.chip').find(c => c.dataset.v === value);
  if (chip) chip.click();
}

/* ---------------------------------------------------------
   Country-code dropdown — flag pill + listbox
   --------------------------------------------------------- */
(() => {
  const cc    = $('#cc');
  if (!cc) return;
  const btn   = $('#ccBtn');
  const list  = $('#ccList');
  const code  = $('#ccCode');
  const flag  = $('#ccFlag');
  const value = $('#fCode');
  const items = $$('#ccList li');

  const close = () => {
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    (items.find(i => i.getAttribute('aria-selected') === 'true') || items[0]).focus?.();
  };

  const pick = li => {
    items.forEach(i => i.setAttribute('aria-selected', 'false'));
    li.setAttribute('aria-selected', 'true');
    code.textContent = li.dataset.code;
    flag.src = li.dataset.flag;
    value.value = li.dataset.code;
    btn.setAttribute('aria-label', `Country calling code: ${li.querySelector('span').textContent} ${li.dataset.code}`);
    close();
    btn.focus();
  };

  btn.addEventListener('click', () => list.hidden ? open() : close());
  items.forEach(li => li.addEventListener('click', () => pick(li)));

  document.addEventListener('click', e => { if (!cc.contains(e.target)) close(); });
  cc.addEventListener('keydown', e => {
    if (e.key === 'Escape') { close(); btn.focus(); return; }
    if (list.hidden) return;
    const hi = items.findIndex(i => i.classList.contains('is-hi'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = items[(Math.max(hi, 0) + step + items.length) % items.length];
      items.forEach(i => i.classList.remove('is-hi'));
      next.classList.add('is-hi');
      next.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(items[hi]); }
  });
})();

/* ---------------------------------------------------------
   Occasion chips — single-select radio group
   --------------------------------------------------------- */
(() => {
  const chips  = $$('.chip');
  const hidden = $('#fOccasion');
  const group  = $('#chips');
  if (!chips.length) return;

  const pick = chip => {
    chips.forEach(c => { c.classList.remove('is-on'); c.setAttribute('aria-checked', 'false'); c.tabIndex = -1; });
    chip.classList.add('is-on');
    chip.setAttribute('aria-checked', 'true');
    chip.tabIndex = 0;
    hidden.value = chip.dataset.v;
    group.classList.remove('has-err');
  };

  chips.forEach(chip => {
    chip.addEventListener('click', () => pick(chip));
    chip.addEventListener('keydown', e => {
      const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      const i    = chips.indexOf(chip);
      const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      const next = chips[(i + step + chips.length) % chips.length];
      pick(next);
      next.focus();
    });
  });
})();

/* ---------------------------------------------------------
   Booking form — validation + hand-off
   --------------------------------------------------------- */
(() => {
  const form = $('#bookForm');
  if (!form) return;

  const done   = $('#done');
  const notes  = $('#fNotes');
  const date   = $('#fDate');

  // date can't be in the past
  if (date) {
    const t = new Date();
    date.min = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  // textarea grows with its content
  if (notes) {
    const grow = () => { notes.style.height = 'auto'; notes.style.height = notes.scrollHeight + 'px'; };
    notes.addEventListener('input', grow);
    grow();
  }

  const setErr = (id, msg) => {
    const slot  = $(`.err[data-err="${id}"]`);
    const input = document.getElementById(id);
    if (slot) slot.textContent = msg || '';
    if (input) input.closest('.field')?.classList.toggle('has-err', !!msg);
  };

  const rules = () => {
    const out = {};
    const name = $('#fName').value.trim();
    const mail = $('#fEmail').value.trim();
    const tel  = $('#fPhone').value.trim();
    const loc  = $('#fLocation').value.trim();
    const when = $('#fDate').value;

    if (name.length < 2)                              out.fName     = 'Please tell us your name.';
    if (!/^[0-9\s\-()]{6,}$/.test(tel))               out.fPhone    = 'Enter a reachable phone number.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail))  out.fEmail    = 'Enter a valid email address.';
    if (!when)                                        out.fDate     = 'Pick a shoot date.';
    if (!loc)                                         out.fLocation = 'Where is the shoot?';
    return out;
  };

  ['fName', 'fPhone', 'fEmail', 'fDate', 'fLocation'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input',  () => setErr(id, ''));
    el.addEventListener('blur',   () => { const e = rules(); setErr(id, e[id]); });
  });

  const compose = () => {
    const L = [];
    L.push(`New booking inquiry — GLAMBOT Jordan`);
    L.push('');
    L.push(`Name: ${$('#fName').value.trim()}`);
    L.push(`Phone: ${$('#fCode').value} ${$('#fPhone').value.trim()}`);
    L.push(`Email: ${$('#fEmail').value.trim()}`);
    L.push(`Occasion: ${$('#fOccasion').value}`);
    if (selectedPackage) L.push(`Package: ${selectedPackage}`);
    L.push(`Shoot date: ${$('#fDate').value}`);
    L.push(`Location: ${$('#fLocation').value.trim()}`);
    const extra = $('#fNotes').value.trim();
    if (extra) { L.push(''); L.push(`Notes: ${extra}`); }
    return L.join('\n');
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errs = rules();
    ['fName', 'fPhone', 'fEmail', 'fDate', 'fLocation'].forEach(id => setErr(id, errs[id]));

    if (Object.keys(errs).length) {
      const first = document.getElementById(Object.keys(errs)[0]);
      first?.focus({ preventScroll: true });
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn = $('#submitBtn');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending…';

    // Shape matches the bookings table (see migrations/0001_init.sql).
    const payload = {
      name:       $('#fName').value.trim(),
      email:      $('#fEmail').value.trim(),
      phone:      `${$('#fCode').value} ${$('#fPhone').value.trim()}`.trim(),
      shoot_date: $('#fDate').value,
      occasion:   $('#fOccasion').value,
      location:   $('#fLocation').value.trim(),
      notes:      [selectedPackage ? `Package: ${selectedPackage}` : '', $('#fNotes').value.trim()]
                    .filter(Boolean).join('\n'),
      website:    $('#fWebsite')?.value || '',   // honeypot
    };

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 422) {
        const data = await res.json().catch(() => ({}));
        const map = { name:'fName', email:'fEmail', phone:'fPhone', shoot_date:'fDate', location:'fLocation' };
        Object.entries((data && data.errors) || {}).forEach(([field, msg]) => setErr(map[field] || field, msg));
        throw new Error('validation');
      }
      if (!res.ok) throw new Error('server');

      showDone(payload);                       // saved — show the confirmation
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      if (err.message === 'validation') return;
      // Server unreachable: don't lose the inquiry — fall back to the hand-off.
      showDone(payload, true);
    }
  });

  /* Confirmation panel. `offline` = we could not reach the server, so the
     visitor is asked to send the details themselves instead. */
  function showDone(payload, offline = false) {
    const firstName = payload.name.split(' ')[0];
    $('#doneSummary').textContent = offline
      ? `We couldn't reach the server, ${firstName}. Send us these details directly and we'll pick it up right away.`
      : `Thanks ${firstName} — your inquiry is in. We'll be in touch by phone to confirm ${payload.occasion.toLowerCase()} on ${payload.shoot_date} at ${payload.location}.`;

    const body = [
      'New booking inquiry — GLAMBOT Jordan', '',
      `Name: ${payload.name}`,
      `Phone: ${payload.phone}`,
      `Email: ${payload.email}`,
      `Occasion: ${payload.occasion}`,
      `Shoot date: ${payload.shoot_date}`,
      `Location: ${payload.location}`,
      payload.notes ? `\nNotes: ${payload.notes}` : '',
    ].filter(Boolean).join('\n');

    const wa = $('#doneWhats');
    if (hasWhatsApp) {
      wa.href = `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(body)}`;
      wa.target = '_blank'; wa.rel = 'noopener';
      wa.hidden = false;
    } else {
      wa.hidden = true;
    }
    $('#doneMail').href =
      `mailto:${CONTACT.email}?subject=${encodeURIComponent(`Booking inquiry — ${payload.occasion} on ${payload.shoot_date}`)}&body=${encodeURIComponent(body)}`;

    // When it saved, the hand-off buttons are optional extras, not the point.
    $('.done__note').textContent = offline
      ? 'Nothing has been sent yet — choose how you would like to reach us.'
      : 'Saved. You can also send a copy to us directly if you like.';

    form.hidden = true;
    $('#done').hidden = false;
    $('#done').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  $('#doneEdit').addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    $('#fName').focus();
  });
})();
