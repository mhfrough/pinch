// The processing pipeline: format choice, geometry, resampling, encoding, target-size search,
// "keep the original" check and user-facing notes. It is backend-agnostic: the worker runs it
// with WebAssembly codecs, the fallback runs it on the main thread with canvas encoders.
//
// ops = {
//   resize(img, w, h, method) -> img          method: 'down' | 'smooth' | 'sharp' | 'pixel'
//   encode(img, fmt, { quality, lossless, colors, dither }) -> Uint8Array | Blob
//   progress({ stage, progress, message })
//   check()                                    throws if the job was cancelled
//   original() -> Promise<Uint8Array>          the untouched input file
// }
// img = { data: Uint8ClampedArray RGBA, width, height }

import { FORMATS, ICO_SIZES, labelOf, bytes } from './constants.js';
import { plan } from './geometry.js';
import { flatten, padSquare, icoContainer } from './writers.js';
import { stripMetadata } from './metadata.js';

const KEEPABLE = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'bmp']);
const STEP = 0.85;

export const sizeOf = (b) => (b ? (b.byteLength !== undefined ? b.byteLength : b.size) : 0);

async function toBytes(b) {
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  return new Uint8Array(await b.arrayBuffer());
}

/**
 * Auto rule:
 *  - 'graphic' (few colours or mostly flat areas: logos, icons, screenshots, charts, pixel art) -> PNG.
 *    PNG is lossless; OxiPNG writes a palette PNG automatically when the picture has <= 256 colours.
 *    (A non-zero settings.pngColors still applies.)
 *  - 'photo' (everything else, including cut-out photos with transparency) -> lossy WebP at the
 *    chosen quality; WebP keeps transparency.
 */
export function chooseFormat(s, info) {
  if (s.format === 'auto') return info.colours === 'graphic' ? 'png' : 'webp';
  if (s.format === 'same') return FORMATS[info.format] && info.format !== 'ico' ? info.format : 'png';
  return s.format;
}

function upMethod(src, w, h, s) {
  if (w === src.width && h === src.height) return null;
  return w <= src.width && h <= src.height ? 'down' : s.upscale.method;
}

function makeResizer(src, s, ops) {
  let last = null;
  return async (w, h) => {
    const m = upMethod(src, w, h, s);
    if (!m) return src;
    if (last && last.width === w && last.height === h) return last;
    ops.progress({ stage: 'resize', progress: 0.15, message: 'Resizing to ' + w + ' x ' + h + ' px' });
    last = await ops.resize(src, w, h, m);
    ops.check();
    return last;
  };
}

function makeEncoder(s, info, ops) {
  let flatSrc = null, flatOut = null;
  return async (img, fmt, quality, colors, fast) => {
    let im = img;
    if (!FORMATS[fmt].alpha && info.alpha) {
      if (flatSrc !== img) { flatOut = flatten(img, s.background); flatSrc = img; }
      im = flatOut;
    }
    const lossless = s.lossless && (fmt === 'webp' || fmt === 'avif');
    const out = await ops.encode(im, fmt, { quality, lossless, colors: colors || 0, dither: info.colours === 'photo', fast: !!fast });
    ops.check();
    return out;
  };
}

