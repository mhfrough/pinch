// Main-thread decoding helpers (createImageBitmap first, <img> for SVG and as a fallback).
import { sniff } from '../shared/sniff.js';
import { capSize } from '../shared/geometry.js';

export const MSG = {
  heic: 'This browser can\'t open HEIC photos. On an iPhone, set Camera > Formats to "Most Compatible", or share the photo as JPG first.',
  tiff: 'Pinch can\'t open TIFF files. Save it as PNG or JPG in another app first.',
  generic: 'This file is not a picture Pinch can open. JPG, PNG, WebP, AVIF, GIF, BMP, ICO, SVG and HEIC work.',
  damaged: 'This picture seems to be damaged, so the browser can\'t read it. Try opening it in another app and saving it again.',
  nosize: 'This file has no size Pinch can read. Try opening it in another app and saving it again.',
  memory: 'This picture is too big for the browser\'s memory. Try a smaller size or close other tabs.',
};

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const sniffCache = new WeakMap();
export async function sniffFile(file) {
  let s = sniffCache.get(file);
  if (!s) {
    const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    s = sniff(head, file);
    sniffCache.set(file, s);
  }
  return s;
}

export function loadImage(file, isSvg) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(isSvg && file.type !== 'image/svg+xml' ? new Blob([file], { type: 'image/svg+xml' }) : file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (isSvg && (!w || !h)) { w = 1024; h = 1024; }
      resolve({ source: img, width: w, height: h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(MSG.damaged)); };
    img.src = url;
  });
}

/** Open a file for drawing: { source, width, height, close() } or throws a friendly error. */
export async function openSource(file, sn) {
  if (sn.format === 'svg') {
    const r = await loadImage(file, true);
    r.close = () => {};
    return r;
  }
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: b, width: b.width, height: b.height, close: () => b.close() };
    } catch (e) { /* try <img> */ }
  }
  if (sn.format !== 'heic' && sn.format !== 'tiff') {
    try { const r = await loadImage(file, false); r.close = () => {}; return r; } catch (e) { /* fall through */ }
  }
  throw new Error(sn.format === 'heic' ? MSG.heic : sn.format === 'tiff' ? MSG.tiff : sn.format ? MSG.damaged : MSG.generic);
}

/** Draw a source at w x h and return RGBA. */
export function rasterize(src, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.source, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  c.width = c.height = 1;
  return data;
}

/** Decode a file to RGBA on the main thread, capped to the size limits. */
export async function decodePixels(file, sn, size) {
  const src = await openSource(file, sn);
  try {
    const W = src.width, H = src.height;
    if (!W || !H) throw new Error(MSG.nosize);
    const c = size || capSize(W, H);
    const data = rasterize(src, c.w, c.h);
    return { data, width: c.w, height: c.h, origW: W, origH: H, decodeCapped: !size && c.capped };
  } finally { src.close(); }
}
