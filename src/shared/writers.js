// Small pure-JS writers and pixel helpers shared by the worker and the canvas fallback.

export function parseColor(hex) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return isNaN(n) ? [255, 255, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Composite RGBA over a solid colour. Returns a new opaque buffer. */
export function flatten(img, background) {
  const [br, bg, bb] = parseColor(background);
  const s = img.data, out = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    if (a === 255) { out[i] = s[i]; out[i + 1] = s[i + 1]; out[i + 2] = s[i + 2]; }
    else {
      const k = a / 255, j = 1 - k;
      out[i] = s[i] * k + br * j; out[i + 1] = s[i + 1] * k + bg * j; out[i + 2] = s[i + 2] * k + bb * j;
    }
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

export function premultiply(data) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = data[i] * a; out[i + 1] = data[i + 1] * a; out[i + 2] = data[i + 2] * a; out[i + 3] = data[i + 3];
  }
  return out;
}

export function unpremultiply(data) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a && a !== 255) {
      const k = 255 / a;
      data[i] = Math.min(255, data[i] * k); data[i + 1] = Math.min(255, data[i + 1] * k); data[i + 2] = Math.min(255, data[i + 2] * k);
    }
  }
  return data;
}

/** 24-bit bottom-up BMP from (already flattened) RGBA. */
export function encodeBmp(img) {
  const { width: w, height: h, data: d } = img;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0x4d42, true); v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, rowSize * h, true);
  v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * rowSize;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) { out[o++] = d[i + 2]; out[o++] = d[i + 1]; out[o++] = d[i]; }
  }
  return out;
}

/** ICO container holding PNG images. entries: [{ size, png: Uint8Array }] */
export function icoContainer(entries) {
  const head = 6 + 16 * entries.length;
  const total = head + entries.reduce((n, p) => n + p.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true); v.setUint16(4, entries.length, true);
  let off = head;
  entries.forEach((p, i) => {
    const e = 6 + i * 16;
    out[e] = p.size >= 256 ? 0 : p.size; out[e + 1] = p.size >= 256 ? 0 : p.size;
    v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, p.png.length, true); v.setUint32(e + 12, off, true);
    out.set(p.png, off); off += p.png.length;
  });
  return out;
}

/** Centre an image on a transparent square canvas of `size` px (image already fits). */
export function padSquare(img, size) {
  if (img.width === size && img.height === size) return img;
  const out = new Uint8ClampedArray(size * size * 4);
  const ox = Math.floor((size - img.width) / 2), oy = Math.floor((size - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    out.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + oy) * size + ox) * 4);
  }
  return { data: out, width: size, height: size };
}

/** Exact-size view of bytes, suitable for transfer. */
export function ownBuffer(u8) {
  if (u8 instanceof ArrayBuffer) return new Uint8Array(u8);
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8 : u8.slice();
}
