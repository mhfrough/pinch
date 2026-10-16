// Pinch engine v2: window.Pinch. Classic script built from this file by tools/build-codecs.mjs.
// Heavy work runs in a pool of module workers with WebAssembly codecs (codecs/worker.js);
// without module workers or WebAssembly it falls back to the canvas pipeline on the main thread.
// Nothing is ever uploaded; the only network requests are same-origin codec files.

import { FORMATS, normaliseSettings, bytes } from '../shared/constants.js';
import { sampleGrid, classifyRows } from '../shared/analyse.js';
import { plan } from '../shared/geometry.js';
import { zip } from './zip.js';
import { createFallback } from './fallback.js';
import { MSG, makeCanvas, sniffFile, openSource, decodePixels, loadImage } from './decode.js';

(function () {
  'use strict';
  if (window.Pinch && window.Pinch.version === 2) return;

  const script = document.currentScript;
  const BASE = new URL('.', (script && script.src) || location.href);
  const CODECS = new URL('codecs/', BASE).href;
  let workerUrl = CODECS + 'worker.js'; // replaced by a Blob URL of the same source once fetched
  const cfg = window.PinchConfig || {};
  const FORCE_NO_WASM = cfg.wasm === false || /[?&]pinch-nowasm(=1)?(&|$)/.test(location.search);
  const POOL_SIZE = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));

  // 1x1 test images for native decode support (used for previews of results)
  const WEBP_1PX = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  const AVIF_1PX = 'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZgAAAOptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAEOAAEAAAAAAAAAEgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAamlwcnAAAABLaXBjbwAAABNjb2xybmNseAABAA0ABoAAAAAMYXYxQ4EADAAAAAAUaXNwZQAAAAAAAAABAAAAAQAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEgYIDhAAAABptZGF0EgAKBzgADlAgIGkyCR/wAABAAACvcA==';

  let mode = 'pending';
  const fallback = createFallback(BASE);

  const abortError = () => {
    try { return new DOMException('Cancelled', 'AbortError'); } catch (e) { const x = new Error('Cancelled'); x.name = 'AbortError'; return x; }
  };
  const safeCall = (fn, arg) => { if (typeof fn === 'function') try { fn(arg); } catch (e) { /* UI errors must not break jobs */ } };

  // ------------------------------------------------------------------ file identity
  const fileIds = new WeakMap();
  let idSeq = 0;
  const idOf = (file) => { let id = fileIds.get(file); if (!id) { id = 'f' + (++idSeq); fileIds.set(file, id); } return id; };
  const inspected = new WeakMap();
  const lastUrl = new Map();

  // ------------------------------------------------------------------ support detection
  function canDecode(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }
  function canvasEncodes(mime) {
    return new Promise((resolve) => {
      try {
        const c = makeCanvas(2, 2);
        c.getContext('2d').fillRect(0, 0, 2, 2);
        c.toBlob((b) => resolve(!!b && b.type === mime), mime, 0.8);
      } catch (e) { resolve(false); }
    });
  }

  // ------------------------------------------------------------------ worker pool
  const slots = [];
  const shared = Object.create(null); // codec file -> compiled WebAssembly.Module (or Blob for heif.js)
  let jobSeq = 0;
  const assign = new Map(); // file id -> slot index

  function spawn(slot) {
    const w = new Worker(workerUrl, { type: 'module', name: 'pinch-' + slot.i + '|' + CODECS });
    slot.worker = w;
    // hand over every codec already compiled elsewhere, before any job (messages stay in order)
    for (const name in shared) w.postMessage({ type: 'share', name, value: shared[name] });
    slot.hello = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Worker did not start')), 15000);
      slot.onHello = (m) => { clearTimeout(t); resolve(m); };
      slot.onBoot = (e) => { clearTimeout(t); reject(e); };
    });
    slot.hello.catch(() => {});
    w.onmessage = (ev) => onMessage(slot, ev.data || {});
    w.onerror = (ev) => {
      if (slot.onBoot) slot.onBoot(ev);
      const job = slot.current;
      if (job) {
        try { ev.preventDefault(); } catch (e) { /* ignore */ }
        restart(slot);
        finish(slot, job, new Error(MSG.memory));
      }
    };
    w.postMessage({ type: 'hello' });
  }
  function makeSlot(i) { const slot = { i, worker: null, queue: [], current: null, assigned: 0 }; spawn(slot); return slot; }
  function restart(slot) {
    try { slot.worker.terminate(); } catch (e) { /* ignore */ }
    slot.current = null;
    spawn(slot);
    if (slot.i === 0 && warmList !== undefined && warmDone) slot.worker.postMessage({ type: 'warm', list: warmList }); // resume an interrupted warm-up
  }

  function slotFor(id) {
    let i = assign.get(id);
    if (i === undefined) {
      const busy = (s) => s.queue.length + (s.current ? 1 : 0);
      if (slots.length < POOL_SIZE && slots.every((s) => busy(s) > 0)) slots.push(makeSlot(slots.length));
      i = 0;
      for (let k = 1; k < slots.length; k++) {
        const a = slots[k], b = slots[i];
        if (busy(a) < busy(b) || (busy(a) === busy(b) && a.assigned < b.assigned)) i = k;
      }
      assign.set(id, i);
      slots[i].assigned++;
    }
    return slots[i];
  }

  function runJob(type, file, extra, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const job = Object.assign({ id: ++jobSeq, type, file, fileId: idOf(file), onProgress: opts.onProgress, resolve, reject, done: false }, extra);
      if (opts.signal) {
        if (opts.signal.aborted) { reject(abortError()); return; }
        opts.signal.addEventListener('abort', () => cancelJob(job), { once: true });
      }
      const slot = slotFor(job.fileId);
      job.slot = slot;
      slot.queue.push(job);
      pump(slot);
    });
  }
  function pump(slot) {
    if (slot.current || !slot.queue.length) return;
    const job = slot.queue.shift();
    slot.current = job;
    send(slot, job);
  }
  function send(slot, job, pixels) {
    const msg = { type: job.type, job: job.id, key: job.key, file: job.file, settings: job.settings, hint: job.hint };
    if (pixels) { msg.pixels = pixels; slot.worker.postMessage(msg, [pixels.buffer]); } else slot.worker.postMessage(msg);
  }
  function finish(slot, job, err, result) {
    if (job.done) return;
    job.done = true;
    if (slot.current === job) slot.current = null;
    if (err) job.reject(err); else job.resolve(result);
    pump(slot);
  }
  function onMessage(slot, m) {
    if (m.type === 'hello') { if (slot.onHello) slot.onHello(m); slot.onBoot = null; return; }
    if (m.type === 'share') {
      if (!shared[m.name]) {
        shared[m.name] = m.value;
        for (const s of slots) if (s !== slot) s.worker.postMessage({ type: 'share', name: m.name, value: m.value });
      }
      return;
    }
    if (m.type === 'warmed') { if (warmDone) warmDone(); return; }
    const job = slot.current;
    if (!job || job.id !== m.job) return; // stale message from a cancelled job
    if (m.type === 'progress') { safeCall(job.onProgress, { stage: m.stage, progress: m.progress, message: m.message, codec: m.codec, format: m.format, result: m.result }); return; }
    if (m.type === 'need-pixels') {
      mainThreadPixels(job).then((px) => { if (slot.current === job && !job.done) send(slot, job, px); }, (e) => finish(slot, job, e));
      return;
    }
    if (m.type === 'result') finish(slot, job, null, m.result);
    else if (m.type === 'error') finish(slot, job, new Error(m.message));
  }
  function cancelJob(job) {
    if (job.done) return;
    const slot = job.slot;
    if (slot.current === job) { restart(slot); finish(slot, job, abortError()); }
    else {
      const k = slot.queue.indexOf(job);
      if (k >= 0) slot.queue.splice(k, 1);
      job.done = true;
      job.reject(abortError());
    }
  }

  // The worker asks for pixels when it cannot decode (SVG, or no OffscreenCanvas).
  async function mainThreadPixels(job) {
    const sn = await sniffFile(job.file);
    const px = await decodePixels(job.file, sn, job.svgSize ? { w: job.svgSize.w, h: job.svgSize.h } : null);
    return {
      buffer: px.data.buffer, width: px.width, height: px.height,
      origW: job.svgSize ? job.svgSize.W : px.origW, origH: job.svgSize ? job.svgSize.H : px.origH,
      format: sn.format, animated: sn.animated, decodeCapped: px.decodeCapped,
    };
  }

  // ------------------------------------------------------------------ ready
  const ready = (async () => {
    const [webpNative, avifNative, webpCanvas, avifCanvas] = await Promise.all([
      canDecode(WEBP_1PX), canDecode(AVIF_1PX), canvasEncodes('image/webp'), canvasEncodes('image/avif'),
    ]);
    let wasm = false;
    if (!FORCE_NO_WASM && typeof Worker === 'function' && typeof WebAssembly === 'object') {
      try {
        // Start workers from a Blob URL of worker.js so new or restarted workers need no network.
        try {
          const r = await fetch(workerUrl);
          if (r.ok) workerUrl = URL.createObjectURL(new Blob([await r.text()], { type: 'text/javascript' }));
        } catch (e) { /* keep the plain URL */ }
        const s = makeSlot(0);
        slots.push(s);
        const hello = await s.hello;
        wasm = !!hello.wasm;
      } catch (e) { wasm = false; }
    }
    if (!wasm) { slots.forEach((s) => { try { s.worker.terminate(); } catch (e) { /* ignore */ } }); slots.length = 0; }
    mode = wasm ? 'wasm' : 'fallback';
    if (wasm && cfg.warm !== false) scheduleWarm(); else if (warmDone) warmDone();
    const encode = { jpeg: true, png: true, gif: true, bmp: true, ico: true, webp: wasm || webpCanvas, avif: wasm || avifCanvas };
    return { wasm, webpNative, avifNative, workers: wasm ? POOL_SIZE : 0, encode, heic: wasm };
  })();

  // ------------------------------------------------------------------ offline warm-up
  // Once the page is idle, fetch and compile every codec in the background (AVIF encoder last) and
  // share them with all workers, so every format keeps working if the connection drops.
  let warmDone = null, warmList;
  const warmed = new Promise((resolve) => { warmDone = () => { warmDone = null; resolve(true); }; });
  function scheduleWarm() {
    const go = () => {
      const c = navigator.connection;
      const saveData = c && c.saveData;
      const list = saveData ? ['squoosh_resize_bg.wasm', 'mozjpeg_enc.wasm', 'squoosh_oxipng_bg.wasm'] : null; // null = everything
      warmList = list;
      if (slots[0]) slots[0].worker.postMessage({ type: 'warm', list });
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 5000 }); else setTimeout(go, 2000);
  }

  // ------------------------------------------------------------------ inspect
  async function inspect(file) {
    if (!file || typeof file.slice !== 'function') throw new Error(MSG.generic);
    const sn = await sniffFile(file);
    let src = null;
    try { src = await openSource(file, sn); } catch (e) {
      const st = await ready;
      if (st.wasm && (sn.format === 'heic' || sn.format === 'avif' || sn.format === 'webp')) return inspectInWorker(file, sn);
      throw e;
    }
    try {
      const W = src.width, H = src.height;
      if (!W || !H) throw new Error(MSG.nosize);
      // thumbnail (also used for the alpha check)
      const k = Math.min(1, 512 / Math.max(W, H));
      const tw = Math.max(1, Math.round(W * k)), th = Math.max(1, Math.round(H * k));
      const tc = makeCanvas(tw, th);
      const tctx = tc.getContext('2d', { willReadFrequently: true });
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(src.source, 0, 0, tw, th);
      const td = tctx.getImageData(0, 0, tw, th).data;
      let alpha = false;
      for (let i = 3; i < td.length; i += 4) if (td[i] < 255) { alpha = true; break; }
      // colour analysis on full-resolution strips (same sampling as the worker)
      const g = sampleGrid(W, H);
      const sc = makeCanvas(g.sw, g.ys.length);
      const sctx = sc.getContext('2d', { willReadFrequently: true });
      sctx.imageSmoothingEnabled = false;
      for (let i = 0; i < g.ys.length; i++) sctx.drawImage(src.source, g.sx, g.ys[i], g.sw, 1, 0, i, g.sw, 1);
      const cls = classifyRows(sctx.getImageData(0, 0, g.sw, g.ys.length).data, g.sw, g.ys.length);
      sc.width = sc.height = 1;
      const thumbUrl = await thumbUrlOf(tc, alpha);
      const info = { width: W, height: H, format: sn.format, alpha, bytes: file.size, colours: cls.colours, thumbUrl, animated: sn.animated };
      inspected.set(file, info);
      return info;
    } finally { src.close(); }
  }

  function thumbUrlOf(canvas, alpha) {
    return new Promise((resolve) => {
      canvas.toBlob((b) => { canvas.width = canvas.height = 1; resolve(b ? URL.createObjectURL(b) : ''); }, alpha ? 'image/png' : 'image/jpeg', 0.85);
    });
  }

  async function inspectInWorker(file, sn) {
    const r = await runJob('decode', file, { key: idOf(file), settings: {}, hint: null }, {});
    const t = r.thumb;
    const c = makeCanvas(t.width, t.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.buffer), t.width, t.height), 0, 0);
    const thumbUrl = await thumbUrlOf(c, r.alpha);
    const info = { width: r.width, height: r.height, format: r.format || sn.format, alpha: r.alpha, bytes: file.size, colours: r.colours, thumbUrl, animated: r.animated };
    inspected.set(file, info);
    return info;
  }

  // ------------------------------------------------------------------ process / compare
  async function svgPlan(file, s) {
    let info = inspected.get(file);
    let W, H;
    if (info) { W = info.width; H = info.height; } else { const r = await loadImage(file, true); W = r.width; H = r.height; }
    const p = plan(W, H, s);
    return { W, H, w: p.w, h: p.h };
  }

  async function prepare(file, settings) {
    if (!file || typeof file.slice !== 'function') throw new Error(MSG.generic);
    const st = await ready;
    const s = normaliseSettings(settings);
    const sn = await sniffFile(file);
    const id = idOf(file);
    let key = id, svgSize = null;
    if (sn.format === 'svg') { svgSize = await svgPlan(file, s); key = id + '@' + svgSize.w + 'x' + svgSize.h; }
    const info = inspected.get(file);
    const hint = info ? { colours: info.colours } : null;
    return { st, s, sn, id, key, svgSize, hint };
  }

  async function process(file, settings, opts) {
    opts = opts || {};
    const t0 = performance.now();
    const { s, sn, id, key, svgSize, hint } = await prepare(file, settings);
    let r;
    if (mode === 'wasm') {
      r = await runJob('process', file, { key, settings: s, hint, svgSize }, opts);
    } else {
      fbRunning.set(id, key);
      try { r = await fallback.process(file, s, opts, sn, key, svgSize, hint); } finally { fbRunning.delete(id); }
      if (r.out) { r.buffer = r.out; delete r.out; }
    }
    let blob;
    const mime = FORMATS[r.format].mime;
    if (r.buffer) blob = r.buffer instanceof Blob ? r.buffer : new Blob([r.buffer], { type: mime });
    else blob = file.type === mime ? file : new Blob([file], { type: mime });
    const url = URL.createObjectURL(blob);
    if (lastUrl.has(id)) URL.revokeObjectURL(lastUrl.get(id));
    lastUrl.set(id, url);
    return {
      blob, url, width: r.width, height: r.height, format: r.format, quality: r.quality == null ? null : r.quality,
      colors: r.colors == null ? null : r.colors, bytes: blob.size, notes: r.notes || [], kept: !!r.kept,
      ms: Math.round(performance.now() - t0),
    };
  }

  async function compare(file, settings, opts) {
    opts = opts || {};
    const { s, sn, id, key, svgSize, hint } = await prepare(file, settings);
    let r;
    if (mode === 'wasm') r = await runJob('compare', file, { key, settings: s, hint, svgSize }, opts);
    else {
      fbRunning.set(id, key);
      try { r = await fallback.compare(file, s, opts, sn, key, svgSize, hint); } finally { fbRunning.delete(id); }
    }
    return r.results;
  }

  const fbRunning = new Map(); // fallback: file id -> key in progress

  function cancel(file) {
    const id = fileIds.get(file);
    if (!id) return;
    if (mode === 'fallback') { if (fbRunning.has(id)) fallback.cancel(fbRunning.get(id)); return; }
    for (const slot of slots) {
      for (const job of slot.queue.slice()) if (job.fileId === id) cancelJob(job);
      if (slot.current && slot.current.fileId === id) cancelJob(slot.current);
    }
  }

  /** Forget a file: drop its cached pixels and revoke its last result URL. */
  function release(file) {
    const id = fileIds.get(file);
    if (!id) return;
    cancel(file);
    if (lastUrl.has(id)) { URL.revokeObjectURL(lastUrl.get(id)); lastUrl.delete(id); }
    const info = inspected.get(file);
    if (info && info.thumbUrl) URL.revokeObjectURL(info.thumbUrl);
    inspected.delete(file);
    if (mode === 'fallback') fallback.drop(id);
    const i = assign.get(id);
    if (i !== undefined && slots[i]) { slots[i].worker.postMessage({ type: 'drop', key: id }); slots[i].assigned--; assign.delete(id); }
  }

  /** Start fetching the codecs a format needs (e.g. when the user picks AVIF). */
  async function preload(format) {
    const st = await ready;
    if (!st.wasm) return;
    for (const s of slots) s.worker.postMessage({ type: 'preload', format: format === 'auto' ? 'webp' : format });
  }

  function outName(name, format) {
    const base = String(name || 'image').replace(/\.[^.\\/]+$/, '') || 'image';
    const ext = FORMATS[format] ? FORMATS[format].ext : String(format || 'png');
    return base + '.' + ext;
  }

  window.Pinch = {
    version: 2,
    ready,
    warmed,
    FORMATS,
    inspect,
    process,
    compare,
    cancel,
    release,
    preload,
    zip,
    bytes,
    outName,
    get mode() { return mode; },
  };
})();
