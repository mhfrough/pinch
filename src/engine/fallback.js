// The v1 canvas path, kept for browsers without module workers or WebAssembly.
// Runs the same pipeline as the worker, on the main thread, with canvas encoders,
// UPNG.js (PNG), gifenc (GIF) and the pure-JS BMP/ICO writers.
import { FORMATS } from '../shared/constants.js';
import { hasAlpha, classifyRGBA } from '../shared/analyse.js';
import { plan } from '../shared/geometry.js';
import { runPipeline, compareFormats } from '../shared/pipeline.js';
import { encodeBmp } from '../shared/writers.js';
import { makeCanvas, decodePixels } from './decode.js';

const abortError = () => {
  try { return new DOMException('Cancelled', 'AbortError'); } catch (e) { const x = new Error('Cancelled'); x.name = 'AbortError'; return x; }
};

export function createFallback(base) {
  let codecsPromise = null;
  const codecs = () => codecsPromise || (codecsPromise = new Promise((resolve, reject) => {
    if (window.PinchFallbackCodecs) return resolve(window.PinchFallbackCodecs);
    const s = document.createElement('script');
    s.src = new URL('codecs/fallback-codecs.js', base).href;
    s.onload = () => (window.PinchFallbackCodecs ? resolve(window.PinchFallbackCodecs) : reject(new Error('Could not load the PNG/GIF encoders.')));
    s.onerror = () => { codecsPromise = null; reject(new Error('Could not load the PNG/GIF encoders. Check your connection and try again.')); };
    document.head.appendChild(s);
  }));

  // tiny LRU of decoded pictures (main-thread memory is precious)
  const cache = new Map();
  const cancelled = new Set();

  async function entryFor(key, file, sn, svgSize, hint) {
    let e = cache.get(key);
    if (e) { cache.delete(key); cache.set(key, e); return e; }
    const px = await decodePixels(file, sn, svgSize);
    const src = { data: px.data, width: px.width, height: px.height };
    e = {
      src,
      info: {
        origW: svgSize ? svgSize.W : px.origW, origH: svgSize ? svgSize.H : px.origH, format: sn.format, animated: sn.animated,
        bytes: file.size, decodeCapped: px.decodeCapped, alpha: hasAlpha(src.data),
        colours: (hint && hint.colours) || classifyRGBA(src.data, src.width, src.height).colours,
      },
    };
    cache.set(key, e);
    while (cache.size > 2) cache.delete(cache.keys().next().value);
    return e;
  }

  function toCanvas(img) {
    const c = makeCanvas(img.width, img.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height), 0, 0);
    return c;
  }
  const pixelsOf = (c) => ({ data: c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height });

  // High quality canvas resize: halve step by step going down, double step by step going up.
  function resize(img, w, h, method) {
    let cur = toCanvas(img);
    let cw = cur.width, ch = cur.height;
    const draw = (nw, nh, smooth) => {
      const c = makeCanvas(nw, nh);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = smooth;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, 0, 0, nw, nh);
      cur = c; cw = nw; ch = nh;
    };
    if (method === 'down') {
      while (cw / 2 >= w && ch / 2 >= h) draw(Math.round(cw / 2), Math.round(ch / 2), true);
      if (cw !== w || ch !== h) draw(w, h, true);
    } else if (method === 'pixel') {
      const k = Math.max(1, Math.min(4, Math.round(Math.max(w / cw, h / ch))));
      if (k > 1) draw(cw * k, ch * k, false);
      if (cw !== w || ch !== h) draw(w, h, true);
    } else {
      const sharp = method === 'sharp';
      while (cw * 2 <= w && ch * 2 <= h) { draw(cw * 2, ch * 2, true); if (sharp) unsharp(cur, 0.35); }
      if (cw !== w || ch !== h) { draw(w, h, true); if (sharp) unsharp(cur, 0.25); }
    }
    return pixelsOf(cur);
  }

  function blobOf(canvas, mime, q) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) return reject(new Error('The browser could not save this picture.'));
        if (b.type !== mime) {
          const L = FORMATS[Object.keys(FORMATS).find((k) => FORMATS[k].mime === mime)].label;
          return reject(new Error(L + ' saving needs WebAssembly, which this browser has turned off or does not support. Pick JPG or PNG.'));
        }
        resolve(b);
      }, mime, q);
    });
  }

  async function encode(img, fmt, o) {
    switch (fmt) {
      case 'jpeg': case 'webp': case 'avif':
        return blobOf(toCanvas(img), FORMATS[fmt].mime, o.lossless ? 1 : Math.min(1, Math.max(0.01, o.quality / 100)));
      case 'png': {
        const C = await codecs();
        if (o.colors) return C.png(C.quantize(img.data, img.width, img.height, o.colors, { dither: o.dither }).data, img.width, img.height);
        const upng = C.png(img.data, img.width, img.height);
        const native = await blobOf(toCanvas(img), 'image/png');
        return native.size < upng.length ? native : upng;
      }
      case 'gif': {
        const C = await codecs();
        const q = C.quantize(img.data, img.width, img.height, 256, { dither: o.dither, binaryAlpha: true });
        const t = q.palette.findIndex((p) => p[3] === 0);
        const gif = C.GIFEncoder();
        gif.writeFrame(q.index, img.width, img.height, { palette: q.palette.map((p) => [p[0], p[1], p[2]]), transparent: t >= 0, transparentIndex: Math.max(0, t), repeat: -1 });
        gif.finish();
        return gif.bytes();
      }
      case 'bmp': return encodeBmp(img);
      default: throw new Error('Unknown format ' + fmt);
    }
  }

  function opsFor(file, key, onProgress, signal) {
    return {
      resize: async (img, w, h, m) => resize(img, w, h, m),
      encode,
      progress: (p) => { if (onProgress) try { onProgress(p); } catch (e) { /* ignore */ } },
      check() { if (cancelled.has(key) || (signal && signal.aborted)) throw abortError(); },
      original: async () => new Uint8Array(await file.arrayBuffer()),
    };
  }

  async function run(kind, file, s, opts, sn, key, svgSize, hint) {
    cancelled.delete(key);
    const ops = opsFor(file, key, opts.onProgress, opts.signal);
    ops.check();
    ops.progress({ stage: 'decode', progress: 0.02, message: 'Opening the picture' });
    const e = await entryFor(key, file, sn, svgSize, hint);
    await new Promise((r) => setTimeout(r, 0));
    ops.check();
    const ctx = { src: e.src, info: e.info, settings: s };
    return kind === 'compare' ? compareFormats(ctx, ops) : runPipeline(ctx, ops);
  }

  return {
    process: (file, s, opts, sn, key, svgSize, hint) => run('process', file, s, opts, sn, key, svgSize, hint),
    compare: (file, s, opts, sn, key, svgSize, hint) => run('compare', file, s, opts, sn, key, svgSize, hint),
    cancel: (key) => cancelled.add(key),
    drop: (key) => { for (const k of [...cache.keys()]) if (k === key || k.indexOf(key + '@') === 0) cache.delete(k); },
    plan,
  };
}

// 3x3 unsharp (centre-weighted) on the canvas in place. amount 0..1
function unsharp(canvas, amount) {
  const w = canvas.width, h = canvas.height;
  if (w < 3 || h < 3) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const s = img.data;
  const o = new Uint8ClampedArray(s);
  const a = amount, c = 1 + 4 * a;
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    let i = y * row + 4;
    for (let x = 1; x < w - 1; x++, i += 4) {
      o[i] = c * s[i] - a * (s[i - 4] + s[i + 4] + s[i - row] + s[i + row]);
      o[i + 1] = c * s[i + 1] - a * (s[i - 3] + s[i + 5] + s[i - row + 1] + s[i + row + 1]);
      o[i + 2] = c * s[i + 2] - a * (s[i - 2] + s[i + 6] + s[i - row + 2] + s[i + row + 2]);
    }
  }
  img.data.set(o);
  ctx.putImageData(img, 0, 0);
}
