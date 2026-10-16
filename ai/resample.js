// Pinch AI: separable Lanczos-3 resampling for interleaved pixel data.
// Used by the worker (alpha upscaling, x4 -> x2 downscaling) and by the tests (Lanczos baseline).

function lanczos(x, a) {
  if (x === 0) return 1;
  if (x <= -a || x >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

// Per output index: first source index and normalised weights.
function weightsFor(srcLen, dstLen, a) {
  const ratio = srcLen / dstLen;
  const fscale = Math.max(1, ratio); // widen the kernel when shrinking
  const support = a * fscale;
  const taps = Math.ceil(support) * 2 + 1;
  const start = new Int32Array(dstLen);
  const w = new Float32Array(dstLen * taps);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * ratio - 0.5;
    const first = Math.floor(center - support) + 1;
    start[i] = first;
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      const v = lanczos((first + t - center) / fscale, a);
      w[i * taps + t] = v;
      sum += v;
    }
    if (sum !== 0) for (let t = 0; t < taps; t++) w[i * taps + t] /= sum;
  }
  return { start, w, taps };
}

/**
 * Resample interleaved data (ch channels per pixel) from sw x sh to dw x dh.
 * src: any array-like of numbers. Returns a Float32Array (dw * dh * ch), not clamped.
 */
export function resample(src, sw, sh, ch, dw, dh, a = 3) {
  const H = weightsFor(sw, dw, a);
  const V = weightsFor(sh, dh, a);
  const tmp = new Float32Array(dw * sh * ch);
  const maxX = sw - 1;
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < dw; x++) {
      const s0 = H.start[x];
      const wo = x * H.taps;
      const o = (y * dw + x) * ch;
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let t = 0; t < H.taps; t++) {
          const wt = H.w[wo + t];
          if (wt === 0) continue;
          let sx = s0 + t;
          sx = sx < 0 ? 0 : sx > maxX ? maxX : sx;
          acc += wt * src[(row + sx) * ch + c];
        }
        tmp[o + c] = acc;
      }
    }
  }
  const dst = new Float32Array(dw * dh * ch);
  const maxY = sh - 1;
  const stride = dw * ch;
  for (let y = 0; y < dh; y++) {
    const s0 = V.start[y];
    const wo = y * V.taps;
    const o = y * stride;
    for (let t = 0; t < V.taps; t++) {
      const wt = V.w[wo + t];
      if (wt === 0) continue;
      let sy = s0 + t;
      sy = sy < 0 ? 0 : sy > maxY ? maxY : sy;
      const r = sy * stride;
      for (let i = 0; i < stride; i++) dst[o + i] += wt * tmp[r + i];
    }
  }
  return dst;
}
