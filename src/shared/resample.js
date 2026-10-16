// Separable resampler in plain JS (Float32, premultiplied alpha, sRGB space).
// Kernels: Lanczos3 and Magic Kernel Sharp 2021 (John Costella, https://johncostella.com/magic/).
// Used for the 'sharp' upscale instead of @jsquash/resize's Magic Kernel wasm, which took 24 s for a
// 2400x1600 -> 4800x3200 upscale (this takes about 3.5 s). Lanczos3 and hqx still use @jsquash/resize.

function sinc(x) { if (x === 0) return 1; x *= Math.PI; return Math.sin(x) / x; }

export const KERNELS = {
  lanczos3: { support: 3, f: (x) => (x < 3 ? sinc(x) * sinc(x / 3) : 0) },
  mks2021: {
    support: 4.5,
    f: (x) => {
      if (x <= 0.5) return 577 / 576 - (239 / 144) * x * x;
      if (x <= 1.5) return (140 * x * x - 379 * x + 239) / 144;
      if (x <= 2.5) return -(24 * x * x - 113 * x + 130) / 144;
      if (x <= 3.5) return (4 * x * x - 27 * x + 45) / 144;
      if (x <= 4.5) return -(4 * x * x - 36 * x + 81) / 1152;
      return 0;
    },
  },
};

function weights(inN, outN, kernel) {
  const scale = outN / inN;
  const fs = Math.max(1, 1 / scale); // widen the kernel when shrinking
  const sup = kernel.support * fs;
  const taps = Math.ceil(sup) * 2 + 1;
  const idx = new Int32Array(outN * taps);
  const w = new Float32Array(outN * taps);
  for (let i = 0; i < outN; i++) {
    const c = (i + 0.5) / scale - 0.5;
    const left = Math.floor(c - sup) + 1;
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      const j = left + t;
      const v = kernel.f(Math.abs(j - c) / fs);
      idx[i * taps + t] = j < 0 ? 0 : j >= inN ? inN - 1 : j;
      w[i * taps + t] = v;
      sum += v;
    }
    if (sum) for (let t = 0; t < taps; t++) w[i * taps + t] /= sum;
  }
  return { idx, w, taps };
}

/** Resize RGBA (Uint8ClampedArray) to w x h. `alpha` = premultiply to avoid dark fringes. */
export function resample(img, w, h, kernelName, alpha) {
  const K = KERNELS[kernelName] || KERNELS.lanczos3;
  const sw = img.width, sh = img.height, src = img.data;
  const H = weights(sw, w, K), V = weights(sh, h, K);
  // pass 1: horizontal, rows of the source -> tmp (w x sh), premultiplied floats
  const tmp = new Float32Array(w * sh * 4);
  const ht = H.taps, hi = H.idx, hw = H.w;
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4, orow = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const base = x * ht, o = orow + x * 4;
      if (alpha) {
        for (let t = 0; t < ht; t++) {
          const p = row + hi[base + t] * 4;
          const pa = src[p + 3] * hw[base + t];
          r += src[p] * pa; g += src[p + 1] * pa; b += src[p + 2] * pa; a += pa;
        }
        tmp[o] = r / 255; tmp[o + 1] = g / 255; tmp[o + 2] = b / 255; tmp[o + 3] = a;
      } else {
        for (let t = 0; t < ht; t++) {
          const p = row + hi[base + t] * 4, k = hw[base + t];
          r += src[p] * k; g += src[p + 1] * k; b += src[p + 2] * k;
        }
        tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = 255;
      }
    }
  }
  // pass 2: vertical, tmp -> out (w x h)
  const out = new Uint8ClampedArray(w * h * 4);
  const vt = V.taps, vi = V.idx, vw = V.w, stride = w * 4;
  const acc = new Float32Array(stride);
  for (let y = 0; y < h; y++) {
    acc.fill(0);
    const base = y * vt;
    for (let t = 0; t < vt; t++) {
      const k = vw[base + t];
      if (k === 0) continue;
      const row = vi[base + t] * stride;
      for (let i = 0; i < stride; i++) acc[i] += tmp[row + i] * k;
    }
    const o = y * stride;
    if (alpha) {
      for (let i = 0; i < stride; i += 4) {
        const a = acc[i + 3];
        if (a <= 0.5) { out[o + i] = out[o + i + 1] = out[o + i + 2] = out[o + i + 3] = 0; continue; }
        const m = 255 / a;
        out[o + i] = acc[i] * m; out[o + i + 1] = acc[i + 1] * m; out[o + i + 2] = acc[i + 2] * m; out[o + i + 3] = a;
      }
    } else {
      for (let i = 0; i < stride; i += 4) { out[o + i] = acc[i]; out[o + i + 1] = acc[i + 1]; out[o + i + 2] = acc[i + 2]; out[o + i + 3] = 255; }
    }
  }
  return { data: out, width: w, height: h };
}
