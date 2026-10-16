/* Pinch: page shell behaviour.
   Theme toggle, top bar state, phone menu, entrance motion, live browser checks,
   the network request readout and the small interactive fragments in the features section.
   Never touches #studio (app.js owns it). */
(function () {
  'use strict';

  const root = document.documentElement;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Sizes measured on the real sample photos with Pinch's own encoders (see README, "Numbers on the page").
     Bytes. */
  const DATA = {
    originals: { valley: 361245, harbour: 438266, lake: 299315, hills: 591976 },
    // valley.jpg saved as WebP at each quality
    quality: { 40: 108954, 45: 121858, 50: 132704, 55: 142748, 60: 156340, 65: 172342, 70: 188962, 75: 202434, 80: 261624, 85: 323156, 90: 440886, 95: 662662 },
    // harbour.jpg saved at quality 75 (PNG is lossless)
    formats: { jpeg: 380733, png: 3699329, webp: 294626, avif: 200905 },
    // hills.jpg as JPG with a target size; Pinch also makes the picture smaller when quality alone can't fit
    target: { 50: { bytes: 50327, q: 32, w: 1474, h: 983 }, 100: { bytes: 99221, q: 32, w: 2040, h: 1360 }, 200: { bytes: 195597, q: 43 } },
    // the Web preset (WebP, quality 75, fitted inside 2560 px)
    batch: { valley: 202434, harbour: 294626, lake: 154188, hills: 450922 },
  };

  const fmtBytes = (n) => {
    if (window.Pinch && typeof window.Pinch.bytes === 'function') return window.Pinch.bytes(n);
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';
  };
  const pct = (from, to) => {
    const p = Math.round((to / from - 1) * 100);
    return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p) + '%';
  };
  function setDelta(el, from, to) {
    el.textContent = pct(from, to);
    el.classList.toggle('is-warn', to >= from);
  }

  /* ------------------------------------------------------------ theme */
  const THEME_KEY = 'pinch-theme';
  const themeBtn = $('#theme');
  const THEMES = {
    system: { icon: 'i-auto', label: 'Theme: match the system. Switch to light.', next: 'light' },
    light: { icon: 'i-sun', label: 'Theme: light. Switch to dark.', next: 'dark' },
    dark: { icon: 'i-moon', label: 'Theme: dark. Switch to match the system.', next: 'system' },
  };
  const metaLight = $('meta[name="theme-color"][media*="light"]');
  const metaDark = $('meta[name="theme-color"][media*="dark"]');

  function storedTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch (e) { return 'system'; }
  }
  function applyTheme(mode, save) {
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    if (save) {
      try {
        if (mode === 'system') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, mode);
      } catch (e) { /* private mode: the choice lasts for this visit */ }
    }
    const t = THEMES[mode];
    if (themeBtn) {
      themeBtn.setAttribute('aria-label', t.label);
      themeBtn.title = t.label.split('.')[0];
      const use = $('use', themeBtn);
      if (use) use.setAttribute('href', '#' + t.icon);
    }
    if (metaLight && metaDark) {
      const light = '#f6f6f4', dark = '#0c0d0f';
      metaLight.content = mode === 'dark' ? dark : light;
      metaDark.content = mode === 'light' ? light : dark;
    }
  }
  applyTheme(storedTheme(), false);
  if (themeBtn) themeBtn.addEventListener('click', () => applyTheme(THEMES[storedThemeOrCurrent()].next, true));
  function storedThemeOrCurrent() {
    const a = root.getAttribute('data-theme');
    return a === 'light' || a === 'dark' ? a : 'system';
  }
  window.addEventListener('storage', (e) => { if (e.key === THEME_KEY) applyTheme(storedTheme(), false); });

  /* ------------------------------------------------------------ top bar: scrolled state and current section */
  const bar = $('#bar');
  const navLinks = $$('#nav-list a');
  const navTargets = navLinks.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
  let ticking = false;
  function onScroll() {
    ticking = false;
    if (bar) bar.classList.toggle('is-scrolled', window.scrollY > 4);
    const line = window.innerHeight * 0.35;
    let current = null;
    for (const s of navTargets) if (s.getBoundingClientRect().top <= line) current = s.id;
    const footTop = $('.foot') ? $('.foot').getBoundingClientRect().top : Infinity;
    if (footTop < line) current = null;
    navLinks.forEach((a) => {
      if (a.hash.slice(1) === current) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  ticking = true;
  requestAnimationFrame(onScroll);   // measuring now would force the first layout inside this script's task

  /* ------------------------------------------------------------ phone menu */
  const menuBtn = $('#menu-btn');
  const menu = $('#menu');
  function setMenu(open) {
    if (!menu || !menuBtn) return;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    const use = $('use', menuBtn);
    if (use) use.setAttribute('href', open ? '#i-close' : '#i-menu');
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => menu.classList.add('is-open'));
    } else {
      menu.classList.remove('is-open');
      const done = () => { if (!menu.classList.contains('is-open')) menu.hidden = true; };
      if (reduceMotion.matches) done(); else setTimeout(done, 200);
    }
  }
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('click', (e) => {
      if (menuBtn.getAttribute('aria-expanded') === 'true' && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') { setMenu(false); menuBtn.focus(); }
    });
    window.matchMedia('(min-width: 761px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });
  }

  /* ------------------------------------------------------------ landing pictures
     The big feature pictures carry data-src and load when they come near, so nothing below the
     studio competes with its first screen (loading="lazy" alone starts them at once, because they
     sit within the browser's lazy-load distance of the fold). */
  function loadPicture(img) {
    if (!img.dataset.src) return;
    if (img.dataset.srcset) { img.srcset = img.dataset.srcset; img.removeAttribute('data-srcset'); }
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  }
  const pictures = $$('img[data-src]').filter((img) => !img.closest('#cmp'));   // the compare tile loads its own, below
  if (pictures.length && 'IntersectionObserver' in window) {
    const pio = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { pio.unobserve(e.target); loadPicture(e.target); }
    }), { rootMargin: '400px 0px' });
    pictures.forEach((img) => pio.observe(img));
  } else pictures.forEach(loadPicture);

  /* ------------------------------------------------------------ entrance motion
     Only content that starts below the fold is hidden, and only when motion is allowed,
     so nothing is ever invisible without JS or with reduced motion. */
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    // Measure the section first: sections below the fold skip layout (content-visibility), and measuring
    // an item inside one would force it.
    const below = (el) => {
      const sec = el.closest('.sec, .foot');
      return (sec && sec.getBoundingClientRect().top > window.innerHeight) || el.getBoundingClientRect().top > window.innerHeight;
    };
    // in the next frame, so measuring does not force a layout inside this script's task
    requestAnimationFrame(() => {
      const items = $$('[data-reveal]').filter(below);
      const io = new IntersectionObserver((entries) => {
        let k = 0;
        entries.filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
          .forEach((e) => {
            e.target.style.setProperty('--i', String(k++));
            e.target.classList.remove('is-pending');
            io.unobserve(e.target);
            setTimeout(() => e.target.style.removeProperty('--i'), 900);
          });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
      items.forEach((el) => { el.classList.add('is-pending'); io.observe(el); });
    });
  }

  /* ------------------------------------------------------------ GitHub stars
     The last known count at once, then GitHub again if that count is over five minutes old or zero
     (at most 12 requests an hour; 60 are allowed without a token). Any failure leaves no count.
     This is the only request the page makes to another site, and it never carries images. */
  const star = $('#starLink');
  const showStars = (n) => {
    star.classList.toggle('has-count', n > 0);
    $('#starCount').textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
    $('.star-sr', star).textContent = n > 0 ? ', ' + n + ' ' + (n === 1 ? 'star' : 'stars') : '';
  };
  const afterLoad = (fn) => {
    const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 300));
    if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
  };
  if (star) (async () => {
    const KEY = 'pinch-stars', FRESH = 5 * 60e3;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY)); } catch (e) { cached = null; }
    if (cached && typeof cached.n === 'number') showStars(cached.n);
    if (cached && cached.n > 0 && Date.now() - cached.t < FRESH) return;
    await new Promise(afterLoad);   // never ahead of the first screen
    try {
      const res = await fetch('https://api.github.com/repos/mhfrough/pinch', { cache: 'no-store' });
      const n = res.ok ? (await res.json()).stargazers_count : null;
      if (typeof n !== 'number') return;
      try { localStorage.setItem(KEY, JSON.stringify({ n, t: Date.now() })); } catch (e) { /* private mode */ }
      showStars(n);
    } catch (e) { /* offline or rate limited: no count */ }
  })();

  /* ------------------------------------------------------------ live browser checks */
  const AVIF_1PX = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAJQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAALW1kYXQSAAoIGAA2iAhoNCAyFxlHh4Yhh5555oAAAJBAyRjbu51tkhGY';

  function decodes(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.width > 0);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }
  function setEnv(key, ok, text) {
    const li = $('[data-env="' + key + '"]');
    if (!li) return;
    li.classList.toggle('is-yes', ok === true);
    li.classList.toggle('is-no', ok === false);
    $('.env-val', li).textContent = text;
  }
  function setCell(key, state, text) {
    $$('[data-live="' + key + '"]').forEach((el) => {
      el.classList.remove('st-yes', 'st-part', 'st-no');
      el.classList.add(state === 'yes' ? 'st-yes' : state === 'no' ? 'st-no' : 'st-part');
      el.textContent = text;
    });
  }

  async function engineInfo() {
    const P = window.Pinch;
    if (!P || !P.ready) return null;
    try { return await Promise.race([P.ready, new Promise((r) => setTimeout(() => r(null), 8000))]); } catch (e) { return null; }
  }

  async function runChecks() {
    let wasm = false;
    try { wasm = typeof WebAssembly === 'object' && WebAssembly.validate(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)); } catch (e) { wasm = false; }
    const workers = typeof Worker === 'function';
    setEnv('wasm', wasm, wasm ? 'Yes' : 'No');
    setEnv('workers', workers, workers ? 'Yes' : 'No');
    setCell('save-webp', wasm ? 'yes' : 'no', wasm ? 'Yes' : 'Not here');
    setCell('save-avif', wasm ? 'yes' : 'no', wasm ? 'Yes' : 'Not here');

    const [avifNative, info] = await Promise.all([decodes(AVIF_1PX), engineInfo()]);
    if (info && info.encode) {
      // the engine knows best: WebAssembly encoders, or the browser's own when they are missing
      ['webp', 'avif'].forEach((f) => setCell('save-' + f, info.encode[f] ? 'yes' : 'no', info.encode[f] ? 'Yes' : 'Not here'));
    }
    const P = window.Pinch || {};
    const engineAvif = !!(info && (info.avifDecode || info.wasm));
    setCell('open-avif', avifNative || engineAvif ? 'yes' : 'no', avifNative || engineAvif ? 'Yes' : 'Not here');

    // HEIC: trust the engine when it says; otherwise only Safari decodes it.
    let heic = null;
    if (info && typeof info.heic === 'boolean') heic = info.heic;
    else if (typeof P.canOpen === 'function') { try { heic = !!(await P.canOpen('heic')); } catch (e) { heic = null; } }
    if (heic === null) {
      const ua = navigator.userAgent;
      const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|Edg\/|Firefox\/|FxiOS\//.test(ua);
      heic = safari;
    }
    const viaEngine = !!(info && info.heic === true);
    setCell('open-heic', heic ? 'yes' : 'part', viaEngine ? 'Yes' : heic ? 'Yes, in this browser' : 'Not in this browser');
    const faq = $('[data-live="faq-heic"]');
    if (faq && !heic) faq.textContent = 'Not in this browser, because it can’t run the HEIC decoder that comes with Pinch. Try a current version of Chrome, Edge, Firefox or Safari, or set the iPhone to Settings, Camera, Formats, Most Compatible, and it will take JPG photos instead.';

    // WebGPU makes AI upscaling fast; without it the model runs on WebAssembly.
    let gpu = false;
    try {
      if (window.PinchAI && typeof window.PinchAI.available === 'function') gpu = !!(await window.PinchAI.available()).webgpu;
      else if (navigator.gpu) gpu = !!(await navigator.gpu.requestAdapter());
    } catch (e) { gpu = false; }
    setEnv('gpu', gpu, gpu ? 'Yes' : 'No, uses WebAssembly');
  }
  // The checks fill cells further down the page, and the WebGPU and WebGL probes cost real main-thread
  // time, so they run when one of those sections comes near (observing the sections, not the cells,
  // because the sections skip layout until then).
  (function scheduleChecks() {
    let done = false;
    const run = () => { if (!done) { done = true; runChecks(); } };
    const secs = Array.from(new Set($$('[data-live], [data-env]').map((el) => el.closest('.sec, .foot') || el)));
    if (!secs.length || !('IntersectionObserver' in window)) { run(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); run(); } }, { rootMargin: '800px 0px' });
    secs.forEach((el) => io.observe(el));
  })();

  /* ------------------------------------------------------------ network readout
     Counts every resource request this page makes after the first image is added. */
  const netCount = $('#net-count');
  const netOther = $('#net-other');
  const netImages = $('#net-images');
  const netEmpty = $('#net-empty');
  const netList = $('#net-list');
  let armedAt = -1, requests = 0, other = 0, domImages = 0, eventImages = 0, sawEvent = false;
  const pending = [];

  function arm(count) {
    if (!count) return;
    if (armedAt < 0) {
      armedAt = performance.now();
      // keep anything that started after this moment but arrived before we armed
      pending.splice(0).forEach(record);
      if (netEmpty) netEmpty.textContent = 'No requests since your first image. Pinch is working on this device.';
    }
    renderNet();
  }
  function record(entry) {
    if (armedAt < 0) { pending.push(entry); if (pending.length > 200) pending.shift(); return; }
    if (entry.startTime < armedAt) return;
    let url;
    try { url = new URL(entry.name, location.href); } catch (e) { return; }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.hostname === 'api.github.com') return; // the star count on the top bar, explained in the privacy section
    requests++;
    const foreign = url.origin !== location.origin;
    if (foreign) other++;
    if (netList) {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = decodeURIComponent(url.pathname.split('/').pop() || url.hostname);
      const h = document.createElement('span');
      h.className = 'h';
      const size = entry.transferSize ? fmtBytes(entry.transferSize) : 'from cache';
      h.textContent = (foreign ? url.hostname : 'this site') + ', ' + size;
      li.append(n, h);
      netList.prepend(li);
      while (netList.children.length > 4) netList.lastChild.remove();
      netList.hidden = false;
      if (netEmpty) netEmpty.hidden = true;
    }
    renderNet(true);
  }
  function renderNet(bump) {
    if (netCount) {
      netCount.textContent = String(requests);
      if (bump && !reduceMotion.matches) {
        netCount.classList.remove('is-bump');
        void netCount.offsetWidth;
        netCount.classList.add('is-bump');
      }
    }
    if (netOther) netOther.textContent = String(other);
    if (netImages) netImages.textContent = String(sawEvent ? eventImages : domImages);
  }
  if ('PerformanceObserver' in window) {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(record)).observe({ type: 'resource', buffered: false });
    } catch (e) { /* very old browser: the readout stays at 0 */ }
  }
  const imageCount = (files) => Array.from(files || []).filter((f) => /^image\//.test(f.type) || /\.(heic|heif|ico|avif|webp|jfif)$/i.test(f.name)).length;
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.type === 'file' && t.files && t.files.length) { domImages += imageCount(t.files); arm(imageCount(t.files)); }
  }, true);
  document.addEventListener('drop', (e) => {
    const n = imageCount(e.dataTransfer && e.dataTransfer.files);
    if (n) { domImages += n; arm(n); }
  }, true);
  document.addEventListener('paste', (e) => {
    const n = imageCount(e.clipboardData && e.clipboardData.files);
    if (n) { domImages += n; arm(n); }
  }, true);
  // The studio announces every add, including samples and folders, with this event.
  const onPinchFiles = (e) => {
    const n = (e.detail && Number(e.detail.count)) || 1;
    sawEvent = true;
    eventImages += n;
    arm(n);
  };
  window.addEventListener('pinch:files', onPinchFiles);

  const conn = $('#conn');
  const connLabel = $('#conn-label');
  function renderConn() {
    if (!conn) return;
    const on = navigator.onLine !== false;
    conn.classList.toggle('is-off', !on);
    connLabel.textContent = on ? 'Online' : 'Offline';
  }
  window.addEventListener('online', renderConn);
  window.addEventListener('offline', renderConn);
  renderConn();

  /* ------------------------------------------------------------ features: measured numbers */
  const O = DATA.originals;
  const setM = (key, text) => $$('[data-m="' + key + '"]').forEach((el) => { el.textContent = text; });
  setM('cmp-in', fmtBytes(O.lake));
  setM('q-in', fmtBytes(O.valley));
  setM('fmt-in', fmtBytes(O.harbour));
  setM('tgt-in', fmtBytes(O.hills));
  if (DATA.batch) {
    const keys = ['valley', 'harbour', 'lake', 'hills'];
    let tin = 0, tout = 0;
    keys.forEach((k, i) => {
      const out = DATA.batch[k];
      tin += O[k]; tout += out;
      setM('b' + (i + 1) + '-in', fmtBytes(O[k]));
      setM('b' + (i + 1) + '-out', fmtBytes(out));
      const d = $('[data-m="b' + (i + 1) + '-d"]');
      if (d) setDelta(d, O[k], out);
    });
    setM('b-in', fmtBytes(tin));
    setM('b-out', fmtBytes(tout));
  }

  /* compare: drag the line, arrow keys, zoom */
  const cmp = $('#cmp');
  if (cmp) {
    const line = $('.cmp-line', cmp);
    let pos = 50;
    const setPos = (p) => {
      pos = Math.max(0, Math.min(100, p));
      cmp.style.setProperty('--pos', pos + '%');
      line.setAttribute('aria-valuenow', String(Math.round(pos)));
      line.setAttribute('aria-valuetext', Math.round(pos) + ' percent');
    };
    const fromEvent = (e) => {
      const r = cmp.getBoundingClientRect();
      setPos(((e.clientX - r.left) / r.width) * 100);
    };
    cmp.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.zoom') || e.button !== 0) return;
      cmp.setPointerCapture(e.pointerId);
      cmp.classList.add('is-dragging');
      fromEvent(e);
    });
    cmp.addEventListener('pointermove', (e) => { if (cmp.hasPointerCapture(e.pointerId)) fromEvent(e); });
    const end = (e) => { if (cmp.hasPointerCapture(e.pointerId)) cmp.releasePointerCapture(e.pointerId); cmp.classList.remove('is-dragging'); };
    cmp.addEventListener('pointerup', end);
    cmp.addEventListener('pointercancel', end);
    line.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 2;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setPos(pos - step);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setPos(pos + step);
      else if (e.key === 'Home') setPos(0);
      else if (e.key === 'End') setPos(100);
      else return;
      e.preventDefault();
    });
    const zooms = [1, 2, 4];
    let z = 0;
    const zoomOut = $('#zoom-out');
    $$('[data-zoom]', cmp).forEach((b) => b.addEventListener('click', () => {
      z = Math.max(0, Math.min(zooms.length - 1, z + Number(b.dataset.zoom)));
      cmp.style.setProperty('--zoom', String(zooms[z]));
      zoomOut.textContent = zooms[z] * 100 + '%';
    }));
  }

  /* compare: the right side becomes a real WebP at quality 75, made in this browser when the tile comes near.
     If neither the engine nor the browser can make one, the tile only claims what is true. */
  async function makeWebp() {
    const res = await fetch('assets/samples/p989.jpg');
    const blob = await res.blob();
    const P = window.Pinch;
    if (P && typeof P.process === 'function') {
      try {
        const file = new File([blob], 'lake.jpg', { type: 'image/jpeg' });
        const r = await P.process(file, { format: 'webp', quality: 75 });
        if (r && r.blob && r.blob.type === 'image/webp') return r.blob;
      } catch (e) { /* fall through to the browser encoder */ }
    }
    if (!('createImageBitmap' in window)) return null;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const out = await new Promise((r) => c.toBlob(r, 'image/webp', 0.75));
    return out && out.type === 'image/webp' ? out : null;
  }
  const cmpTile = $('#cmp');
  if (cmpTile) {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      $$('img[data-src]', cmpTile).forEach(loadPicture);
      makeWebp().then((webp) => {
        if (!webp) return;
        const img = $('.cmp-after img', cmpTile);
        img.src = URL.createObjectURL(webp);
        $('#cmp-out').textContent = fmtBytes(webp.size);
        $('#cmp-chip').hidden = false;
        const saved = Math.round((1 - webp.size / O.lake) * 100);
        $('#cmp-claim').textContent = 'The right side is a real WebP at quality 75, made by this browser a moment ago. It is ' + saved + '% smaller than the original.';
        cmpTile.querySelector('.cmp-line').setAttribute('aria-label', 'Compare the original with the WebP');
      }).catch(() => {});
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '200px 0px' });
      io.observe(cmpTile);
    } else start();
  }

  /* compress: quality slider */
  const qRange = $('#q-range');
  if (qRange) {
    const qValue = $('#q-value'), qNow = $('#q-now'), qDelta = $('#q-delta'), qSub = $('#q-sub');
    const update = () => {
      const q = Number(qRange.value);
      const out = DATA.quality[q];
      qValue.textContent = String(q);
      if (!out) return;
      qNow.textContent = fmtBytes(out);
      setDelta(qDelta, O.valley, out);
      qSub.textContent = out >= O.valley ? 'Larger, so the original is kept' : '2400 × 1600';
    };
    qRange.addEventListener('input', update);
    update();
  }

  /* pressed-state groups */
  function group(sel, attr, onPick) {
    const el = $(sel);
    if (!el) return;
    const buttons = $$('button', el);
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute(attr, String(x === b)));
      onPick(b);
    }));
    const on = buttons.find((b) => b.getAttribute(attr) === 'true');
    if (on) onPick(on);
  }

  const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };
  group('#fmt-seg', 'aria-pressed', (b) => {
    const f = b.dataset.fmt;
    const out = DATA.formats[f];
    const name = $('#fmt-name');
    name.firstChild.textContent = 'harbour.' + EXT[f];
    $('#fmt-now').textContent = fmtBytes(out);
    setDelta($('#fmt-delta'), O.harbour, out);
  });

  group('#tgt-seg', 'aria-pressed', (b) => {
    const t = DATA.target[b.dataset.tgt];
    $('#tgt-bytes').textContent = fmtBytes(t.bytes);
    $('#tgt-how').textContent = 'hills.jpg at quality ' + t.q + (t.w ? ', resized to ' + t.w + ' × ' + t.h : '');
  });

  group('#presets', 'aria-checked', () => {});

  const NOTES = {
    smooth: 'Even resampling with Lanczos. Good for photos.',
    sharp: 'Magic Kernel Sharp. Crisper edges for photos and text.',
    pixel: 'Every pixel becomes a clean square. Made for pixel art and icons.',
    ai: 'Runs Real-ESRGAN on your device. Its model downloads from this site once, the first time you use it.',
  };
  group('#up-method', 'aria-pressed', (b) => {
    $('#up-note').textContent = NOTES[b.dataset.m];
    const view = $('.up-view');
    view.classList.toggle('is-pixel', b.dataset.m === 'pixel');
    $('#up-cap').textContent = b.dataset.m === 'pixel' ? 'Pixel preview' : 'Smooth preview';
  });
  group('#up-seg', 'aria-pressed', (b) => {
    const f = Number(b.dataset.f);
    $('#up-dims').textContent = '600 × 400 to ' + 600 * f + ' × ' + 400 * f;
  });

  /* upscale preview: a tiny crop of a sample, drawn small and shown large */
  const canvas = $('#up-canvas');
  if (canvas && canvas.getContext) {
    const draw = () => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        // a 360 x 240 region (in the 2400 px original) around the middle ship in the harbour photo, drawn at 90 x 60;
        // the 1200 px copy is plenty for that and a third of the bytes
        ctx.drawImage(img, 1053 / 2, 651 / 2, 180, 120, 0, 0, canvas.width, canvas.height);
      };
      img.src = 'assets/samples/1200/p266.jpg';
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); draw(); } }, { rootMargin: '600px 0px' });
      io.observe(canvas);
    } else draw();
  }
})();
