// Picture analysis used for format 'auto'. The same sampling runs on the main thread
// (Pinch.inspect, on strips drawn from an ImageBitmap) and in the worker (on the cached RGBA),
// so both sides classify a picture the same way.

export const SAMPLE_ROWS = 256;
export const SAMPLE_WIDTH = 1024;

/** Which rows / columns to sample from a W x H picture. */
export function sampleGrid(W, H) {
  const rows = Math.min(H, SAMPLE_ROWS);
  const sw = Math.min(W, SAMPLE_WIDTH);
  const sx = Math.floor((W - sw) / 2);
  const ys = [];
  for (let i = 0; i < rows; i++) ys.push(Math.min(H - 1, Math.floor((i + 0.5) * H / rows)));
  return { ys, sx, sw };
}

/**
 * Classify sampled rows. `rowsData` is RGBA for `ys.length` rows of `sw` pixels each,
 * consecutive pixels within a row being neighbours in the full-resolution picture.
 *
 * Rule: a picture is a 'graphic' when it has <= 32 distinct colours, or when at least half of
 * neighbouring pixel pairs are exactly equal (flat areas: logos, screenshots, pixel art, charts),
 * or when it has <= 256 colours and at least a quarter of pairs are equal. Otherwise 'photo'.
 * Fully transparent pixels are ignored (cut-outs are judged on their visible part).
 */
export function classifyRows(rowsData, sw, rows) {
  const u32 = new Uint32Array(rowsData.buffer, rowsData.byteOffset, sw * rows);
  const seen = new Set();
  let pairs = 0, equal = 0, transparent = false;
  for (let r = 0; r < rows; r++) {
    let prev = -1;
    const off = r * sw;
    for (let x = 0; x < sw; x++) {
      const p = u32[off + x];
      // alpha is the top byte on little-endian (every browser we target)
      if ((p >>> 24) === 0) { transparent = true; prev = -1; continue; }
      if (seen.size < 70000) seen.add(p);
      if (prev !== -1) { pairs++; if (p === prev) equal++; }
      prev = p;
    }
  }
  const distinct = seen.size + (transparent ? 1 : 0);
  const eq = pairs ? equal / pairs : 1;
  const graphic = distinct <= 32 || eq >= 0.5 || (distinct <= 256 && eq >= 0.25);
  return { colours: graphic ? 'graphic' : 'photo', distinct, flat: Math.round(eq * 1000) / 1000 };
}

/** Sample and classify a full RGBA buffer (worker side). */
export function classifyRGBA(data, W, H) {
  const { ys, sx, sw } = sampleGrid(W, H);
  const out = new Uint8Array(sw * ys.length * 4);
  for (let i = 0; i < ys.length; i++) {
    const start = (ys[i] * W + sx) * 4;
    out.set(data.subarray(start, start + sw * 4), i * sw * 4);
  }
  return classifyRows(out, sw, ys.length);
}

/** True when any pixel is not fully opaque. */
export function hasAlpha(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}
