// Pinch codec worker (module worker). Decodes a file once, keeps its RGBA in an LRU cache so that
// changing settings only re-encodes, and runs the shared pipeline with WebAssembly codecs.
//
// Messages in:
//   { type: 'hello' }
//   { type: 'process' | 'compare' | 'decode', job, key, file, settings, hint?, pixels? }
//   { type: 'drop', key }            forget a cached picture
//   { type: 'preload', format }      fetch the codecs a format needs
//   { type: 'share', name, value }   a codec compiled by another worker (WebAssembly.Module, or Blob for heif.js)
//   { type: 'warm', list }           fetch + compile codecs in the background (offline readiness)
// Messages out:
//   { type: 'share', name, value }   a codec this worker compiled, for the main thread to pass on
//   { type: 'warmed' }
//   { type: 'hello', wasm, offscreen }
//   { type: 'progress', job, stage, progress, message }
//   { type: 'need-pixels', job }     main thread must decode (SVG, or no OffscreenCanvas) and resend with pixels
//   { type: 'result', job, result }  result.buffer is transferred
//   { type: 'error', job, message }

import { FORMATS, normaliseSettings } from '../shared/constants.js';
import { capSize } from '../shared/geometry.js';
import { sniff } from '../shared/sniff.js';
import { classifyRGBA, hasAlpha } from '../shared/analyse.js';
import { runPipeline, compareFormats } from '../shared/pipeline.js';
import { encodeBmp, ownBuffer } from '../shared/writers.js';
import { resample } from '../shared/resample.js';
import { quantize } from '../shared/quant.js';
import { GIFEncoder } from 'gifenc';
import * as C from './codecs.js';

const CACHE_LIMIT = 300 * 1024 * 1024;
const cache = new Map(); // key -> { src, info, size }
let cacheBytes = 0;

function cacheGet(key) {
  const e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); }
  return e;
}
function cacheDrop(key) {
  const e = cache.get(key);
  if (e) { cacheBytes -= e.size; cache.delete(key); }
}
function cachePut(key, e) {
  cacheDrop(key);
  e.size = e.src.data.byteLength;
  for (const k of cache.keys()) {
    if (cacheBytes + e.size <= CACHE_LIMIT) break;
    cacheDrop(k);
  }
  cache.set(key, e);
  cacheBytes += e.size;
}

let currentJob = null;
const post = (m, t) => self.postMessage(m, t || []);
const progress = (job, p) => post(Object.assign({ type: 'progress', job }, p));

C.setLoadNotifier((key, label) => {
  if (currentJob != null) progress(currentJob, { stage: 'load', progress: 0.05, message: 'Loading the ' + label + ' (first use only)', codec: key });
});
// share every compiled codec with the main thread, which hands it to the other workers
C.setSharer((name, value) => post({ type: 'share', name, value }));

function wasmOk() {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  } catch (e) { return false; }
}

// ------------------------------------------------------------------ decoding

const UNSUPPORTED = {
  tiff: 'Pinch can\'t open TIFF files. Save it as PNG or JPG in another app first.',
  heic: 'This HEIC photo could not be opened. On an iPhone, set Camera > Formats to "Most Compatible", or share the photo as JPG first.',
};
const GENERIC = 'This file is not a picture Pinch can open. JPG, PNG, WebP, AVIF, GIF, BMP, ICO, SVG and HEIC work.';
const DAMAGED = 'This picture seems to be damaged, so it can\'t be read. Try opening it in another app and saving it again.';

async function decodeFile(file, job) {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const sn = sniff(head, file);
  const fmt = sn.format;
  if (fmt === 'svg') return { needPixels: true };
  const canCanvas = typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
  let img = null, origW = 0, origH = 0, capped = false;

  if (canCanvas && fmt !== 'tiff') {
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none' }); } catch (e) { bmp = null; }
    if (bmp) {
      origW = bmp.width; origH = bmp.height;
      const c = capSize(origW, origH);
      if (c.capped) {
        const small = await createImageBitmap(bmp, { resizeWidth: c.w, resizeHeight: c.h, resizeQuality: 'high' });
        bmp.close(); bmp = small; capped = true;
      }
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      img = { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
      bmp.close();
    }
  }

  if (!img) {
    progress(job, { stage: 'decode', progress: 0.02, message: 'Opening ' + (fmt ? fmt.toUpperCase() : 'file') });
    try {
      if (fmt === 'heic') img = await decodeHeic(file);
      else if (fmt === 'avif') img = (await C.decodeAvif())(await file.arrayBuffer());
      else if (fmt === 'webp') img = (await C.decodeWebp())(await file.arrayBuffer());
    } catch (e) {
      if (/Could not load/.test(e.message)) throw e;
      throw new Error(UNSUPPORTED[fmt] || DAMAGED);
    }
    if (!img) {
      if (!canCanvas && fmt && fmt !== 'tiff' && fmt !== 'heic') return { needPixels: true };
      throw new Error(UNSUPPORTED[fmt] || (fmt ? DAMAGED : GENERIC));
    }
    img = { data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), width: img.width, height: img.height };
    origW = img.width; origH = img.height;
    const c = capSize(origW, origH);
    if (c.capped) { img = await lanczos(img, c.w, c.h, hasAlpha(img.data)); capped = true; }
  }
  return { src: img, info: { origW, origH, format: fmt, animated: sn.animated, bytes: file.size, decodeCapped: capped } };
}

