// Colour reduction for PNG-with-fewer-colours and GIF.
// Palette: UPNG.js k-d tree quantiser (MIT). Mapping: exact when the picture already fits,
// UPNG's own mapping for graphics, Floyd-Steinberg (serpentine) dithering for photos.
import UPNG from 'upng-js';

/**
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} colors   palette size, 2..256
 * @param {{dither?:boolean, binaryAlpha?:boolean}} opts
 * @returns {{data:Uint8Array, index:Uint8Array, palette:number[][]}}
 *   data = RGBA using only palette colours, index = palette index per pixel, palette = [[r,g,b,a]...]
 */
export function quantize(rgba, width, height, colors, opts = {}) {
  const n = width * height;
  let src = rgba;
  if (opts.binaryAlpha) {
    src = new Uint8Array(rgba);
    for (let i = 3; i < src.length; i += 4) {
      if (src[i] < 128) { src[i - 3] = src[i - 2] = src[i - 1] = src[i] = 0; } else src[i] = 255;
    }
  }

  // 1. Already few enough colours? Use them exactly.
  const exact = exactPalette(src, n, colors);
  if (exact) return exact;

  // 2. Build a palette.
  const buf = src.byteOffset === 0 && src.byteLength === src.buffer.byteLength ? src.buffer : src.slice().buffer;
  const res = UPNG.quantize([buf], colors, !!opts.binaryAlpha);
  const palette = res.plte.map((l) => {
    const c = l.est.rgba >>> 0;
    return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];
  });
  const lookup = new Map();
  palette.forEach((p, i) => lookup.set(((p[3] << 24) | (p[2] << 16) | (p[1] << 8) | p[0]) >>> 0, i));

  if (!opts.dither) {
    const out = new Uint8Array(res.bufs[0]);
    const o32 = new Uint32Array(out.buffer);
    const index = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let k = lookup.get(o32[i]);
      if (k === undefined) { k = nearest(palette, out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]); }
      index[i] = k;
    }
    return { data: out, index, palette };
  }
  return dither(src, width, height, palette);
}

function exactPalette(src, n, colors) {
  const u32 = new Uint32Array(src.buffer, src.byteOffset, n);
  const map = new Map();
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let c = u32[i];
    if ((c >>> 24) === 0) c = 0; // all fully transparent pixels are one colour
    let k = map.get(c);
    if (k === undefined) {
      if (map.size >= colors) return null;
      k = map.size; map.set(c, k);
    }
    index[i] = k;
  }
  const palette = [];
  map.forEach((k, c) => { palette[k] = [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24]; });
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const p = palette[index[i]]; data.set(p, i * 4); }
  return { data, index, palette };
}

function nearest(palette, r, g, b, a) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r, dg = p[1] - g, db = p[2] - b, da = p[3] - a;
    // weight colour differences by visibility (alpha), alpha difference counts fully
    const d = (dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * ((p[3] + a) / 510) + da * da;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function dither(src, w, h, palette) {
  const n = w * h;
  const data = new Uint8Array(n * 4);
  const index = new Uint8Array(n);
  const cache = new Int16Array(1 << 20).fill(-1); // 5 bits per channel
  const STRENGTH = 0.85;
  let errCur = new Float32Array((w + 2) * 3), errNext = new Float32Array((w + 2) * 3);
  for (let y = 0; y < h; y++) {
    const ltr = (y & 1) === 0;
    errNext.fill(0);
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = y * w + x, o = i * 4, e = (x + 1) * 3;
      const a = src[o + 3];
      let r = src[o], g = src[o + 1], b = src[o + 2];
      if (a > 0) {
        r = clamp8(r + errCur[e]); g = clamp8(g + errCur[e + 1]); b = clamp8(b + errCur[e + 2]);
      }
      const key = ((r >> 3) << 15) | ((g >> 3) << 10) | ((b >> 3) << 5) | (a >> 3);
      let pi = cache[key];
      if (pi < 0) { pi = nearest(palette, r, g, b, a); cache[key] = pi; }
      const p = palette[pi];
      index[i] = pi;
      data[o] = p[0]; data[o + 1] = p[1]; data[o + 2] = p[2]; data[o + 3] = p[3];
      if (a === 0 || p[3] === 0) continue;
      const er = (r - p[0]) * STRENGTH, eg = (g - p[1]) * STRENGTH, eb = (b - p[2]) * STRENGTH;
      const fwd = ltr ? 3 : -3;
      // Floyd-Steinberg: 7/16 ahead, 3/16 behind-below, 5/16 below, 1/16 ahead-below
      add(errCur, e + fwd, er, eg, eb, 7 / 16);
      add(errNext, e - fwd, er, eg, eb, 3 / 16);
      add(errNext, e, er, eg, eb, 5 / 16);
      add(errNext, e + fwd, er, eg, eb, 1 / 16);
    }
    const t = errCur; errCur = errNext; errNext = t;
  }
  return { data, index, palette };
}

function add(buf, e, r, g, b, k) { buf[e] += r * k; buf[e + 1] += g * k; buf[e + 2] += b * k; }
function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