export async function runPipeline(ctx, ops) {
  const { src, info, settings: s } = ctx;
  const fmt = chooseFormat(s, info);
  const F = FORMATS[fmt];
  if (!F) throw new Error('Pick an output format.');
  const p = plan(info.origW, info.origH, s);
  const notes = p.notes.slice();
  if (s.format === 'auto') {
    notes.push(fmt === 'png'
      ? 'Auto picked PNG because this looks like a graphic (flat colours), which PNG keeps sharp.'
      : 'Auto picked WebP because this looks like a photo' + (info.alpha ? ' (WebP keeps the transparency).' : '.'));
  }
  if (info.alpha && !F.alpha) notes.push(F.label + ' has no transparency, so see-through parts are filled with ' + s.background + '.');
  if (info.alpha && fmt === 'gif') notes.push('GIF transparency is on or off only, so soft edges become hard.');
  if (info.animated) notes.push('Only the first frame of the animated ' + labelOf(info.format) + ' is kept.');
  if (s.lossless && fmt === 'jpeg') notes.push('JPG is always lossy, so the quality setting is used.');

  const resizeTo = makeResizer(src, s, ops);
  const encode = makeEncoder(s, info, ops);

  // ---------------------------------------------------------------- ICO
  if (fmt === 'ico') {
    const base = await resizeTo(p.w, p.h);
    const longest = Math.max(base.width, base.height);
    let sizes = ICO_SIZES.filter((z) => z <= longest);
    if (!sizes.length) sizes = [16];
    const entries = [];
    for (let i = 0; i < sizes.length; i++) {
      const z = sizes[i];
      ops.progress({ stage: 'encode', progress: 0.2 + 0.75 * i / sizes.length, message: 'Icon ' + z + ' px' });
      const k = Math.min(z / base.width, z / base.height);
      const dw = Math.max(1, Math.round(base.width * k)), dh = Math.max(1, Math.round(base.height * k));
      const m = upMethod(base, dw, dh, s);
      const scaled = m ? await ops.resize(base, dw, dh, m) : base;
      const png = await ops.encode(padSquare(scaled, z), 'png', { colors: 0 });
      entries.push({ size: z, png: await toBytes(png) });
      ops.check();
    }
    notes.push('Icon sizes inside: ' + sizes.join(', ') + ' px.');
    if (s.target) notes.push('A target size does not apply to icons.');
    const top = sizes[sizes.length - 1];
    return { out: icoContainer(entries), format: fmt, width: top, height: top, quality: null, notes, kept: false };
  }

  // ---------------------------------------------------------------- everything else
  const lossy = F.lossy && !(s.lossless && (fmt === 'webp' || fmt === 'avif'));
  let out, quality = s.quality, colors = fmt === 'png' ? s.pngColors : 0, img;

  if (!s.target) {
    img = await resizeTo(p.w, p.h);
    ops.progress({ stage: 'encode', progress: 0.3, message: 'Encoding ' + F.label });
    out = await encode(img, fmt, quality, colors);
  } else {
    const r = await fitTarget({ p, fmt, lossy, s, resizeTo, encode, ops });
    out = r.out; quality = r.quality; colors = r.colors; img = r.img;
    const T = bytes(s.target);
    if (sizeOf(out) > s.target) notes.push('Could not reach ' + T + '. This is the smallest Pinch could make it (' + bytes(sizeOf(out)) + ').');
    else if (lossy && r.searched) notes.push('Quality ' + quality + ' fits under ' + T + '.');
    else if (fmt === 'png' && colors && colors !== s.pngColors) notes.push('Reduced to ' + colors + ' colours to fit under ' + T + '.');
    else if (!r.scaled) notes.push('Fits under ' + T + '.');
    if (r.scaled) notes.push('Made smaller (' + img.width + ' x ' + img.height + ' px) to fit under ' + T + '.');
  }

  // ---------------------------------------------------------------- keep the original?
  const size = sizeOf(out);
  const sameShape = img.width === info.origW && img.height === info.origH && !info.decodeCapped;
  if (sameShape && KEEPABLE.has(info.format) && (fmt === info.format || s.format === 'auto') &&
      info.bytes <= size && (!s.target || info.bytes <= s.target)) {
    const orig = await ops.original();
    const st = s.stripMetadata ? stripMetadata(orig, info.format) : { bytes: orig, changed: false };
    if (st && st.bytes.length <= size) {
      const kNotes = ['Already as small as these settings can make it, so the original is kept.'];
      if (st.changed) kNotes.push('Hidden details (camera, location, comments) were removed from it.');
      return { out: st.changed ? st.bytes : null, format: info.format, width: info.origW, height: info.origH, quality: null, notes: kNotes, kept: true };
    }
  }

  return { out, format: fmt, width: img.width, height: img.height, quality: lossy ? quality : null, colors: fmt === 'png' ? colors : null, notes, kept: false };
}

