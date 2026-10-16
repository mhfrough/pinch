/* Pinch studio: the whole tool UI, rendered into <section id="studio">.
   Uses window.Pinch (engine.js) and, for "AI detail", window.PinchAI (ai/ai.js).
   Nothing leaves the device. Owned by the studio agent; styles live in app.css. */
(function () {
  'use strict';

  const root = document.getElementById('studio');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';

  const SCRIPT = document.currentScript;
  const BASE = new URL('.', (SCRIPT && SCRIPT.src) || location.href);
  const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
  const PHONE = matchMedia('(max-width: 819px)');
  const COARSE = matchMedia('(pointer: coarse)');
  const CAN_COPY = !!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem);
  // Sample photos (Unsplash licence, credited in the landing footer)
  const SAMPLES = [
    { file: 'p266.jpg', name: 'Harbour', bytes: 438266 },
    { file: 'p11.jpg', name: 'Valley', bytes: 361245 },
    { file: 'p989.jpg', name: 'Lake', bytes: 299315 },
    { file: 'p353.jpg', name: 'Hills', bytes: 591976 },
  ];
  const IMAGE_EXT = /\.(jpe?g|jfif|pjpeg|png|apng|webp|avif|gif|bmp|ico|cur|svg|heic|heif|tiff?|jxl)$/i;

  // ------------------------------------------------------------------ helpers
  const $ = (sel, el) => (el || root).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || root).querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function merge(a, b) {
    for (const k in b) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = merge(a[k] || {}, b[k]);
      else a[k] = b[k];
    }
    return a;
  }
  function fmtBytes(n) {
    if (!(n >= 0)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';
  }
  const pctOf = (a, b) => (a ? Math.round(((b - a) / a) * 100) : 0);
  const fmtPct = (p) => (p < 0 ? '−' + Math.abs(p) + '%' : p > 0 ? '+' + p + '%' : '0%');
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  const isAbort = (err) => err && (err.name === 'AbortError' || /abort|cancel/i.test(err.message || ''));

  const FORMAT_LABEL = { auto: 'Auto', jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', gif: 'GIF', bmp: 'BMP', ico: 'ICO', svg: 'SVG', heic: 'HEIC', tiff: 'TIFF' };
  const FORMAT_EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', gif: 'gif', bmp: 'bmp', ico: 'ico' };
  const LOSSY = { jpeg: 1, webp: 1, avif: 1 };
  function flabel(k) {
    const F = window.Pinch && window.Pinch.FORMATS;
    return (F && F[k] && F[k].label) || FORMAT_LABEL[k] || (k ? String(k).toUpperCase() : '');
  }
  function outName(name, fmt) {
    if (window.Pinch && window.Pinch.outName) { try { return window.Pinch.outName(name, fmt); } catch (e) { /* fall through */ } }
    return (String(name || 'image').replace(/\.[^.]+$/, '') || 'image') + '.' + (FORMAT_EXT[fmt] || fmt);
  }

  // ------------------------------------------------------------------ icons (20px grid, 1.5px stroke)
  const ICONS = {
    plus: '<path d="M10 4.5v11M4.5 10h11"/>',
    upload: '<path d="M10 12.75V3.75M6.5 7.25 10 3.75l3.5 3.5"/><path d="M3.75 12v2.25c0 1.1.9 2 2 2h8.5c1.1 0 2-.9 2-2V12"/>',
    folder: '<path d="M2.75 6.25c0-1.1.9-2 2-2h2.6c.5 0 .97.22 1.3.6l1 1.15h5.6c1.1 0 2 .9 2 2v5.75c0 1.1-.9 2-2 2H4.75c-1.1 0-2-.9-2-2z"/>',
    download: '<path d="M10 3.75v9M6.5 9.25 10 12.75l3.5-3.5"/><path d="M4 16.25h12"/>',
    archive: '<rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2.75"/><path d="M10 3.25v1.5M10 6.25v1.5M10 9.25v1.5"/><rect x="8.5" y="12" width="3" height="2.25" rx="1"/>',
    copy: '<rect x="7" y="7" width="9.25" height="9.25" rx="2"/><path d="M13 7V5.75c0-1.1-.9-2-2-2H5.75c-1.1 0-2 .9-2 2V11c0 1.1.9 2 2 2H7"/>',
    trash: '<path d="M3.75 5.75h12.5M8 5.75V4.6c0-.6.5-1.1 1.1-1.1h1.8c.6 0 1.1.5 1.1 1.1v1.15M5.25 5.75l.68 9.05a2 2 0 0 0 2 1.85h4.14a2 2 0 0 0 2-1.85l.68-9.05"/>',
    x: '<path d="M5.75 5.75l8.5 8.5M14.25 5.75l-8.5 8.5"/>',
    left: '<path d="M11.75 5.5 7.25 10l4.5 4.5"/>',
    right: '<path d="M8.25 5.5 12.75 10l-4.5 4.5"/>',
    minus: '<path d="M5 10h10"/>',
    zin: '<circle cx="9" cy="9" r="5.25"/><path d="M13 13l3.25 3.25M9 6.9v4.2M6.9 9h4.2"/>',
    zout: '<circle cx="9" cy="9" r="5.25"/><path d="M13 13l3.25 3.25M6.9 9h4.2"/>',
    fit: '<path d="M3.75 7.25v-2c0-.83.67-1.5 1.5-1.5h2M12.75 3.75h2c.83 0 1.5.67 1.5 1.5v2M16.25 12.75v2c0 .83-.67 1.5-1.5 1.5h-2M7.25 16.25h-2c-.83 0-1.5-.67-1.5-1.5v-2"/>',
    keys: '<rect x="2.75" y="5.25" width="14.5" height="9.5" rx="2.25"/><path d="M6 8.5h.5M9 8.5h.5M12 8.5h.5M14 8.5h.25M6.75 11.5h6.5"/>',
    sliders: '<path d="M3.75 6.5h6.5M14.25 6.5h2M3.75 13.5h2M9.75 13.5h6.5"/><circle cx="12.25" cy="6.5" r="1.75"/><circle cx="7.75" cy="13.5" r="1.75"/>',
    check: '<path d="M5.25 10.25 8.4 13.4 14.75 7"/>',
    alert: '<path d="M8.73 3.98 3.3 13.4c-.56.98.14 2.2 1.27 2.2h10.86c1.13 0 1.83-1.22 1.27-2.2L11.27 3.98a1.47 1.47 0 0 0-2.54 0z"/><path d="M10 8v3.1M10 13.4h.01"/>',
    lock: '<rect x="4.5" y="8.75" width="11" height="7.5" rx="2"/><path d="M7 8.75V6.75a3 3 0 0 1 6 0v2"/>',
    link: '<path d="M8.6 11.4l2.8-2.8M7.5 8.9 6.2 10.2a2.4 2.4 0 0 0 3.4 3.4l1.3-1.3M12.5 11.1l1.3-1.3a2.4 2.4 0 0 0-3.4-3.4L9.1 7.7"/>',
    unlink: '<path d="M7.5 8.9 6.2 10.2a2.4 2.4 0 0 0 3.4 3.4l1.3-1.3M12.5 11.1l1.3-1.3a2.4 2.4 0 0 0-3.4-3.4L9.1 7.7M4.5 4.5l1.5 1.5M15.5 15.5 14 14"/>',
    eye: '<path d="M2.75 10s2.6-5 7.25-5 7.25 5 7.25 5-2.6 5-7.25 5-7.25-5-7.25-5z"/><circle cx="10" cy="10" r="2.25"/>',
    spark: '<path d="M10 3.25c.45 3.4 2.35 5.3 5.75 5.75-3.4.45-5.3 2.35-5.75 5.75-.45-3.4-2.35-5.3-5.75-5.75 3.4-.45 5.3-2.35 5.75-5.75z"/><path d="M15.25 13.5v3M13.75 15h3"/>',
    image: '<rect x="3.25" y="4.25" width="13.5" height="11.5" rx="2.25"/><circle cx="7.6" cy="8.1" r="1.2"/><path d="M3.6 13.9l3.5-3.5a1.4 1.4 0 0 1 2 0l3.6 3.6M11.4 12.7l1.1-1.1a1.4 1.4 0 0 1 2 0l1.9 1.9"/>',
    split: '<path d="M7.25 6.75 4 10l3.25 3.25M12.75 6.75 16 10l-3.25 3.25"/>',
  };
  function icon(name, cls) {
    return '<svg class="ps-i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';
  }

  // ------------------------------------------------------------------ settings and presets
  const DEFAULTS = {
    format: 'auto', quality: 80, lossless: false, pngColors: 0,
    resize: { mode: 'none', percent: 50, width: 1920, height: 1080, lock: false },
    upscale: { factor: 1, method: 'sharp' },
    targetOn: false, targetValue: 200, targetUnit: 'KB',
    background: '#ffffff',
  };
  const PRESETS = [
    { id: 'web', label: 'Web', detail: 'WebP at quality 75, fitted inside 2560 px.', set: { format: 'webp', quality: 75, resize: { mode: 'fit', width: 2560, height: 2560 } } },
    { id: 'email', label: 'Email', detail: 'JPG kept under 1 MB, ready to attach.', set: { format: 'jpeg', quality: 85, targetOn: true, targetValue: 1, targetUnit: 'MB' } },
    { id: 'social', label: 'Social', detail: 'JPG at quality 82, fitted inside 1080 × 1350.', set: { format: 'jpeg', quality: 82, resize: { mode: 'fit', width: 1080, height: 1350 } } },
    { id: 'favicon', label: 'Favicon', detail: 'An ICO icon for websites, with small sizes inside.', set: { format: 'ico' } },
    { id: 'lossless', label: 'Lossless', detail: 'PNG with every pixel kept exactly.', set: { format: 'png', pngColors: 0 } },
  ];
  PRESETS.forEach((p) => { p.full = merge(clone(DEFAULTS), p.set); });
  const PRESET = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

  function targetBytes(s) { return Math.round(Number(s.targetValue || 0) * (s.targetUnit === 'MB' ? 1e6 : 1e3)); }
  const hasLossless = (f) => f === 'webp' || f === 'avif';
  const usesQuality = (f) => f === 'auto' || !!LOSSY[f];
  const usesBackground = (f) => f === 'jpeg' || f === 'bmp' || f === 'auto';

  // The settings that change the output, and nothing else. Used for preset matching and job keys.
  function norm(s) {
    const f = s.format;
    const o = { format: f };
    if (hasLossless(f)) o.lossless = !!s.lossless;
    if (usesQuality(f) && !(hasLossless(f) && s.lossless)) o.quality = s.quality;
    if (f === 'png') o.pngColors = s.pngColors;
    if (usesBackground(f)) o.background = String(s.background).toLowerCase();
    const r = s.resize;
    o.resize = r.mode === 'percent' ? { mode: 'percent', percent: r.percent }
      : r.mode === 'fit' ? { mode: 'fit', width: r.width, height: r.height }
        : r.mode === 'width' ? { mode: 'width', width: r.width }
          : r.mode === 'height' ? { mode: 'height', height: r.height } : { mode: 'none' };
    o.upscale = s.upscale.factor > 1 ? { factor: s.upscale.factor, method: s.upscale.method } : { factor: 1 };
    o.target = s.targetOn ? targetBytes(s) : 0;
    return o;
  }
  function engineSettings(s) {
    return {
      format: s.format,
      quality: s.quality,
      lossless: s.format === 'png' ? s.pngColors === 0 : !!s.lossless,
      pngColors: s.format === 'png' ? s.pngColors : 0,
      resize: { mode: s.resize.mode, percent: s.resize.percent, width: s.resize.width, height: s.resize.height },
      upscale: { factor: s.upscale.factor, method: s.upscale.method === 'ai' ? 'sharp' : s.upscale.method },
      target: s.targetOn ? targetBytes(s) : 0,
      background: s.background,
      stripMetadata: true,
    };
  }
  const NORMED_PRESETS = PRESETS.map((p) => [p.id, JSON.stringify(norm(p.full))]);
  function presetOf(s) {
    const n = JSON.stringify(norm(s));
    for (const [id, v] of NORMED_PRESETS) if (v === n) return id;
    return 'custom';
  }

  // ------------------------------------------------------------------ state
  const S = {
    files: [],
    cur: null,
    G: clone(PRESET.web.full),
    lastCustom: null,
    view: { z: 1, x: 0, y: 0, fit: true },
    split: 0.5,
    orig: false,
    aiOK: lsGet('pinch-ai-ok') === '1',
    caps: null,
    aiInfo: null,
    origUrl: null,
    sheetOpen: false,
  };
  let uid = 0;
  let demoReady = false;   // set once the live preview has booted
  const eff = (e) => e.override || S.G;
  const target = () => (S.cur && S.cur.override) || S.G;
  const keyOf = (e) => JSON.stringify(norm(eff(e)));

  // ------------------------------------------------------------------ engine access
  let readyP = null;
  function engine() {
    if (!readyP) {
      readyP = (async () => {
        for (let i = 0; i < 300 && !(window.Pinch && window.Pinch.process && window.Pinch.inspect); i++) await sleep(50);
        const P = window.Pinch;
        if (!P || !P.process || !P.inspect) throw new Error('The image engine did not load. Reload the page to try again.');
        if (P.ready) {
          try { S.caps = (await P.ready) || null; } catch (e) { /* engine reports per file */ }
          syncInspector();
        }
        return P;
      })();
      readyP.catch(() => { readyP = null; });
    }
    return readyP;
  }

  // ------------------------------------------------------------------ markup
  const pasteKeys = IS_MAC ? '<kbd>⌘</kbd><kbd>V</kbd>' : '<kbd>Ctrl</kbd><kbd>V</kbd>';
  const presetChips = (name) => PRESETS.map((p) =>
    '<label class="ps-chip-opt"><input class="vh" type="radio" name="' + name + '" value="' + p.id + '"><span>' + p.label + '</span></label>').join('');
  const seg = (name, label, opts, cls) =>
    '<div class="ps-seg' + (cls ? ' ' + cls : '') + '" role="radiogroup" aria-label="' + label + '">' +
    opts.map(([v, t, extra]) => '<label' + (extra ? ' ' + extra : '') + '><input class="vh" type="radio" name="' + name + '" value="' + v + '"><span>' + t + '</span></label>').join('') + '</div>';

  root.innerHTML = `
<div class="ps" data-view="empty">
  <div class="ps-empty">
    <div class="ps-hero">
      <div class="ps-hero-copy">
        <h1 class="ps-h1">Make images lighter. Keep them private.</h1>
        <p class="ps-lede">Pinch compresses, converts and upscales images right here in your browser. Nothing is uploaded, ever.</p>
        <div class="ps-cta">
          <button type="button" class="btn btn-primary btn-lg ps-open" data-act="open">${icon('upload')}<span>Choose images</span></button>
          <p class="ps-hint"><span class="ps-hint-desk">or drop them anywhere, or paste with ${pasteKeys}</span><span class="ps-hint-touch">JPG, PNG, WebP, AVIF, GIF, BMP and ICO</span></p>
        </div>
        <div class="ps-hero-presets">
          <div class="ps-chips ps-chips-row" role="radiogroup" aria-label="Preset">${presetChips('ps-preset-e')}</div>
          <p class="ps-preset-note" aria-live="polite"></p>
        </div>
        <p class="ps-hero-foot">${icon('lock')}<span>Runs on this device. Once the page has loaded, it works offline.</span></p>
      </div>
      <div class="ps-show">
        <figure class="ps-demo" aria-label="Live preview of the selected preset on a sample photo">
          <img class="ps-demo-a" src="${new URL('assets/samples/' + SAMPLES[1].file, BASE).href}" alt="Sample photo of a valley, original" width="2400" height="1600" draggable="false">
          <div class="ps-demo-b"><img alt="The same photo after the selected preset" draggable="false"></div>
          <div class="ps-split ps-demo-split" role="slider" tabindex="0" aria-label="Compare the sample" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
            <span class="ps-split-line"></span><span class="ps-split-knob">${icon('split')}</span>
          </div>
          <span class="ps-tag ps-tag-a"><span>Original</span><b class="num">${fmtBytes(SAMPLES[1].bytes)}</b></span>
          <span class="ps-tag ps-tag-b ps-demo-tag is-busy"><span class="ps-tag-fmt">WebP</span><b class="num"></b><span class="ps-pct num"></span><i class="ps-spin" aria-hidden="true"></i></span>
        </figure>
        <div class="ps-samples">
          <div class="ps-samples-head">
            <h2>Try a sample</h2>
            <button type="button" class="ps-link" data-act="samples">Open all four</button>
          </div>
          <ul class="ps-sample-grid">
            ${SAMPLES.map((s, i) => `<li><button type="button" class="ps-sample" data-sample="${i}" aria-label="Open sample photo: ${s.name}, ${fmtBytes(s.bytes)}">
              <span class="ps-sample-img"><img src="${new URL('assets/samples/' + s.file, BASE).href}" alt="" width="240" height="160" decoding="async"></span>
              <span class="ps-sample-cap"><span>${s.name}</span><span class="num">${fmtBytes(s.bytes)}</span></span>
            </button></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>
  </div>

  <div class="ps-work" hidden>
    <h1 class="vh">Pinch studio</h1>
    <aside class="ps-files" aria-label="Files">
      <div class="ps-files-head">
        <h2>Files <span class="ps-count num"></span></h2>
        <div class="ps-files-add">
          <button type="button" class="ps-ibtn" data-act="folder" title="Add a folder">${icon('folder')}<span class="vh">Add a folder</span></button>
          <button type="button" class="ps-ibtn" data-act="open" title="Add images (O)">${icon('plus')}<span class="vh">Add images</span></button>
        </div>
      </div>
      <ul class="ps-list" aria-label="Images"></ul>
    </aside>

    <div class="ps-stage">
      <div class="ps-vp" aria-label="Before and after comparison. Drag to pan, scroll or pinch to zoom.">
        <div class="ps-layer ps-layer-a"><div class="ps-world"><img class="ps-img-a" alt="Original" draggable="false"></div></div>
        <div class="ps-layer ps-layer-b"><div class="ps-world"><img class="ps-img-b" alt="Output preview" draggable="false"></div></div>
        <div class="ps-skel" aria-hidden="true"></div>
        <div class="ps-split" role="slider" tabindex="0" aria-label="Compare divider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
          <span class="ps-split-line"></span><span class="ps-split-knob">${icon('split')}</span>
        </div>
        <div class="ps-tag ps-tag-a"><span>Original</span><b class="num"></b></div>
        <div class="ps-tag ps-tag-b"><span class="ps-tag-fmt"></span><b class="num"></b><i class="ps-spin" aria-hidden="true"></i></div>
        <div class="ps-orig-pill" aria-hidden="true">Original</div>
        <div class="ps-stage-msg" hidden>${icon('alert')}<p></p></div>
      </div>
      <div class="ps-tools" role="toolbar" aria-label="View">
        <button type="button" class="ps-tbtn" data-act="zout" title="Zoom out (−)">${icon('zout')}<span class="vh">Zoom out</span></button>
        <button type="button" class="ps-tbtn ps-zoomval num" data-act="ztoggle" title="Switch between fit and 100%">100%</button>
        <button type="button" class="ps-tbtn" data-act="zin" title="Zoom in (+)">${icon('zin')}<span class="vh">Zoom in</span></button>
        <span class="ps-tsep" aria-hidden="true"></span>
        <button type="button" class="ps-tbtn ps-ttext" data-act="fit" title="Fit (F)">Fit</button>
        <button type="button" class="ps-tbtn ps-ttext num" data-act="actual" title="Actual size (1)">1:1</button>
        <span class="ps-tsep" aria-hidden="true"></span>
        <button type="button" class="ps-tbtn" data-act="hold" aria-pressed="false" title="Hold to see the original (Space)">${icon('eye')}<span class="vh">Show original</span></button>
        <button type="button" class="ps-tbtn ps-keys-btn" data-act="keys" title="Keyboard shortcuts (?)">${icon('keys')}<span class="vh">Keyboard shortcuts</span></button>
      </div>
    </div>

    <aside class="ps-insp" aria-label="Settings">
      <button type="button" class="ps-grab" aria-expanded="false" aria-controls="ps-body"><span class="ps-grab-bar" aria-hidden="true"></span><span class="vh">Show settings</span></button>
      <div class="ps-res" data-state="idle">
        <div class="ps-res-l1"><span class="ps-res-fmt"></span><span class="ps-res-dim num"></span></div>
        <div class="ps-res-l2"><span class="ps-res-size num"></span><span class="ps-pct ps-res-pct num"></span></div>
        <div class="ps-res-l3 num"></div>
        <div class="ps-res-prog" aria-hidden="true"><i></i></div>
        <button type="button" class="btn btn-quiet ps-res-cancel" data-act="cancel" hidden>${icon('x')}<span>Cancel</span></button>
      </div>
      <div class="ps-warn" hidden>${icon('alert')}<p></p></div>
      <div class="ps-body" id="ps-body">
        <section class="ps-grp ps-scope" aria-labelledby="ps-h-scope">
          <h3 id="ps-h-scope">Apply changes to</h3>
          ${seg('ps-scope', 'Apply changes to', [['all', 'All files'], ['file', 'This file only']], 'ps-seg-2')}
          <p class="ps-help ps-scope-help"></p>
        </section>
        <section class="ps-grp" aria-labelledby="ps-h-preset">
          <h3 id="ps-h-preset">Preset</h3>
          <div class="ps-chips ps-chips-grid" role="radiogroup" aria-labelledby="ps-h-preset">${presetChips('ps-preset')}<label class="ps-chip-opt"><input class="vh" type="radio" name="ps-preset" value="custom"><span>Custom</span></label></div>
          <p class="ps-help ps-preset-help"></p>
        </section>
        <section class="ps-grp" aria-labelledby="ps-h-format">
          <h3 id="ps-h-format">Format</h3>
          ${seg('ps-fmt', 'Format', ['auto', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'ico'].map((f) => [f, FORMAT_LABEL[f]]), 'ps-seg-4')}
          <div class="ps-field ps-f-quality">
            <div class="ps-field-head"><label for="ps-q">Quality</label><output class="num" for="ps-q"></output></div>
            <input type="range" id="ps-q" class="ps-range" min="1" max="100" step="1">
          </div>
          <label class="ps-switch ps-f-lossless"><span>Lossless</span><input type="checkbox" role="switch" id="ps-ll"><i aria-hidden="true"></i></label>
          <div class="ps-field ps-f-colors">
            <div class="ps-field-head"><span id="ps-h-colors">Colours</span></div>
            ${seg('ps-colors', 'PNG colours', [['0', 'All'], ['256', '256'], ['128', '128'], ['64', '64'], ['32', '32'], ['16', '16']], 'ps-seg-6')}
          </div>
          <div class="ps-field ps-f-bg ps-inline">
            <label for="ps-bg-hex">Background</label>
            <span class="ps-color"><span class="ps-swatch"><input type="color" id="ps-bg" aria-label="Background colour"></span><input type="text" id="ps-bg-hex" class="ps-input ps-hex num" maxlength="7" spellcheck="false" autocomplete="off"></span>
          </div>
          <p class="ps-help ps-fmt-help"></p>
        </section>
        <section class="ps-grp" aria-labelledby="ps-h-size">
          <h3 id="ps-h-size">Size</h3>
          <div class="ps-field ps-inline">
            <label for="ps-rmode">Resize</label>
            <span class="ps-select"><select id="ps-rmode">
              <option value="none">Keep size</option><option value="percent">By percent</option><option value="fit">Fit inside a box</option><option value="width">Set width</option><option value="height">Set height</option>
            </select></span>
          </div>
          <div class="ps-dims">
            <label class="ps-num ps-d-pct"><span class="vh">Percent</span><input type="number" id="ps-pct" class="ps-input num" min="1" max="400" inputmode="numeric"><span class="ps-unit">%</span></label>
            <label class="ps-num ps-d-w"><span class="ps-num-l">W</span><input type="number" id="ps-w" class="ps-input num" min="1" max="20000" inputmode="numeric" aria-label="Width in pixels"><span class="ps-unit">px</span></label>
            <button type="button" class="ps-ibtn ps-lock" aria-pressed="false" title="Keep the box in this image's proportions">${icon('unlink', 'ps-i-off')}${icon('link', 'ps-i-on')}<span class="vh">Lock aspect ratio</span></button>
            <label class="ps-num ps-d-h"><span class="ps-num-l">H</span><input type="number" id="ps-h" class="ps-input num" min="1" max="20000" inputmode="numeric" aria-label="Height in pixels"><span class="ps-unit">px</span></label>
            <p class="ps-help ps-dims-help num"></p>
          </div>
          <div class="ps-field">
            <div class="ps-field-head"><span>Upscale</span></div>
            ${seg('ps-up', 'Upscale', [['1', '1×'], ['2', '2×'], ['3', '3×'], ['4', '4×']], 'ps-seg-4 num')}
          </div>
          <div class="ps-field ps-f-method">
            <div class="ps-field-head"><span>Method</span></div>
            ${seg('ps-method', 'Upscale method', [['smooth', 'Smooth'], ['sharp', 'Sharp'], ['pixel', 'Pixel art'], ['ai', icon('spark') + 'AI detail']], 'ps-seg-2x2')}
          </div>
          <div class="ps-ai" hidden>
            <p class="ps-ai-text"></p>
            <button type="button" class="btn btn-ink ps-ai-go" hidden>${icon('download')}<span>Download model</span></button>
          </div>
        </section>
        <section class="ps-grp" aria-labelledby="ps-h-target">
          <h3 id="ps-h-target">Target size</h3>
          <label class="ps-switch"><span>Keep each file under a size</span><input type="checkbox" role="switch" id="ps-t-on"><i aria-hidden="true"></i></label>
          <div class="ps-target">
            <label class="ps-num"><span class="vh">Target size</span><input type="number" id="ps-t-val" class="ps-input num" min="1" max="100000" step="any" inputmode="decimal"></label>
            ${seg('ps-t-unit', 'Unit', [['KB', 'KB'], ['MB', 'MB']], 'ps-seg-2')}
          </div>
        </section>
      </div>
    </aside>

    <div class="ps-bar">
      <div class="ps-totals" aria-live="polite">
        <span class="ps-tot-n num"></span>
        <span class="ps-tot-b num"></span>
        <span class="ps-pct ps-tot-pct num"></span>
        <span class="ps-tot-busy"><i class="ps-spin" aria-hidden="true"></i><span></span></span>
      </div>
      <div class="ps-actions">
        <button type="button" class="btn btn-ghost ps-a-clear" data-act="clear" title="Remove all files">${icon('trash')}<span>Clear</span></button>
        <button type="button" class="btn btn-quiet ps-a-copy" data-act="copy" title="Copy to clipboard"${CAN_COPY ? '' : ' hidden'}>${icon('copy')}<span>Copy</span></button>
        <button type="button" class="btn btn-quiet ps-a-save" data-act="save" title="Save this image (S)">${icon('download')}<span>Save</span></button>
        <button type="button" class="btn btn-primary ps-a-all" data-act="saveall" title="Save all as a ZIP (Shift S)">${icon('archive')}<span>Save all</span></button>
      </div>
    </div>
  </div>

  <div class="ps-drop" hidden aria-hidden="true">
    <div class="ps-drop-card">${icon('upload')}<p><b>Drop to add images</b><span>They stay on this device.</span></p></div>
  </div>

  <dialog class="ps-sheet" aria-labelledby="ps-keys-title">
    <div class="ps-sheet-head"><h2 id="ps-keys-title">Keyboard shortcuts</h2><button type="button" class="ps-ibtn" data-act="closekeys">${icon('x')}<span class="vh">Close</span></button></div>
    <dl class="ps-keylist">
      ${[
    ['Open images', '<kbd>O</kbd>'],
    ['Save this image', '<kbd>S</kbd>'],
    ['Save all as ZIP', '<kbd>Shift</kbd><kbd>S</kbd>'],
    ['Previous or next file', '<kbd>[</kbd><kbd>]</kbd>'],
    ['Show the original', 'Hold <kbd>Space</kbd>'],
    ['Fit to view', '<kbd>F</kbd>'],
    ['Actual size', '<kbd>1</kbd>'],
    ['Zoom in or out', '<kbd>+</kbd><kbd>−</kbd>'],
    ['Move the divider', '<kbd>←</kbd><kbd>→</kbd>'],
    ['Remove this file', '<kbd>Delete</kbd>'],
    ['Paste an image', pasteKeys],
    ['Show this list', '<kbd>?</kbd>'],
  ].map(([a, k]) => '<div><dt>' + a + '</dt><dd>' + k + '</dd></div>').join('')}
    </dl>
  </dialog>

  <div class="ps-toast" role="status" aria-live="polite"><span class="ps-toast-ic"></span><span class="ps-toast-t"></span></div>
  <p class="vh ps-status" role="status" aria-live="polite"></p>
  <input type="file" class="ps-pick" multiple accept="image/*,.heic,.heif,.avif,.ico,.svg,.jxl" hidden>
  <input type="file" class="ps-pick-dir" webkitdirectory multiple hidden>
</div>`;

  const ps = $('.ps');
  const el = {
    work: $('.ps-work'), empty: $('.ps-empty'), hero: $('.ps-hero'), list: $('.ps-list'), count: $('.ps-count'),
    stage: $('.ps-stage'), vp: $('.ps-vp'), worlds: $$('.ps-world'), imgA: $('.ps-img-a'), imgB: $('.ps-img-b'),
    split: $('.ps-vp .ps-split'), tagA: $('.ps-vp .ps-tag-a b'), tagBf: $('.ps-vp .ps-tag-fmt'), tagB: $('.ps-vp .ps-tag-b b'), tagBox: $('.ps-vp .ps-tag-b'),
    skel: $('.ps-skel'), msg: $('.ps-stage-msg'), zoomval: $('.ps-zoomval'), hold: $('[data-act="hold"]'),
    insp: $('.ps-insp'), grab: $('.ps-grab'), body: $('.ps-body'), res: $('.ps-res'), warn: $('.ps-warn'),
    pick: $('.ps-pick'), pickDir: $('.ps-pick-dir'), drop: $('.ps-drop'), sheet: $('.ps-sheet'),
    toast: $('.ps-toast'), status: $('.ps-status'), presetNote: $('.ps-preset-note'),
  };

  // ------------------------------------------------------------------ view switching
  function setView(v) {
    if (ps.dataset.view === v) return;
    ps.dataset.view = v;
    el.empty.hidden = v !== 'empty';
    el.work.hidden = v !== 'work';
    if (v === 'work') { demoStop(); requestAnimationFrame(() => { fitView(); applyView(); }); syncSheet(); }
    else if (demoReady) { demo.key = null; demoSchedule(120); }
  }

  function announce(t) { el.status.textContent = ''; setTimeout(() => { el.status.textContent = t; }, 30); }
  let toastT = 0;
  function toast(text, kind) {
    el.toast.querySelector('.ps-toast-ic').innerHTML = icon(kind === 'bad' ? 'alert' : 'check');
    el.toast.querySelector('.ps-toast-t').textContent = text;
    el.toast.dataset.kind = kind || 'good';
    el.toast.classList.remove('is-on'); void el.toast.offsetWidth; el.toast.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.toast.classList.remove('is-on'), 2600);
  }

  // ------------------------------------------------------------------ adding files
  function looksImage(f) { return /^image\//.test(f.type) || IMAGE_EXT.test(f.name || ''); }

  function makeRow(e) {
    const li = document.createElement('li');
    li.className = 'ps-row';
    li.dataset.id = e.id;
    li.dataset.status = 'reading';
    li.innerHTML = `
      <button type="button" class="ps-row-main" aria-label="${esc(e.name)}">
        <span class="ps-thumb"><img alt="" draggable="false"></span>
        <span class="ps-row-text">
          <span class="ps-row-name"><span class="ps-row-n">${esc(e.name)}</span><span class="ps-ovr" title="Has its own settings">${icon('sliders')}<span class="vh">Own settings</span></span></span>
          <span class="ps-row-size num"><span class="ps-b0"></span><span class="ps-arrow" aria-hidden="true">→</span><span class="ps-b1"></span></span>
        </span>
        <span class="ps-pct ps-row-pct num"></span>
        <i class="ps-spin ps-row-spin" aria-hidden="true"></i>
      </button>
      <span class="ps-row-meta"></span>
      <button type="button" class="ps-row-x" title="Remove (Delete)">${icon('x')}<span class="vh">Remove ${esc(e.name)}</span></button>
      <span class="ps-row-prog" aria-hidden="true"><i></i></span>`;
    li.addEventListener('click', (ev) => {
      if (ev.target.closest('.ps-row-x')) { remove(e); return; }
      const hint = ev.target.closest('.ps-hint-btn');
      if (hint) { applyHint(e, hint.dataset.fmt); return; }
      select(e);
    });
    return li;
  }

  function addFiles(list, fromFolder) {
    const files = Array.from(list || []).filter((f) => f && (!fromFolder || looksImage(f)));
    if (!files.length) {
      if (fromFolder) toast('No images found in that folder', 'bad');
      return [];
    }
    const added = files.map((file) => {
      const e = {
        id: 'f' + (++uid), file, name: file.name || 'pasted-image.png', bytes: file.size,
        status: 'reading', info: null, thumbUrl: null, result: null, error: null, override: null,
        job: null, doneKey: null, waitKey: null, progress: 0, plabel: '', cmp: null, cmpKey: null, ai: null,
      };
      e.row = makeRow(e);
      S.files.push(e);
      el.list.appendChild(e.row);
      return e;
    });
    const wasEmpty = !S.cur;
    setView('work');
    if (wasEmpty) select(added[0]);
    renderCount();
    renderTotals();
    syncInspector();
    announce(added.length === 1 ? 'Added ' + added[0].name : 'Added ' + added.length + ' images');
    try { window.dispatchEvent(new CustomEvent('pinch:files', { detail: { count: added.length } })); } catch (err) { /* old browsers */ }
    added.forEach((e) => {
      if (!looksImage(e.file)) {
        fail(e, 'Pinch can\'t open this kind of file. Use JPG, PNG, WebP, AVIF, GIF, BMP, ICO or SVG.');
        return;
      }
      inspect(e);
    });
    return added;
  }

  async function inspect(e) {
    try {
      const P = await engine();
      const info = await P.inspect(e.file);
      if (e.removed) { if (info && info.thumbUrl) URL.revokeObjectURL(info.thumbUrl); return; }
      e.info = info || {};
      e.thumbUrl = e.info.thumbUrl || null;
      e.status = 'queued';
      renderRow(e);
      if (S.cur === e) { showStage(); syncInspector(); }
      schedule(0);
    } catch (err) {
      if (!e.removed) fail(e, (err && err.message) || 'Pinch could not read this image. Try saving it again from another app.');
    }
  }

  function fail(e, message) {
    e.status = 'error';
    e.error = message;
    renderRow(e);
    renderTotals();
    if (S.cur === e) { showStage(); renderResult(); }
  }

  // ------------------------------------------------------------------ the work queue
  const MAX_JOBS = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  let running = 0;
  let pumpT = 0;
  let comparing = false;

  function needs(e) {
    if (!e.info || e.status === 'error' || e.removed || e.job) return false;
    const k = keyOf(e);
    return e.doneKey !== k && e.waitKey !== k;
  }
  function schedule(delay) {
    clearTimeout(pumpT);
    pumpT = setTimeout(pump, delay == null ? 160 : delay);
  }
  function pump() {
    while (running < MAX_JOBS) {
      const e = (S.cur && needs(S.cur)) ? S.cur : S.files.find(needs);
      if (!e) break;
      run(e);
    }
    renderTotals();
    if (running === 0) idle();
  }

  function invalidate(list) {
    list.forEach((e) => {
      if (e.job && e.job.key !== keyOf(e)) {
        e.job.ctrl.abort();
        try { if (window.Pinch && window.Pinch.cancel) window.Pinch.cancel(e.file); } catch (err) { /* ignore */ }
        e.job = null;
      }
      if (e.info && e.status !== 'error') renderRow(e);
    });
    renderTotals();
    schedule();
  }

  function progress(e, p, label) {
    let f = typeof p === 'number' ? p : p && (p.fraction != null ? p.fraction : p.progress != null ? p.progress : p.value);
    // a single encode reports no inner progress, so show an indeterminate bar instead of a frozen one
    const indet = !!(p && typeof p === 'object' && (p.stage === 'encode' || p.stage === 'compare') && !(f > 0 && f < 1));
    e.row.classList.toggle('is-indet', indet);
    if (S.cur === e) el.res.classList.toggle('is-indet', indet);
    if (typeof f !== 'number' || !isFinite(f)) { if (p && p.message) { e.plabel = String(p.message); if (S.cur === e) renderResultStatus(); renderRowMeta(e); } return; }
    if (f > 1) f /= 100;
    e.progress = clamp(f, 0, 1);
    if (label) e.plabel = String(label);
    else if (p && typeof p === 'object' && (p.label || p.message)) e.plabel = String(p.label || p.message);
    e.row.style.setProperty('--p', e.progress.toFixed(3));
    if (S.cur === e) { el.res.style.setProperty('--p', e.progress.toFixed(3)); renderResultStatus(); }
    renderRowMeta(e);
  }
  function renderRowMeta(e) {
    if (!e.job || !e.row) return;
    const meta = e.row.querySelector('.ps-row-meta');
    const t = e.plabel || 'Encoding\u2026';
    if (meta.textContent !== t) meta.innerHTML = '<span>' + esc(t) + '</span>';
  }

  async function run(e) {
    const key = keyOf(e);
    const s = clone(eff(e));
    const ctrl = new AbortController();
    e.job = { key, ctrl };
    running++;
    e.status = 'working';
    e.cancelled = false;
    e.progress = 0; e.plabel = '';
    e.row.style.setProperty('--p', '0');
    e.row.classList.remove('is-indet');
    if (S.cur === e) el.res.classList.remove('is-indet');
    renderRow(e);
    if (S.cur === e) renderResult();
    try {
      const P = await engine();
      let src = e.file;
      const es = engineSettings(s);
      if (s.upscale.factor > 1 && s.upscale.method === 'ai') {
        if (!S.aiOK || !window.PinchAI) {
          e.waitKey = key;
          e.status = e.result ? 'done' : 'wait';
          return;
        }
        e.job.ai = true;
        if (S.cur === e) renderResult();
        src = await aiUpscale(e, s.upscale.factor, ctrl.signal);
        e.job.ai = false;
        es.upscale = { factor: 1, method: 'smooth' };
      }
      if (ctrl.signal.aborted) return;
      const t0 = performance.now();
      const r = await P.process(src, es, { signal: ctrl.signal, onProgress: (p, l) => { if (!ctrl.signal.aborted) progress(e, p, l); } });
      if (ctrl.signal.aborted || e.removed || !r) return;
      setResult(e, r, key, performance.now() - t0);
    } catch (err) {
      if (ctrl.signal.aborted || e.removed || isAbort(err)) return;
      e.status = 'failed';
      e.error = (err && err.code === 'too-large')
        ? (err.message || 'This image is too large for AI detail at this scale. Try 2\u00d7, or make it smaller first.')
        : (err && err.message) || 'These settings did not work for this image. Try another format.';
      e.doneKey = key;
      if (S.cur === e) { renderResult(); showOutput(); }
    } finally {
      running--;
      if (e.job && e.job.ctrl === ctrl) e.job = null;
      if (!e.removed) renderRow(e);
      if (S.cur === e) renderResult();
      schedule(0);
    }
  }

  function setResult(e, r, key, ms) {
    const old = e.result;
    const blob = r.blob || e.file;
    const kept = !!r.kept || blob === e.file;
    // Our own URL: the engine revokes the one it hands back when the same file is processed again.
    const url = URL.createObjectURL(blob);
    e.result = {
      blob, url, kept,
      width: r.width || (e.info && e.info.width) || 0,
      height: r.height || (e.info && e.info.height) || 0,
      format: r.format || (kept ? e.info.format : eff(e).format),
      bytes: r.bytes != null ? r.bytes : blob.size,
      quality: r.quality, notes: Array.isArray(r.notes) ? r.notes : [], ms: r.ms != null ? r.ms : ms,
    };
    e.doneKey = key;
    e.waitKey = null;
    e.status = 'done';
    e.error = null;
    if (S.cur === e) { showOutput(); renderResult(); announceResult(e); }
    // Revoke after the new image has had a frame to take over, so the stage never flashes.
    if (old && old.url && old.url !== url) setTimeout(() => URL.revokeObjectURL(old.url), 1500);
    renderRow(e);
    renderTotals();
  }

  let annT = 0;
  function announceResult(e) {
    clearTimeout(annT);
    annT = setTimeout(() => {
      const r = e.result;
      if (!r || S.cur !== e) return;
      announce(r.kept ? 'Original kept for ' + e.name : flabel(r.format) + ', ' + fmtBytes(r.bytes) + ', ' + fmtPct(pctOf(e.bytes, r.bytes)).replace('−', 'minus '));
    }, 700);
  }

  async function aiUpscale(e, factor, signal) {
    if (e.ai && e.ai.factor === factor) return e.ai.file;
    const blob = await window.PinchAI.upscale(e.file, {
      scale: factor, signal,
      onProgress: (f, label) => progress(e, typeof f === 'number' ? f * 0.85 : f, label),
    });
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const file = new File([blob], String(e.name).replace(/\.[^.]+$/, '') + '.png', { type: blob.type || 'image/png' });
    e.ai = { factor, file };
    lsSet('pinch-ai-ok', '1');
    return file;
  }

  // Smallest format hint: runs only while nothing else is working.
  async function idle() {
    if (comparing || !(window.Pinch && window.Pinch.compare)) return;
    const pick = (e) => e.status === 'done' && e.result && !e.removed && eff(e).format !== 'ico' && eff(e).upscale.method !== 'ai' && e.cmpKey !== keyOf(e);
    const e = (S.cur && pick(S.cur)) ? S.cur : S.files.find(pick);
    if (!e) return;
    comparing = true;
    const key = keyOf(e);
    try {
      const c = await window.Pinch.compare(e.file, engineSettings(eff(e)));
      if (!e.removed && keyOf(e) === key) { e.cmp = c; e.cmpKey = key; renderRow(e); }
      else e.cmpKey = null;
    } catch (err) {
      e.cmp = null; e.cmpKey = key;
    } finally {
      comparing = false;
      if (running === 0) setTimeout(() => { if (running === 0) idle(); }, 60);
    }
  }

  function hintOf(e) {
    const r = e.result;
    if (!e.cmp || !r || e.cmpKey !== keyOf(e)) return null;
    let best = null;
    ['avif', 'webp', 'jpeg', 'png'].forEach((k) => {
      const v = e.cmp[k];
      if (!v || v.error || !(v.bytes > 0)) return;
      if (k === 'jpeg' && e.info && e.info.alpha) return;
      if (!best || v.bytes < best.bytes) best = { k, bytes: v.bytes };
    });
    if (!best) return null;
    const curFmt = r.format;
    if (best.k === curFmt || best.bytes >= r.bytes * 0.95) return { ok: true, text: flabel(curFmt) + ' is the smallest here' };
    return { fmt: best.k, text: flabel(best.k) + ' would be ' + Math.round((1 - best.bytes / r.bytes) * 100) + '% smaller' };
  }

  function applyHint(e, fmt) {
    if (!fmt) return;
    if (S.cur !== e) select(e);
    if (!e.override) e.override = clone(S.G);
    e.override.format = fmt;
    afterEdit([e]);
    toast(flabel(fmt) + ' set for this file');
  }

  // ------------------------------------------------------------------ rendering: rows, totals
  function renderCount() { el.count.textContent = S.files.length ? String(S.files.length) : ''; }

  function renderRow(e) {
    const li = e.row;
    if (!li) return;
    const stale = e.result && e.doneKey !== keyOf(e);
    const st = e.status === 'error' ? 'error' : e.job ? 'working' : e.status === 'failed' && !stale ? 'failed' : e.result ? 'done' : e.status;
    li.dataset.status = st;
    li.classList.toggle('is-stale', !!stale || !!e.job);
    li.classList.toggle('has-ovr', !!e.override);
    li.setAttribute('aria-busy', e.job ? 'true' : 'false');
    const img = li.querySelector('.ps-thumb img');
    if (e.thumbUrl && img.getAttribute('src') !== e.thumbUrl) { img.src = e.thumbUrl; img.onload = () => li.classList.add('has-thumb'); }
    li.querySelector('.ps-b0').textContent = fmtBytes(e.bytes);
    const r = e.result;
    const b1 = li.querySelector('.ps-b1');
    const pctEl = li.querySelector('.ps-row-pct');
    const meta = li.querySelector('.ps-row-meta');
    let outBytes = r ? (r.kept ? e.bytes : r.bytes) : null;
    b1.textContent = outBytes != null ? fmtBytes(outBytes) : '';
    if (r) {
      const p = r.kept ? 0 : pctOf(e.bytes, r.bytes);
      pctEl.textContent = r.kept ? 'Kept' : fmtPct(p);
      pctEl.dataset.tone = r.kept || p > 0 ? 'warn' : p < 0 ? 'good' : 'flat';
    } else if (st === 'error' || st === 'failed') {
      pctEl.textContent = 'Error'; pctEl.dataset.tone = 'bad';
    } else { pctEl.textContent = ''; pctEl.dataset.tone = ''; }
    // third line: status, error with its fix, or the smallest-format hint
    let html = '';
    if (st === 'error' || (e.status === 'failed' && !e.job)) html = '<span class="ps-meta-bad">' + esc(e.error || 'Something went wrong.') + '</span>';
    else if (st === 'reading') html = '<span>Reading…</span>';
    else if (e.job) html = '<span>' + (e.plabel ? esc(e.plabel) : 'Encoding…') + '</span>';
    else if (st === 'queued') html = '<span>Waiting…</span>';
    else if (e.cancelled && e.waitKey === keyOf(e)) html = '<span>Cancelled</span>';
    else if (st === 'wait' || (e.waitKey && e.waitKey === keyOf(e))) html = '<span>Waiting for the AI model</span>';
    else if (r && r.kept) html = '<span class="ps-meta-warn">Larger with these settings, original kept</span>';
    else if (r) {
      const h = hintOf(e);
      if (h && h.fmt) html = '<button type="button" class="ps-hint-btn" data-fmt="' + h.fmt + '" title="Use ' + flabel(h.fmt) + ' for this file">' + icon('spark') + '<span>' + esc(h.text) + '</span></button>';
      else if (h && h.ok) html = '<span class="ps-meta-ok">' + icon('check') + esc(h.text) + '</span>';
      else html = '<span>' + esc(flabel(r.format)) + (r.width ? ' · ' + r.width + ' × ' + r.height : '') + '</span>';
    }
    if (meta.innerHTML !== html) meta.innerHTML = html;
    li.querySelector('.ps-row-main').setAttribute('aria-label', e.name + (outBytes != null ? ', ' + fmtBytes(e.bytes) + ' to ' + fmtBytes(outBytes) : '') + (e.override ? ', own settings' : ''));
  }

  function renderTotals() {
    const ok = S.files.filter((e) => e.status !== 'error');
    let before = 0, after = 0, done = 0;
    ok.forEach((e) => {
      before += e.bytes;
      if (e.result) { after += e.result.kept ? e.bytes : e.result.bytes; done++; } else after += e.bytes;
    });
    const busy = S.files.filter((e) => e.job || needs(e) || e.status === 'reading').length;
    $('.ps-tot-n').textContent = S.files.length === 1 ? '1 file' : S.files.length + ' files';
    $('.ps-tot-b').innerHTML = done ? fmtBytes(before) + ' <span aria-hidden="true">→</span><span class="vh">to</span> ' + fmtBytes(after) : fmtBytes(before);
    const pe = $('.ps-tot-pct');
    if (done) { const p = pctOf(before, after); pe.textContent = p < 0 ? Math.abs(p) + '% smaller' : p > 0 ? p + '% larger' : 'Same size'; pe.dataset.tone = p < 0 ? 'good' : p > 0 ? 'warn' : 'flat'; }
    else { pe.textContent = ''; pe.dataset.tone = ''; }
    const bz = $('.ps-tot-busy');
    bz.classList.toggle('is-on', busy > 0);
    bz.querySelector('span').textContent = busy ? 'Working on ' + busy : '';
    const cur = S.cur;
    const canSave = !!(cur && cur.result);
    $('.ps-a-save').disabled = !canSave;
    $('.ps-a-copy').disabled = !canSave;
    $('.ps-a-all').disabled = !ok.some((e) => e.result);
  }

  // ------------------------------------------------------------------ rendering: inspector result
  function renderResult() {
    const e = S.cur;
    const box = el.res;
    const r = e && e.result;
    const stale = r && e.doneKey !== keyOf(e);
    box.dataset.state = !e ? 'idle' : e.status === 'error' ? 'error' : e.job ? 'working' : r ? 'done' : (e.status === 'failed' ? 'error' : 'working');
    box.classList.toggle('is-stale', !!(stale || (e && e.job)));
    const fmtEl = $('.ps-res-fmt', box), dimEl = $('.ps-res-dim', box), sizeEl = $('.ps-res-size', box), pctEl = $('.ps-res-pct', box), l3 = $('.ps-res-l3', box);
    if (!e) { fmtEl.textContent = ''; dimEl.textContent = ''; sizeEl.textContent = ''; pctEl.textContent = ''; l3.textContent = ''; return; }
    if (r) {
      fmtEl.textContent = r.kept ? 'Original kept' : flabel(r.format) + (r.quality && LOSSY[r.format] ? ' · quality ' + r.quality : '');
      dimEl.textContent = r.width ? r.width + ' × ' + r.height : '';
      sizeEl.textContent = fmtBytes(r.kept ? e.bytes : r.bytes);
      const p = r.kept ? 0 : pctOf(e.bytes, r.bytes);
      pctEl.textContent = r.kept ? 'Kept' : fmtPct(p);
      pctEl.dataset.tone = r.kept || p > 0 ? 'warn' : p < 0 ? 'good' : 'flat';
    } else {
      fmtEl.textContent = e.status === 'error' ? 'Can’t open this file' : flabel(eff(e).format === 'auto' ? '' : eff(e).format) || 'Output';
      dimEl.textContent = e.info && e.info.width ? e.info.width + ' × ' + e.info.height : '';
      sizeEl.textContent = e.status === 'error' || e.status === 'failed' ? '' : '';
      pctEl.textContent = ''; pctEl.dataset.tone = '';
    }
    renderResultStatus();
    el.tagBox.classList.toggle('is-busy', !!e.job || (!r && e.status !== 'error' && e.status !== 'failed'));
    $('.ps-res-cancel').hidden = !(e.job && e.job.ai);
    // warnings and notes
    const w = el.warn;
    let warn = '', tone = 'warn';
    if (e.status === 'error' || (e.status === 'failed' && !e.job)) { warn = e.error; tone = 'bad'; }
    else if (r && r.kept) warn = 'These settings made the file larger, so the original is kept. Try a lower quality or another format.';
    else if (r && r.bytes > e.bytes) warn = 'This ' + flabel(r.format) + ' is ' + pctOf(e.bytes, r.bytes) + '% larger than the original. Try a lower quality or another format.';
    else if (e.cancelled && e.waitKey === keyOf(e)) { warn = 'Cancelled. Press Upscale again below, or change a setting.'; tone = 'info'; }
    else if (e.waitKey && e.waitKey === keyOf(e)) { warn = 'Download the AI model below to see this result.'; tone = 'info'; }
    else if (r && r.notes && r.notes.length) { warn = r.notes.join(' '); tone = 'info'; }
    w.hidden = !warn;
    w.dataset.tone = tone;
    $('p', w).textContent = warn || '';
  }
  function renderResultStatus() {
    const e = S.cur;
    const l3 = $('.ps-res-l3', el.res);
    if (!e) return;
    const r = e.result;
    let t = '';
    if (e.job) t = e.plabel ? e.plabel : 'Encoding…';
    else if (e.status === 'reading' || (!r && !e.info && e.status !== 'error')) t = 'Reading…';
    else if (r) t = 'from ' + fmtBytes(e.bytes) + (r.ms ? ' · ' + (r.ms < 1000 ? Math.max(1, Math.round(r.ms)) + ' ms' : (r.ms / 1000).toFixed(1) + ' s') : '');
    else if (e.status === 'error' || e.status === 'failed') t = fmtBytes(e.bytes);
    else t = 'Waiting…';
    l3.textContent = t;
  }

  // ------------------------------------------------------------------ selection and removal
  function select(e) {
    if (!e) return;
    const changed = S.cur !== e;
    S.cur = e;
    S.files.forEach((f) => f.row.classList.toggle('is-cur', f === e));
    S.files.forEach((f) => f.row.querySelector('.ps-row-main').setAttribute('aria-current', f === e ? 'true' : 'false'));
    if (changed) { S.view.fit = true; showStage(); }
    syncInspector();
    renderResult();
    renderTotals();
    revealRow(e);
    if (needs(e)) schedule(0);
  }
  function revealRow(e) {
    const list = el.list, row = e.row;
    if (!row || !list.isConnected) return;
    const horiz = list.scrollWidth > list.clientWidth + 2 && PHONE.matches;
    if (horiz) {
      const l = row.offsetLeft - list.offsetLeft, r = l + row.offsetWidth;
      if (l < list.scrollLeft) list.scrollTo({ left: l - 8, behavior: 'smooth' });
      else if (r > list.scrollLeft + list.clientWidth) list.scrollTo({ left: r - list.clientWidth + 8, behavior: 'smooth' });
    } else {
      const t = row.offsetTop - list.offsetTop, b = t + row.offsetHeight;
      if (t < list.scrollTop) list.scrollTo({ top: t - 6, behavior: 'smooth' });
      else if (b > list.scrollTop + list.clientHeight) list.scrollTo({ top: b - list.clientHeight + 6, behavior: 'smooth' });
    }
  }
  function step(d) {
    if (!S.files.length) return;
    const i = S.files.indexOf(S.cur);
    const n = S.files[clamp(i + d, 0, S.files.length - 1)];
    if (n && n !== S.cur) select(n);
  }

  function release(e) {
    e.removed = true;
    if (e.job) { e.job.ctrl.abort(); e.job = null; }
    try {
      const P = window.Pinch;
      if (P && P.release) P.release(e.file); else if (P && P.cancel) P.cancel(e.file);
      if (P && P.release && e.ai) P.release(e.ai.file);
    } catch (err) { /* ignore */ }
    if (e.thumbUrl && /^blob:/.test(e.thumbUrl)) URL.revokeObjectURL(e.thumbUrl);
    if (e.result && e.result.url) URL.revokeObjectURL(e.result.url);
    e.result = null; e.ai = null; e.cmp = null;
    e.row.remove();
  }
  function remove(e) {
    if (!e) return;
    const i = S.files.indexOf(e);
    if (i < 0) return;
    const hadFocus = root.contains(document.activeElement) && e.row.contains(document.activeElement);
    release(e);
    S.files.splice(i, 1);
    renderCount();
    if (!S.files.length) { clearAll(true); return; }
    if (S.cur === e) {
      S.cur = null;
      const n = S.files[Math.min(i, S.files.length - 1)];
      select(n);
      if (hadFocus) n.row.querySelector('.ps-row-main').focus();
    }
    renderTotals();
    syncInspector();
    announce('Removed ' + e.name);
  }
  function clearAll(silent) {
    const n = S.files.length;
    S.files.forEach(release);
    S.files = [];
    S.cur = null;
    setOrigUrl(null);
    el.imgB.removeAttribute('src');
    renderCount();
    renderTotals();
    setView('empty');
    syncEmptyPresets();
    if (!silent && n) { announce('Cleared ' + n + (n === 1 ? ' file' : ' files')); }
    const open = $('.ps-open');
    if (open && root.contains(document.activeElement) === false) return;
    if (open) open.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ the compare stage
  function setOrigUrl(url) {
    if (S.origUrl) URL.revokeObjectURL(S.origUrl);
    S.origUrl = url;
    if (url) el.imgA.src = url; else el.imgA.removeAttribute('src');
  }
  function showStage() {
    const e = S.cur;
    if (!e) return;
    el.stage.dataset.state = e.status === 'error' ? 'error' : !e.info ? 'loading' : 'ready';
    el.msg.hidden = e.status !== 'error';
    if (e.status === 'error') { $('p', el.msg).textContent = e.error; setOrigUrl(null); el.imgB.removeAttribute('src'); return; }
    if (!e.info) { setOrigUrl(null); el.imgB.removeAttribute('src'); return; }
    setOrigUrl(URL.createObjectURL(e.file));
    el.tagA.textContent = fmtBytes(e.bytes);
    el.worlds.forEach((w) => { w.style.width = e.info.width + 'px'; w.style.height = e.info.height + 'px'; });
    showOutput();
    fitView();
    applyView();
  }
  function showOutput() {
    const e = S.cur;
    if (!e || !e.info) return;
    const r = e.result;
    if (r && r.url) {
      if (el.imgB.getAttribute('src') !== r.url) el.imgB.src = r.url;
      el.stage.classList.add('has-out');
    } else {
      el.imgB.removeAttribute('src');
      el.stage.classList.remove('has-out');
    }
    el.tagBf.textContent = r ? (r.kept ? 'Kept' : flabel(r.format)) : (e.status === 'failed' ? 'Error' : 'Output');
    el.tagB.textContent = r ? fmtBytes(r.kept ? e.bytes : r.bytes) : '';
    el.tagBox.classList.toggle('is-busy', !!e.job || !r);
    applyView();
  }

  // zoom is kept as CSS px per ORIGINAL pixel; the readout is per OUTPUT pixel
  const outRatio = () => { const e = S.cur; return e && e.result && e.result.width && e.info && e.info.width ? e.result.width / e.info.width : 1; };
  function vpBox() {
    const r = el.vp.getBoundingClientRect();
    const phone = PHONE.matches;
    return { w: r.width, h: r.height, pad: phone ? 12 : 28, bottom: phone ? 64 : 76, top: phone ? 48 : 56 };
  }
  function fitView() {
    const e = S.cur;
    if (!e || !e.info || !e.info.width) return;
    const b = vpBox();
    const aw = Math.max(40, b.w - b.pad * 2), ah = Math.max(40, b.h - b.top - b.bottom);
    const z = Math.min(aw / e.info.width, ah / e.info.height);
    S.view = { z, x: (b.w - e.info.width * z) / 2, y: b.top + (ah - e.info.height * z) / 2, fit: true };
  }
  function zoomLimits() {
    const e = S.cur;
    if (!e || !e.info) return [0.01, 32];
    const b = vpBox();
    const fz = Math.min((b.w - b.pad * 2) / e.info.width, (b.h - b.top - b.bottom) / e.info.height);
    return [Math.min(fz * 0.5, 0.05), Math.max(32 * outRatio(), fz * 2)];
  }
  function zoomAt(nz, cx, cy) {
    const [lo, hi] = zoomLimits();
    nz = clamp(nz, lo, hi);
    const v = S.view;
    if (cx == null) { const b = vpBox(); cx = b.w / 2; cy = b.h / 2; }
    v.x = cx - (cx - v.x) * (nz / v.z);
    v.y = cy - (cy - v.y) * (nz / v.z);
    v.z = nz;
    v.fit = false;
    applyView();
  }
  function actualSize() { zoomAt(outRatio()); }
  function applyView() {
    const v = S.view;
    const t = 'translate3d(' + v.x.toFixed(2) + 'px,' + v.y.toFixed(2) + 'px,0) scale(' + v.z.toFixed(5) + ')';
    el.worlds.forEach((w) => { w.style.transform = t; });
    el.vp.style.setProperty('--z', v.z.toFixed(5));
    el.vp.style.setProperty('--split', S.split.toFixed(4));
    const shown = v.z / outRatio();
    el.zoomval.textContent = Math.round(shown * 100) + '%';
    el.vp.classList.toggle('is-pixel', shown >= 2.5);
    const pct = Math.round(S.split * 100);
    el.split.setAttribute('aria-valuenow', String(pct));
    el.split.setAttribute('aria-valuetext', 'Original on the left ' + pct + '%, output on the right ' + (100 - pct) + '%');
    el.vp.classList.toggle('tag-a-off', S.split < 0.12);
    el.vp.classList.toggle('tag-b-off', S.split > 0.88);
  }
  function setSplit(f) { S.split = clamp(f, 0, 1); applyView(); }
  function showOriginal(on) {
    S.orig = !!on;
    el.vp.classList.toggle('is-orig', S.orig);
    el.hold.setAttribute('aria-pressed', S.orig ? 'true' : 'false');
  }

  // pointer: pan, pinch, divider
  const ptrs = new Map();
  let gesture = null;
  el.vp.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0 || !S.cur || !S.cur.info) return;
    const onSplit = ev.target.closest('.ps-split');
    el.vp.setPointerCapture(ev.pointerId);
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const r = el.vp.getBoundingClientRect();
    if (onSplit && ptrs.size === 1) {
      gesture = { type: 'split', left: r.left, width: r.width };
      el.split.focus({ preventScroll: true });
      el.vp.classList.add('is-splitting');
      ev.preventDefault();
      return;
    }
    if (ptrs.size === 1) {
      gesture = { type: 'pan', sx: ev.clientX, sy: ev.clientY, ox: S.view.x, oy: S.view.y, moved: false };
    } else if (ptrs.size === 2) {
      const [a, b] = Array.from(ptrs.values());
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: S.view.z, wx: (mx - S.view.x) / S.view.z, wy: (my - S.view.y) / S.view.z, left: r.left, top: r.top };
    }
    el.vp.classList.add('is-grabbing');
  });
  el.vp.addEventListener('pointermove', (ev) => {
    if (!ptrs.has(ev.pointerId) || !gesture) return;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (gesture.type === 'split') { setSplit((ev.clientX - gesture.left) / gesture.width); return; }
    if (gesture.type === 'pan') {
      const dx = ev.clientX - gesture.sx, dy = ev.clientY - gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) gesture.moved = true;
      S.view.x = gesture.ox + dx; S.view.y = gesture.oy + dy; S.view.fit = false;
      applyView();
    } else if (gesture.type === 'pinch' && ptrs.size >= 2) {
      const [a, b] = Array.from(ptrs.values());
      const [lo, hi] = zoomLimits();
      const nz = clamp(gesture.z * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.d), lo, hi);
      const mx = (a.x + b.x) / 2 - gesture.left, my = (a.y + b.y) / 2 - gesture.top;
      S.view = { z: nz, x: mx - gesture.wx * nz, y: my - gesture.wy * nz, fit: false };
      applyView();
    }
  });
  function endPointer(ev) {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.delete(ev.pointerId);
    if (ptrs.size === 1 && gesture && gesture.type === 'pinch') {
      const p = Array.from(ptrs.values())[0];
      gesture = { type: 'pan', sx: p.x, sy: p.y, ox: S.view.x, oy: S.view.y, moved: true };
      return;
    }
    if (!ptrs.size) { gesture = null; el.vp.classList.remove('is-grabbing', 'is-splitting'); }
  }
  el.vp.addEventListener('pointerup', endPointer);
  el.vp.addEventListener('pointercancel', endPointer);
  el.vp.addEventListener('wheel', (ev) => {
    if (!S.cur || !S.cur.info) return;
    ev.preventDefault();
    const r = el.vp.getBoundingClientRect();
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? r.height : 1;
    const dy = clamp(ev.deltaY * unit, -240, 240);
    zoomAt(S.view.z * Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0022)), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  el.vp.addEventListener('dblclick', (ev) => {
    if (ev.target.closest('.ps-split')) return;
    const r = el.vp.getBoundingClientRect();
    if (S.view.fit) zoomAt(outRatio(), ev.clientX - r.left, ev.clientY - r.top);
    else { fitView(); applyView(); }
  });
  el.split.addEventListener('keydown', (ev) => {
    const big = ev.shiftKey ? 0.1 : 0.02;
    let f = null;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') f = S.split - big;
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') f = S.split + big;
    else if (ev.key === 'Home') f = 0;
    else if (ev.key === 'End') f = 1;
    else if (ev.key === 'PageDown') f = S.split - 0.1;
    else if (ev.key === 'PageUp') f = S.split + 0.1;
    if (f == null) return;
    ev.preventDefault();
    ev.stopPropagation();
    setSplit(f);
  });
  new ResizeObserver(() => {
    if (ps.dataset.view !== 'work') return;
    if (S.view.fit) fitView();
    applyView();
  }).observe(el.vp);

  // hold-to-see-original button: press and hold with a pointer, toggle with the keyboard
  el.hold.addEventListener('pointerdown', (ev) => { ev.preventDefault(); el.hold.setPointerCapture(ev.pointerId); showOriginal(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => el.hold.addEventListener(t, () => showOriginal(false)));
  el.hold.addEventListener('click', (ev) => { if (ev.detail === 0) showOriginal(!S.orig); });

  // ------------------------------------------------------------------ inspector wiring
  const q = $('#ps-q'), qOut = $('.ps-f-quality output'), ll = $('#ps-ll'), bg = $('#ps-bg'), bgHex = $('#ps-bg-hex');
  const rmode = $('#ps-rmode'), inPct = $('#ps-pct'), inW = $('#ps-w'), inH = $('#ps-h'), lockBtn = $('.ps-lock');
  const tOn = $('#ps-t-on'), tVal = $('#ps-t-val');
  const radios = (name) => $$('input[name="' + name + '"]');
  function setRadio(name, value) { radios(name).forEach((r) => { r.checked = r.value === String(value); }); }
  const show = (node, on) => { node.hidden = !on; };

  function aspect() { const e = S.cur; return e && e.info && e.info.width ? e.info.width / e.info.height : 1.5; }

  function syncInspector() {
    const t = target();
    const e = S.cur;
    const f = t.format;
    // scope
    show($('.ps-scope'), S.files.length > 1);
    setRadio('ps-scope', e && e.override ? 'file' : 'all');
    $('.ps-scope-help').textContent = e && e.override ? 'Only ' + e.name + ' uses these settings.' : 'Changes apply to every file without its own settings.';
    // preset
    const pid = presetOf(t);
    setRadio('ps-preset', pid);
    $('.ps-preset-help').textContent = pid === 'custom' ? 'Your own settings.' : PRESET[pid].detail;
    // format
    setRadio('ps-fmt', f);
    const enc = S.caps && S.caps.encode;
    radios('ps-fmt').forEach((x) => {
      const off = !!(enc && x.value !== 'auto' && enc[x.value] === false);
      x.disabled = off && x.value !== f;
      x.parentNode.title = off ? 'This browser can\u2019t save ' + FORMAT_LABEL[x.value] + ' files' : '';
    });
    const lossless = hasLossless(f) && t.lossless;
    show($('.ps-f-quality'), usesQuality(f));
    q.value = t.quality;
    qOut.textContent = t.targetOn ? 'Auto' : lossless ? 'Lossless' : String(t.quality);
    q.disabled = lossless || t.targetOn;
    q.style.setProperty('--fill', ((t.quality - 1) / 99 * 100).toFixed(1) + '%');
    show($('.ps-f-lossless'), hasLossless(f));
    ll.checked = !!t.lossless;
    show($('.ps-f-colors'), f === 'png');
    setRadio('ps-colors', String(t.pngColors));
    const needBg = f === 'jpeg' || f === 'bmp' || (f === 'auto' && e && e.info && e.info.alpha);
    show($('.ps-f-bg'), !!needBg);
    if (document.activeElement !== bgHex) bgHex.value = t.background;
    bg.value = /^#[0-9a-f]{6}$/i.test(t.background) ? t.background : '#ffffff';
    $('.ps-swatch').style.setProperty('--sw', t.background);
    const fh = {
      auto: 'Pinch picks a format for each image.',
      jpeg: needBg ? 'JPG has no transparency, so see-through areas get the background colour.' : '',
      png: t.pngColors ? 'Fewer colours make smaller files. Best for graphics and screenshots.' : 'Every pixel is kept exactly.',
      webp: '', avif: 'AVIF makes the smallest files but takes longer to encode.',
      gif: 'GIF keeps up to 256 colours. Best for simple graphics.',
      bmp: 'BMP is uncompressed, so files get much bigger.',
      ico: 'An icon file for websites and apps, with several sizes inside.',
    }[f] || '';
    const fhEl = $('.ps-fmt-help');
    fhEl.textContent = t.targetOn && usesQuality(f) && !lossless ? 'Quality is chosen for you to reach the target size.' : fh;
    show(fhEl, !!fhEl.textContent);
    // resize
    const r = t.resize;
    rmode.value = r.mode;
    const dims = $('.ps-dims');
    dims.dataset.mode = r.mode;
    show(dims, r.mode !== 'none');
    if (document.activeElement !== inPct) inPct.value = r.percent;
    if (document.activeElement !== inW) inW.value = r.width;
    if (document.activeElement !== inH) inH.value = r.height;
    lockBtn.setAttribute('aria-pressed', r.lock ? 'true' : 'false');
    const dh = $('.ps-dims-help');
    let dtext = '';
    if (e && e.info && e.info.width) {
      const W = e.info.width, H = e.info.height;
      // same geometry as the engine: upscale first, then the resize rule
      let w = W * t.upscale.factor, h = H * t.upscale.factor;
      if (r.mode === 'percent') { w *= r.percent / 100; h *= r.percent / 100; }
      else if (r.mode === 'fit') { const k = Math.min(1, r.width / w, r.height / h); w *= k; h *= k; }
      else if (r.mode === 'width') { w = r.width; h = H * r.width / W; }
      else if (r.mode === 'height') { h = r.height; w = W * r.height / H; }
      if (r.mode !== 'none') dtext = W + ' × ' + H + ' becomes about ' + Math.round(w) + ' × ' + Math.round(h);
    }
    dh.textContent = dtext;
    show(dh, !!dtext);
    // upscale
    setRadio('ps-up', String(t.upscale.factor));
    radios('ps-up').forEach((x) => { x.disabled = x.value === '3' && t.upscale.method === 'ai'; x.parentNode.title = x.disabled ? 'AI detail works at 2× or 4×' : ''; });
    show($('.ps-f-method'), t.upscale.factor > 1);
    setRadio('ps-method', t.upscale.method);
    syncAI(t);
    // target
    tOn.checked = !!t.targetOn;
    if (document.activeElement !== tVal) tVal.value = t.targetValue;
    setRadio('ps-t-unit', t.targetUnit);
    $('.ps-target').classList.toggle('is-off', !t.targetOn);
    tVal.disabled = !t.targetOn;
    radios('ps-t-unit').forEach((x) => { x.disabled = !t.targetOn; });
  }

  function syncAI(t) {
    const box = $('.ps-ai');
    const on = t.upscale.factor > 1 && t.upscale.method === 'ai';
    box.hidden = !on;
    if (!on) return;
    const txt = $('.ps-ai-text', box), go = $('.ps-ai-go', box);
    const AI = window.PinchAI;
    if (!AI) { txt.textContent = 'AI detail is still loading. Try again in a moment.'; go.hidden = true; return; }
    if (!S.aiInfo) {
      txt.textContent = 'Checking what this device can run…'; go.hidden = true;
      Promise.resolve().then(() => AI.available()).then((info) => { S.aiInfo = info || {}; syncAI(target()); })
        .catch(() => { S.aiInfo = { webgpu: false, wasm: false }; syncAI(target()); });
      return;
    }
    const i = S.aiInfo;
    if (!i.webgpu && !i.wasm) { txt.textContent = 'This browser can’t run AI detail. Sharp gives a good result too.'; go.hidden = true; return; }
    const size = i.modelBytes ? fmtBytes(i.modelBytes) : 'a small';
    if (i.cached && !S.aiOK) { S.aiOK = true; lsSet('pinch-ai-ok', '1'); }
    const cancelled = S.files.some((x) => x.cancelled && x.waitKey === keyOf(x));
    $('span', go).textContent = cancelled ? 'Upscale again' : 'Download model';
    if (cancelled) { txt.textContent = 'AI detail was cancelled. It runs on this device and can take a while without a graphics chip.'; go.hidden = false; return; }
    if (!S.aiOK) {
      txt.textContent = 'AI detail uses ' + (i.modelBytes ? 'a ' + size : 'a small') + ' model. It downloads once, then runs on this device' + (i.webgpu ? ' with your graphics chip.' : '.') + ' Your images stay here.';
      go.hidden = false;
    } else {
      txt.textContent = 'Runs on this device' + (i.webgpu ? ' with your graphics chip' : '') + '. It is slower than the other methods, so give it a moment.';
      go.hidden = true;
    }
  }
  $('.ps-ai-go').addEventListener('click', () => {
    S.aiOK = true;
    S.files.forEach((e) => { e.waitKey = null; e.cancelled = false; });
    syncAI(target());
    renderResult();
    S.files.forEach(renderRow);
    schedule(0);
  });

  function edit(fn) {
    const t = target();
    fn(t);
    if (presetOf(t) === 'custom') S.lastCustom = clone(t);
    afterEdit();
  }
  function afterEdit(only) {
    syncInspector();
    syncEmptyPresets();
    const list = only || (S.cur && S.cur.override ? [S.cur] : S.files.filter((e) => !e.override));
    invalidate(list);
    if (S.cur) renderResult();
  }

  // presets (inspector + empty state)
  function applyPreset(id) {
    if (id === 'custom') {
      if (!S.lastCustom) { syncInspector(); return; }
      const t = target();
      Object.assign(t, clone(S.lastCustom));
      afterEdit();
      return;
    }
    const t = target();
    const cur = presetOf(t);
    if (cur === 'custom') S.lastCustom = clone(t);
    const keepLock = t.resize.lock;
    Object.assign(t, clone(PRESET[id].full));
    t.resize.lock = keepLock;
    afterEdit();
  }
  radios('ps-preset').forEach((r) => r.addEventListener('change', () => applyPreset(r.value)));
  radios('ps-preset-e').forEach((r) => r.addEventListener('change', () => { applyPreset(r.value); }));
  function syncEmptyPresets() {
    const pid = presetOf(S.G);
    setRadio('ps-preset-e', pid);
    el.presetNote.textContent = pid === 'custom' ? 'Your own settings.' : PRESET[pid].detail;
    if (demoReady && ps.dataset.view === 'empty') demoSchedule();
  }

  radios('ps-scope').forEach((r) => r.addEventListener('change', () => {
    const e = S.cur;
    if (!e) return;
    if (r.value === 'file' && !e.override) e.override = clone(S.G);
    else if (r.value === 'all' && e.override) e.override = null;
    afterEdit([e]);
    renderRow(e);
  }));
  radios('ps-fmt').forEach((r) => r.addEventListener('change', () => {
    try { if (window.Pinch && window.Pinch.preload) window.Pinch.preload(r.value); } catch (err) { /* optional */ }
    edit((t) => { t.format = r.value; });
  }));
  q.addEventListener('input', () => {
    const v = Number(q.value);
    qOut.textContent = String(v);
    q.style.setProperty('--fill', ((v - 1) / 99 * 100).toFixed(1) + '%');
    edit((t) => { t.quality = v; });
  });
  ll.addEventListener('change', () => edit((t) => { t.lossless = ll.checked; }));
  radios('ps-colors').forEach((r) => r.addEventListener('change', () => edit((t) => { t.pngColors = Number(r.value); })));
  bg.addEventListener('input', () => edit((t) => { t.background = bg.value; }));
  bgHex.addEventListener('input', () => {
    let v = bgHex.value.trim();
    if (v && v[0] !== '#') v = '#' + v;
    if (/^#([0-9a-f]{3}){1,2}$/i.test(v)) {
      if (v.length === 4) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
      edit((t) => { t.background = v.toLowerCase(); });
    }
  });
  bgHex.addEventListener('change', () => { bgHex.value = target().background; });
  rmode.addEventListener('change', () => edit((t) => { t.resize.mode = rmode.value; }));
  const numVal = (inp, lo, hi) => { const v = Math.round(Number(inp.value)); return v >= lo && v <= hi ? v : null; };
  inPct.addEventListener('input', () => { const v = numVal(inPct, 1, 400); if (v) edit((t) => { t.resize.percent = v; }); });
  inW.addEventListener('input', () => {
    const v = numVal(inW, 1, 20000); if (!v) return;
    edit((t) => { t.resize.width = v; if (t.resize.lock && t.resize.mode === 'fit') { t.resize.height = Math.max(1, Math.round(v / aspect())); inH.value = t.resize.height; } });
  });
  inH.addEventListener('input', () => {
    const v = numVal(inH, 1, 20000); if (!v) return;
    edit((t) => { t.resize.height = v; if (t.resize.lock && t.resize.mode === 'fit') { t.resize.width = Math.max(1, Math.round(v * aspect())); inW.value = t.resize.width; } });
  });
  [inPct, inW, inH, tVal].forEach((i) => i.addEventListener('change', () => syncInspector()));
  lockBtn.addEventListener('click', () => edit((t) => {
    t.resize.lock = !t.resize.lock;
    if (t.resize.lock) t.resize.height = Math.max(1, Math.round(t.resize.width / aspect()));
  }));
  radios('ps-up').forEach((r) => r.addEventListener('change', () => edit((t) => { t.upscale.factor = Number(r.value); })));
  radios('ps-method').forEach((r) => r.addEventListener('change', () => edit((t) => {
    t.upscale.method = r.value;
    if (r.value === 'ai' && t.upscale.factor === 3) t.upscale.factor = 4;
  })));
  tOn.addEventListener('change', () => edit((t) => { t.targetOn = tOn.checked; }));
  tVal.addEventListener('input', () => { const v = Number(tVal.value); if (v > 0 && v <= 100000) edit((t) => { t.targetValue = v; }); });
  radios('ps-t-unit').forEach((r) => r.addEventListener('change', () => edit((t) => {
    if (t.targetUnit !== r.value) t.targetValue = r.value === 'MB' ? Math.max(0.1, Math.round(t.targetValue / 100) / 10) : Math.round(t.targetValue * 1000);
    t.targetUnit = r.value;
  })));

  // ------------------------------------------------------------------ phone bottom sheet
  function syncSheet() {
    const phone = PHONE.matches;
    el.insp.classList.toggle('is-open', phone && S.sheetOpen);
    el.grab.setAttribute('aria-expanded', phone ? String(S.sheetOpen) : 'true');
    el.grab.querySelector('.vh').textContent = S.sheetOpen ? 'Hide settings' : 'Show settings';
    if ('inert' in el.body) el.body.inert = phone && !S.sheetOpen;
  }
  function setSheet(open) { S.sheetOpen = !!open; syncSheet(); }
  PHONE.addEventListener ? PHONE.addEventListener('change', syncSheet) : PHONE.addListener(syncSheet);
  (function sheetDrag() {
    let sy = 0, dy = 0, drag = false, id = null;
    const startTargets = [el.grab, el.res];
    startTargets.forEach((t) => t.addEventListener('pointerdown', (ev) => {
      if (!PHONE.matches) return;
      drag = true; id = ev.pointerId; sy = ev.clientY; dy = 0;
      t.setPointerCapture(id);
      el.insp.classList.add('is-dragging');
    }));
    startTargets.forEach((t) => t.addEventListener('pointermove', (ev) => {
      if (!drag || ev.pointerId !== id) return;
      dy = ev.clientY - sy;
      const d = S.sheetOpen ? Math.max(0, dy) : Math.min(0, dy);
      el.insp.style.setProperty('--drag', d + 'px');
    }));
    const end = (ev) => {
      if (!drag || ev.pointerId !== id) return;
      drag = false;
      el.insp.classList.remove('is-dragging');
      el.insp.style.removeProperty('--drag');
      if (Math.abs(dy) < 6) setSheet(!S.sheetOpen);
      else if (dy < -36) setSheet(true);
      else if (dy > 36) setSheet(false);
    };
    startTargets.forEach((t) => { t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end); });
    el.grab.addEventListener('click', (ev) => { if (ev.detail === 0) setSheet(!S.sheetOpen); });
  })();

  // ------------------------------------------------------------------ saving, copying
  function download(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function fileOut(e) {
    const r = e.result;
    if (!r) return null;
    if (r.kept) return { name: e.name, blob: e.file };
    return { name: outName(e.name, r.format), blob: r.blob };
  }
  function saveCurrent() {
    const e = S.cur;
    const o = e && fileOut(e);
    if (!o) { toast('Nothing to save yet', 'bad'); return; }
    download(o.blob, o.name);
    toast('Saved ' + o.name);
    announce('Saved ' + o.name);
  }
  async function whenIdle() {
    for (let i = 0; i < 2400; i++) {
      if (running === 0 && !S.files.some(needs) && !S.files.some((e) => e.status === 'reading')) return;
      await sleep(50);
    }
  }
  let saving = false;
  async function saveAll() {
    if (saving || !S.files.length) return;
    saving = true;
    const btn = $('.ps-a-all');
    const label = btn.querySelector('span');
    btn.classList.add('is-busy');
    try {
      clearTimeout(pumpT); pump();
      if (running || S.files.some(needs)) { label.textContent = 'Finishing…'; await whenIdle(); }
      const outs = S.files.map(fileOut).filter(Boolean);
      if (!outs.length) { toast('Nothing to save yet', 'bad'); return; }
      const seen = new Map();
      outs.forEach((o) => {
        let n = o.name, i = 1;
        const lower = () => n.toLowerCase();
        while (seen.has(lower())) { i++; n = o.name.replace(/(\.[^.]+)?$/, ' (' + i + ')$1'); }
        seen.set(lower(), 1);
        o.name = n;
      });
      label.textContent = 'Zipping…';
      const P = await engine();
      const zip = await P.zip(outs);
      download(zip, 'pinch-images.zip');
      toast('Saved ' + outs.length + (outs.length === 1 ? ' image' : ' images') + ' as pinch-images.zip');
      announce('Saved pinch-images.zip');
    } catch (err) {
      toast((err && err.message) || 'Could not make the ZIP. Try again.', 'bad');
    } finally {
      label.textContent = 'Save all';
      btn.classList.remove('is-busy');
      saving = false;
    }
  }
  async function copyCurrent() {
    const e = S.cur;
    const o = e && fileOut(e);
    if (!o || !CAN_COPY) return;
    try {
      let blob = o.blob, asPng = false;
      const ok = (type) => (window.ClipboardItem && ClipboardItem.supports ? ClipboardItem.supports(type) : type === 'image/png');
      if (!ok(blob.type)) {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close && bmp.close();
        blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        c.width = c.height = 0;
        asPng = o.blob.type !== 'image/png';
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast(asPng ? 'Copied as PNG, the format clipboards accept' : 'Copied to the clipboard');
    } catch (err) {
      toast('This browser would not copy the image. Use Save instead.', 'bad');
    }
  }

  // ------------------------------------------------------------------ samples
  async function openSamples(list) {
    try {
      const files = await Promise.all(list.map(async (s) => {
        const r = await fetch(new URL('assets/samples/' + s.file, BASE));
        if (!r.ok) throw new Error('missing');
        const b = await r.blob();
        return new File([b], s.file, { type: b.type || 'image/jpeg' });
      }));
      addFiles(files);
    } catch (err) {
      toast('Could not open the sample. Check your connection and try again.', 'bad');
    }
  }

  // ------------------------------------------------------------------ actions
  function openPicker() { el.pick.value = ''; el.pick.click(); }
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (b && root.contains(b)) {
      const a = b.dataset.act;
      if (a === 'open') openPicker();
      else if (a === 'folder') { el.pickDir.value = ''; el.pickDir.click(); }
      else if (a === 'samples') openSamples(SAMPLES);
      else if (a === 'save') saveCurrent();
      else if (a === 'saveall') saveAll();
      else if (a === 'copy') copyCurrent();
      else if (a === 'clear') { const n = S.files.length; clearAll(); if (n) toast('Cleared ' + n + (n === 1 ? ' file' : ' files')); }
      else if (a === 'zin') zoomAt(S.view.z * 1.5);
      else if (a === 'zout') zoomAt(S.view.z / 1.5);
      else if (a === 'fit') { fitView(); applyView(); }
      else if (a === 'actual') actualSize();
      else if (a === 'ztoggle') { if (S.view.fit) actualSize(); else { fitView(); applyView(); } }
      else if (a === 'keys') openKeys();
      else if (a === 'cancel') cancelCurrent();
      else if (a === 'closekeys') el.sheet.close();
      return;
    }
    const s = ev.target.closest('[data-sample]');
    if (s) openSamples([SAMPLES[Number(s.dataset.sample)]]);
  });
  el.pick.addEventListener('change', () => { addFiles(el.pick.files); el.pick.value = ''; });
  el.pickDir.addEventListener('change', () => { addFiles(el.pickDir.files, true); el.pickDir.value = ''; });
  function cancelCurrent() {
    const e = S.cur;
    if (!e || !e.job) return;
    const key = e.job.key;
    e.job.ctrl.abort();
    try { if (window.Pinch && window.Pinch.cancel) window.Pinch.cancel(e.file); } catch (err) { /* ignore */ }
    e.job = null;
    e.waitKey = key;          // do not start again until the user asks or changes a setting
    e.cancelled = true;
    if (!e.result) e.status = 'wait';
    renderRow(e); renderResult(); renderTotals(); syncAI(target());
    toast('Cancelled');
  }
  function openKeys() {
    if (el.sheet.open) return;
    if (el.sheet.showModal) el.sheet.showModal(); else el.sheet.setAttribute('open', '');
  }
  el.sheet.addEventListener('click', (ev) => { if (ev.target === el.sheet) el.sheet.close(); });

  // ------------------------------------------------------------------ drop anywhere, paste
  let dragDepth = 0;
  const hasFiles = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
  function dropUI(on) {
    el.drop.hidden = !on;
    ps.classList.toggle('is-dropping', on);
    if (on) requestAnimationFrame(() => el.drop.classList.add('is-on'));
    else el.drop.classList.remove('is-on');
  }
  window.addEventListener('dragenter', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); dragDepth++; dropUI(true); });
  window.addEventListener('dragover', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', (ev) => { if (!hasFiles(ev)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropUI(false); });
  window.addEventListener('drop', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    dropUI(false);
    const dt = ev.dataTransfer;
    const plain = Array.from(dt.files || []);
    const entries = Array.from(dt.items || []).map((it) => (it.kind === 'file' && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    const anyDir = entries.some((en) => en.isDirectory);
    if (!anyDir) { addFiles(plain); scrollToStudio(); return; }
    (async () => {
      const out = [];
      const walk = async (en) => {
        if (en.isFile) { try { out.push(await new Promise((res, rej) => en.file(res, rej))); } catch (e) { /* unreadable */ } }
        else if (en.isDirectory) {
          const reader = en.createReader();
          let batch;
          do { batch = await new Promise((res) => reader.readEntries(res, () => res([]))); for (const b of batch) await walk(b); } while (batch.length);
        }
      };
      for (const en of entries) await walk(en);
      addFiles(out, true);
      scrollToStudio();
    })();
  });
  function scrollToStudio() {
    const r = root.getBoundingClientRect();
    if (r.top < -80 || r.top > innerHeight * 0.5) root.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  document.addEventListener('paste', (ev) => {
    const cd = ev.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.files || []).filter(looksImage);
    if (!files.length) {
      Array.from(cd.items || []).forEach((it) => { if (it.kind === 'file') { const f = it.getAsFile(); if (f && looksImage(f)) files.push(f); } });
    }
    if (!files.length) return;
    ev.preventDefault();
    const named = files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], 'pasted-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + (i ? '-' + (i + 1) : '') + '.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type })));
    addFiles(named);
    scrollToStudio();
  });

  // ------------------------------------------------------------------ keyboard
  let inView = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { es.forEach((x) => { inView = x.intersectionRatio > 0.3 || x.intersectionRect.height > innerHeight * 0.45; }); }, { threshold: [0, 0.3, 0.6, 1] }).observe(root);
  }
  const TEXTY = /^(text|number|search|email|url|tel|password|date|time|datetime-local|month|week|color)$/;
  function typing(t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    return t.tagName === 'INPUT' && TEXTY.test(t.type || 'text');
  }
  // remember a button that got focus from a pointer, so Space-hold still works after clicking Fit or 1:1
  let pointerFocus = null;
  root.addEventListener('pointerdown', (ev) => { pointerFocus = ev.target.closest && ev.target.closest('button'); }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Tab') pointerFocus = null; }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (el.sheet.open) return;
    const t = ev.target;
    if (typing(t)) return;
    const focusIn = root.contains(t);
    if (!focusIn && !inView) return;
    const work = ps.dataset.view === 'work';
    const k = ev.key;
    const interactive = t && t.closest && t.closest('button, a, input, select, textarea, [role="slider"], summary');
    if (k === ' ' || ev.code === 'Space') {
      // a button focused by a mouse click (no focus ring) should not swallow Space-hold
      const mouseFocused = interactive && t.tagName === 'BUTTON' && t === pointerFocus;
      if (!work || (interactive && !mouseFocused) || !S.cur) return;
      ev.preventDefault();
      if (!ev.repeat) showOriginal(true);
      return;
    }
    if (ev.repeat && !(k === '+' || k === '=' || k === '-' || k === '_' || k === '[' || k === ']')) return;
    let hit = true;
    if (k === '?') openKeys();
    else if (k === 'o' || k === 'O') openPicker();
    else if (!work) hit = false;
    else if (ev.code === 'KeyS' || k === 's' || k === 'S') { if (ev.shiftKey) saveAll(); else saveCurrent(); }
    else if (k === '[') step(-1);
    else if (k === ']') step(1);
    else if (k === 'f' || k === 'F') { fitView(); applyView(); }
    else if (k === '1') actualSize();
    else if (k === '+' || k === '=') zoomAt(S.view.z * 1.25);
    else if (k === '-' || k === '_') zoomAt(S.view.z / 1.25);
    else if (k === 'Delete' || k === 'Backspace') { if (t && t.closest && t.closest('input, select, textarea')) hit = false; else remove(S.cur); }
    else if (k === 'Escape' && PHONE.matches && S.sheetOpen) setSheet(false);
    else hit = false;
    if (hit) ev.preventDefault();
  });
  document.addEventListener('keyup', (ev) => { if ((ev.key === ' ' || ev.code === 'Space') && S.orig) showOriginal(false); });
  window.addEventListener('blur', () => { if (S.orig) showOriginal(false); });

  // ------------------------------------------------------------------ live preview in the empty state
  // A real encode of one sample with the selected preset, so the first screen shows true numbers.
  const demo = { el: $('.ps-demo'), file: null, ctrl: null, url: null, key: null, t: 0 };
  demo.img = $('.ps-demo-b img');
  demo.tag = $('.ps-demo-tag');
  demo.split = $('.ps-demo-split');
  function demoSplit(f) {
    f = clamp(f, 0, 1);
    demo.el.style.setProperty('--split', f.toFixed(4));
    demo.split.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    demo.el.classList.toggle('tag-a-off', f < 0.2);
    demo.el.classList.toggle('tag-b-off', f > 0.8);
  }
  demoSplit(0.5);
  (function () {
    let dragging = null;
    demo.el.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      const r = demo.el.getBoundingClientRect();
      dragging = { id: ev.pointerId, left: r.left, width: r.width };
      demo.el.setPointerCapture(ev.pointerId);
      demo.el.classList.add('is-splitting');
      demoSplit((ev.clientX - r.left) / r.width);
    });
    demo.el.addEventListener('pointermove', (ev) => { if (dragging && ev.pointerId === dragging.id) demoSplit((ev.clientX - dragging.left) / dragging.width); });
    const end = () => { dragging = null; demo.el.classList.remove('is-splitting'); };
    demo.el.addEventListener('pointerup', end);
    demo.el.addEventListener('pointercancel', end);
    demo.split.addEventListener('keydown', (ev) => {
      const cur = Number(demo.split.getAttribute('aria-valuenow')) / 100;
      const d = ev.shiftKey ? 0.1 : 0.02;
      const m = { ArrowLeft: cur - d, ArrowDown: cur - d, ArrowRight: cur + d, ArrowUp: cur + d, Home: 0, End: 1 };
      if (!(ev.key in m)) return;
      ev.preventDefault();
      ev.stopPropagation();
      demoSplit(m[ev.key]);
    });
  })();
  function demoSchedule(delay) { clearTimeout(demo.t); demo.t = setTimeout(runDemo, delay == null ? 220 : delay); }
  function demoStop() {
    clearTimeout(demo.t);
    if (demo.ctrl) {
      demo.ctrl.abort();
      try { if (window.Pinch && window.Pinch.cancel && demo.file) window.Pinch.cancel(demo.file); } catch (e) { /* ignore */ }
      demo.ctrl = null;
      demo.tag.classList.remove('is-busy');
    }
  }
  async function runDemo() {
    if (ps.dataset.view !== 'empty' || !demo.el.offsetParent) return;
    const s = clone(S.G);
    if (s.upscale.method === 'ai') s.upscale.method = 'sharp';   // the preview never downloads the AI model
    s.upscale.factor = 1;
    const key = JSON.stringify(norm(s));
    if (key === demo.key) return;
    demoStop();
    const ctrl = demo.ctrl = new AbortController();
    demo.tag.classList.add('is-busy');
    $('.ps-tag-fmt', demo.tag).textContent = s.format === 'auto' ? 'Auto' : flabel(s.format);
    $('b', demo.tag).textContent = '';
    $('.ps-pct', demo.tag).textContent = '';
    demo.el.classList.add('is-stale');
    try {
      const P = await engine();
      if (!demo.file) {
        const res = await fetch(new URL('assets/samples/' + SAMPLES[1].file, BASE));
        const b = await res.blob();
        demo.file = new File([b], SAMPLES[1].file, { type: 'image/jpeg' });
      }
      if (ctrl.signal.aborted) return;
      const r = await P.process(demo.file, engineSettings(s), { signal: ctrl.signal });
      if (ctrl.signal.aborted || !r) return;
      const url = URL.createObjectURL(r.blob);
      const old = demo.url;
      demo.url = url;
      demo.img.onload = () => { if (old) URL.revokeObjectURL(old); demo.el.classList.remove('is-stale'); };
      demo.img.src = url;
      demo.el.classList.toggle('is-contain', !!(r.width && r.height && Math.abs(r.width / r.height - 1.5) > 0.03));
      demo.key = key;
      const out = r.kept ? demo.file.size : r.bytes;
      const p = pctOf(demo.file.size, out);
      $('.ps-tag-fmt', demo.tag).textContent = r.kept ? 'Kept' : flabel(r.format);
      $('b', demo.tag).textContent = fmtBytes(out);
      const pe = $('.ps-pct', demo.tag);
      pe.textContent = fmtPct(p);
      pe.dataset.tone = p < 0 ? 'good' : p > 0 ? 'warn' : 'flat';
    } catch (err) {
      if (!ctrl.signal.aborted) { demo.key = key; $('b', demo.tag).textContent = ''; demo.el.classList.remove('is-stale'); }
    } finally {
      if (demo.ctrl === ctrl) { demo.ctrl = null; demo.tag.classList.remove('is-busy'); }
    }
  }
  function demoBoot() {
    demoReady = true;
    const saveData = navigator.connection && navigator.connection.saveData;
    if (saveData) { demo.tag.classList.remove('is-busy'); return; }
    const go = () => demoSchedule(0);
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 400);
  }

  // ------------------------------------------------------------------ boot
  syncEmptyPresets();
  syncInspector();
  renderTotals();
  syncSheet();
  engine().catch(() => { /* reported when a file is added */ });
  if (document.readyState === 'complete') demoBoot(); else window.addEventListener('load', demoBoot, { once: true });

  // a tiny surface for tests and for the landing page (read only)
  window.PinchStudio = {
    add: (files) => addFiles(files),
    get files() { return S.files.map((e) => ({ name: e.name, status: e.status, bytes: e.bytes, out: e.result ? (e.result.kept ? e.bytes : e.result.bytes) : null, format: e.result && e.result.format, width: e.result && e.result.width, height: e.result && e.result.height, override: !!e.override, kept: !!(e.result && e.result.kept) })); },
    get current() { return S.cur ? S.cur.name : null; },
    get view() { return { zoom: S.view.z / outRatio(), x: S.view.x, y: S.view.y, split: S.split, fit: S.view.fit, original: S.orig }; },
    get busy() { return running + S.files.filter((e) => needs(e) || e.status === 'reading').length; },
    idle: whenIdle,
  };
})();
