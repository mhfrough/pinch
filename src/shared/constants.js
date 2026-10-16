// Shared constants for the engine (main thread) and the codec worker.

export const MAX_SIDE = 12000;   // longest side of any output, in px
export const MAX_PIXELS = 40e6;  // 40 megapixels
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

export const FORMATS = {
  jpeg: { label: 'JPG', ext: 'jpg', mime: 'image/jpeg', lossy: true, alpha: false },
  png: { label: 'PNG', ext: 'png', mime: 'image/png', lossy: false, alpha: true },
  webp: { label: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, alpha: true },
  avif: { label: 'AVIF', ext: 'avif', mime: 'image/avif', lossy: true, alpha: true },
  gif: { label: 'GIF', ext: 'gif', mime: 'image/gif', lossy: false, alpha: true },
  bmp: { label: 'BMP', ext: 'bmp', mime: 'image/bmp', lossy: false, alpha: false },
  ico: { label: 'ICO', ext: 'ico', mime: 'image/x-icon', lossy: false, alpha: true },
};

// Input-only formats get a label too, for notes.
export const INPUT_LABELS = { svg: 'SVG', heic: 'HEIC', tiff: 'TIFF' };

export function labelOf(fmt) {
  return (FORMATS[fmt] && FORMATS[fmt].label) || INPUT_LABELS[fmt] || String(fmt || '').toUpperCase();
}

export const DEFAULT_SETTINGS = {
  format: 'auto',
  quality: 75,
  lossless: false,
  pngColors: 0,
  resize: { mode: 'none', percent: 100, width: 0, height: 0 },
  upscale: { factor: 1, method: 'smooth' },
  target: 0,
  background: '#ffffff',
  stripMetadata: true,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Fill in defaults and coerce types so the rest of the code can trust the settings. */
export function normaliseSettings(s) {
  s = s || {};
  const d = DEFAULT_SETTINGS;
  const r = Object.assign({}, d.resize, s.resize || {});
  const u = Object.assign({}, d.upscale, s.upscale || {});
  const fmt = s.format && (s.format === 'auto' || s.format === 'same' || FORMATS[s.format]) ? s.format : d.format;
  const colors = Number(s.pngColors) || 0;
  return {
    format: fmt,
    quality: clamp(Math.round(Number(s.quality) || d.quality), 1, 100),
    lossless: !!s.lossless,
    pngColors: [0, 256, 128, 64, 32, 16, 8, 4, 2].includes(colors) ? colors : 0,
    resize: {
      mode: ['none', 'percent', 'fit', 'width', 'height'].includes(r.mode) ? r.mode : 'none',
      percent: clamp(Number(r.percent) || 100, 1, 1000),
      width: Math.max(0, Math.round(Number(r.width) || 0)),
      height: Math.max(0, Math.round(Number(r.height) || 0)),
    },
    upscale: {
      factor: clamp(Math.round(Number(u.factor) || 1), 1, 4),
      method: ['smooth', 'sharp', 'pixel'].includes(u.method) ? u.method : 'smooth',
    },
    target: Math.max(0, Math.round(Number(s.target) || 0)),
    background: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.background || '') ? s.background : d.background,
    stripMetadata: s.stripMetadata !== false,
    skipAvif: !!s.skipAvif,
  };
}

export function bytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';
}