async function decodeHeic(file) {
  const lib = await C.heif();
  const decoder = new lib.HeifDecoder();
  let images = [];
  try {
    images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
    if (!images || !images.length) throw new Error('No image in HEIC');
    const image = images[0];
    const w = image.get_width(), h = image.get_height();
    const out = new ImageData(w, h);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
    await new Promise((resolve, reject) => {
      image.display(out, (d) => (d ? resolve(d) : reject(new Error('HEIC decode failed'))));
    });
    return out;
  } finally {
    for (const im of images || []) { try { im.free(); } catch (e) { /* ignore */ } }
    try { if (decoder.decoder) lib.heif_context_free(decoder.decoder); } catch (e) { /* ignore */ }
  }
}

async function entryFor(m) {
  let e = cacheGet(m.key);
  if (e) return e;
  if (m.pixels) {
    const p = m.pixels;
    e = {
      src: { data: new Uint8ClampedArray(p.buffer), width: p.width, height: p.height },
      info: { origW: p.origW || p.width, origH: p.origH || p.height, format: p.format, animated: !!p.animated, bytes: m.file ? m.file.size : 0, decodeCapped: !!p.decodeCapped },
    };
  } else {
    progress(m.job, { stage: 'decode', progress: 0.02, message: 'Opening the picture' });
    e = await decodeFile(m.file, m.job);
    if (e.needPixels) return null;
  }
  e.info.alpha = hasAlpha(e.src.data);
  const cls = classifyRGBA(e.src.data, e.src.width, e.src.height);
  e.info.colours = cls.colours;
  e.info.distinct = cls.distinct;
  cachePut(m.key, e);
  return e;
}

// ------------------------------------------------------------------ resampling

// Lanczos3 via @jsquash/resize in sRGB space (linear-light resampling was ~5x slower), premultiplied
// only when the picture has transparency.
async function lanczos(img, w, h, alpha) {
  const rz = await C.resizer();
  const d = img.data;
  const r = rz(new Uint8Array(d.buffer, d.byteOffset, d.byteLength), img.width, img.height, w, h, 3, !!alpha, false);
  return { data: new Uint8ClampedArray(r.buffer, r.byteOffset, r.byteLength), width: w, height: h };
}

async function resize(img, w, h, method, alpha) {
  if (method === 'down' || method === 'smooth') return lanczos(img, w, h, alpha);
  if (method === 'sharp') return resample(img, w, h, 'mks2021', alpha); // Magic Kernel Sharp 2021
  // 'pixel': hqx by the nearest whole factor (2-4), then Lanczos3 to the exact size
  let k = Math.max(1, Math.min(4, Math.round(Math.max(w / img.width, h / img.height))));
  while (k > 1 && img.width * img.height * k * k > 64e6) k--;
  let cur = img;
  if (k >= 2) {
    const hq = await C.hqx();
    let d = img.data;
    if (d.byteOffset % 4) d = d.slice();
    const r = hq(new Uint32Array(d.buffer, d.byteOffset, img.width * img.height), img.width, img.height, k);
    cur = { data: new Uint8ClampedArray(r.buffer, r.byteOffset, r.byteLength), width: img.width * k, height: img.height * k };
  }
  return cur.width === w && cur.height === h ? cur : lanczos(cur, w, h, alpha);
}

// ------------------------------------------------------------------ encoding

// jsquash AVIF quality runs 0-100 but sits higher than JPEG/WebP for the same look and size;
// map Pinch's 1-100 so the same number gives a similar visual quality across formats.
export function avifQuality(q) { return Math.max(1, Math.min(100, Math.round(q <= 90 ? q * 0.75 : 67.5 + (q - 90) * 3.25))); }

const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