async function fitTarget({ p, fmt, lossy, s, resizeTo, encode, ops }) {
  const target = s.target;
  const hiQ = s.quality, loQ = Math.min(30, hiQ);
  let scale = 1, best = null, smallest = null, attempts = 0;
  // AVIF is slow: search with a faster encoder speed, then re-encode the winner at normal speed.
  const fast = fmt === 'avif';
  const keepSmallest = (r) => { if (!smallest || sizeOf(r.out) < sizeOf(smallest.out)) smallest = r; };
  const tick = (msg) => ops.progress({ stage: 'search', progress: 0.2 + 0.75 * Math.min(1, attempts++ / 14), message: msg });

  for (let round = 0; round < 30; round++) {
    const w = Math.max(1, Math.round(p.w * scale)), h = Math.max(1, Math.round(p.h * scale));
    const img = await resizeTo(w, h);
    let atScale = null; // smallest output at this scale
    if (lossy) {
      tick('Trying quality ' + hiQ);
      let o = await encode(img, fmt, hiQ, 0, fast);
      atScale = { out: o, quality: hiQ, img };
      if (sizeOf(o) <= target) { best = { out: o, quality: hiQ, img, searched: false }; }
      else {
        let lo = loQ, hi = hiQ - 1, iters = fmt === 'avif' ? 5 : 7;
        while (lo <= hi && iters-- > 0) {
          const mid = Math.round((lo + hi) / 2);
          tick('Trying quality ' + mid);
          o = await encode(img, fmt, mid, 0, fast);
          if (sizeOf(o) <= target) { best = { out: o, quality: mid, img, searched: true }; lo = mid + 1; }
          else { if (sizeOf(o) < sizeOf(atScale.out)) atScale = { out: o, quality: mid, img }; hi = mid - 1; }
        }
        if (!best && atScale.quality !== loQ) {
          tick('Trying quality ' + loQ);
          o = await encode(img, fmt, loQ, 0, fast);
          if (sizeOf(o) <= target) best = { out: o, quality: loQ, img, searched: true };
          else atScale = { out: o, quality: loQ, img };
        }
      }
      if (best) {
        if (fast) {
          tick('Finishing at quality ' + best.quality);
          const fin = await encode(img, fmt, best.quality, 0, false);
          if (sizeOf(fin) <= target) best.out = fin;
        }
        return { out: best.out, quality: best.quality, colors: 0, img, scaled: scale < 1, searched: best.searched };
      }
      keepSmallest(atScale);
    } else if (fmt === 'png') {
      const ladder = [0, 256, 128, 64, 32, 16];
      const start = Math.max(0, ladder.indexOf(s.pngColors));
      for (let i = start; i < ladder.length; i++) {
        tick(ladder[i] ? 'Trying ' + ladder[i] + ' colours' : 'Trying lossless');
        const o = await encode(img, fmt, 0, ladder[i]);
        atScale = { out: o, colors: ladder[i], img };
        if (sizeOf(o) <= target) return { out: o, quality: null, colors: ladder[i], img, scaled: scale < 1 };
      }
      keepSmallest(atScale);
    } else {
      tick('Trying ' + w + ' x ' + h + ' px');
      const o = await encode(img, fmt, hiQ, 0);
      atScale = { out: o, quality: hiQ, img };
      if (sizeOf(o) <= target) return { out: o, quality: lossy ? hiQ : null, colors: 0, img, scaled: scale < 1 };
      keepSmallest(atScale);
    }
    // Still too big: scale down in 0.85 steps. File size grows roughly with area, so jump
    // straight to the number of steps the size ratio suggests (always at least one).
    const ratio = target / sizeOf(atScale.out);
    const steps = Math.max(1, Math.ceil(Math.log(ratio) / Math.log(STEP * STEP)));
    scale *= Math.pow(STEP, steps);
    if (p.w * scale < 8 || p.h * scale < 8) break;
  }
  const r = smallest;
  return { out: r.out, quality: r.quality || null, colors: r.colors || 0, img: r.img, scaled: r.img.width !== p.w, searched: true };
}

/** Encode the picture as JPEG, WebP, PNG and (unless skipped) AVIF with the current settings. */
export async function compareFormats(ctx, ops) {
  const { src, info, settings: s } = ctx;
  const p = plan(info.origW, info.origH, s);
  const img = await makeResizer(src, s, ops)(p.w, p.h);
  const encode = makeEncoder(s, info, ops);
  const order = ['jpeg', 'webp', 'png'];
  if (!s.skipAvif) order.push('avif');
  const results = {};
  for (let i = 0; i < order.length; i++) {
    const f = order[i];
    ops.progress({ stage: 'compare', progress: i / order.length, message: 'Trying ' + FORMATS[f].label, format: f });
    const t0 = Date.now();
    try {
      const out = await encode(img, f, s.quality, f === 'png' ? s.pngColors : 0);
      results[f] = { bytes: sizeOf(out), ms: Date.now() - t0 };
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      results[f] = { error: (e && e.message) || String(e) };
    }
    ops.progress({ stage: 'compare', progress: (i + 1) / order.length, format: f, result: results[f] });
  }
  if (s.skipAvif) results.avif = { skipped: true };
  return { results, width: img.width, height: img.height };
}