async function encode(img, fmt, o) {
  const { width: w, height: h } = img;
  switch (fmt) {
    case 'jpeg': return u8((await C.jpeg())(img, { quality: o.quality, progressive: true, optimize_coding: true }));
    case 'webp': {
      const opts = o.lossless ? { lossless: 1, quality: 50, method: 3, exact: 0 } : { quality: o.quality, method: 4 };
      return u8((await C.webp())(img, opts));
    }
    case 'avif': {
      let opts = { speed: o.fast ? 9 : 6, quality: avifQuality(o.quality) };
      if (o.lossless) opts = Object.assign(opts, { lossless: true, quality: 100, qualityAlpha: -1, subsample: 3 });
      const r = (await C.avif())(img, opts);
      if (!r) throw new Error('The AVIF encoder failed on this picture. Try WebP instead.');
      return u8(r);
    }
    case 'png': {
      const opt = await C.oxipng();
      const d = o.colors ? quantize(img.data, w, h, o.colors, { dither: o.dither }).data : img.data;
      return u8(opt(new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength), w, h, 2, false, true));
    }
    case 'gif': {
      const q = quantize(img.data, w, h, 256, { dither: o.dither, binaryAlpha: true });
      const t = q.palette.findIndex((p) => p[3] === 0);
      const gif = GIFEncoder();
      gif.writeFrame(q.index, w, h, {
        palette: q.palette.map((p) => [p[0], p[1], p[2]]),
        transparent: t >= 0, transparentIndex: t >= 0 ? t : 0, repeat: -1,
      });
      gif.finish();
      return gif.bytes();
    }
    case 'bmp': return encodeBmp(img);
    default: throw new Error('Unknown format ' + fmt);
  }
}

function opsFor(m, entry, original) {
  return {
    resize: (img, w, h, method) => resize(img, w, h, method, entry.info.alpha),
    encode,
    progress: (p) => progress(m.job, p),
    check() {},
    original,
  };
}

// ------------------------------------------------------------------ messages

function friendly(e) {
  const msg = (e && e.message) || String(e);
  if (/memory|allocation|RangeError|out of bounds/i.test(msg)) return 'This picture is too big for the browser\'s memory. Try a smaller size or close other tabs.';
  return msg;
}

async function thumbOf(entry) {
  const { src } = entry;
  const k = Math.min(1, 512 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const t = k < 1 ? await lanczos(src, w, h, entry.info.alpha) : { data: src.data.slice(), width: w, height: h };
  return t;
}

let chain = Promise.resolve();
self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'hello') { post({ type: 'hello', wasm: wasmOk(), offscreen: typeof OffscreenCanvas !== 'undefined' }); return; }
  if (m.type === 'drop') { cacheDrop(m.key); return; }
  if (m.type === 'preload') { C.preload(m.format).catch(() => {}); return; }
  if (m.type === 'share') { C.receive(m.name, m.value); return; }
  if (m.type === 'warm') { C.warm(m.list).then(() => post({ type: 'warmed' })); return; }
  // one job at a time per worker
  chain = chain.then(() => handle(m));
};

async function handle(m) {
  currentJob = m.job;
  try {
    const entry = await entryFor(m);
    if (!entry) { post({ type: 'need-pixels', job: m.job }); return; }
    if (m.hint && m.hint.colours) entry.info.colours = m.hint.colours;
    const s = normaliseSettings(m.settings);
    const original = async () => new Uint8Array(await m.file.arrayBuffer());
    const ops = opsFor(m, entry, original);
    if (m.type === 'decode') {
      const t = await thumbOf(entry);
      const i = entry.info;
      post({ type: 'result', job: m.job, result: {
        width: i.origW, height: i.origH, format: i.format, alpha: i.alpha, colours: i.colours, animated: i.animated,
        thumb: { buffer: t.data.buffer, width: t.width, height: t.height },
      } }, [t.data.buffer]);
    } else if (m.type === 'compare') {
      const r = await compareFormats({ src: entry.src, info: entry.info, settings: s }, ops);
      post({ type: 'result', job: m.job, result: r });
    } else {
      const r = await runPipeline({ src: entry.src, info: entry.info, settings: s }, ops);
      const buf = r.out ? ownBuffer(r.out) : null;
      delete r.out;
      r.buffer = buf ? buf.buffer : null;
      r.mime = FORMATS[r.format].mime;
      post({ type: 'result', job: m.job, result: r }, buf ? [buf.buffer] : []);
    }
  } catch (e) {
    post({ type: 'error', job: m.job, message: friendly(e) });
  } finally {
    currentJob = null;
  }
}
