// Pinch AI worker (module). Runs Real-ESRGAN realesr-general-x4v3 with onnxruntime-web,
// tile by tile: WebGPU if the browser has it, else WebAssembly. (WebGL was tried and is far
// slower than WebAssembly for this model; see README.md.)
import { resample } from './resample.js';

const BASE = new URL('./', import.meta.url);
// float16 weights (computed in float32), any input size.
const MODEL_URL = new URL('models/realesr-general-x4v3.onnx', BASE).href;
const CACHE_NAME = 'pinch-ai-v1';
const MODEL_SCALE = 4;

let enginePromise = null; // { ort, session, backend }

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

// An adapter is not enough: some builds find one but cannot create a device (e.g. missing DXC on Windows).
let gpuCheck = null;
function hasWebGPU() {
  if (!gpuCheck) gpuCheck = (async () => {
    try {
      if (!self.navigator || !navigator.gpu) return false;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      const device = await adapter.requestDevice();
      const lost = await Promise.race([device.lost.then(() => true), new Promise((r) => setTimeout(() => r(false), 100))]);
      device.destroy();
      return !lost;
    } catch {
      return false;
    }
  })();
  return gpuCheck;
}

// Same-origin model, kept in the Cache API so later visits skip the network entirely.
async function loadModel(url, progress) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = null; // no Cache API (e.g. insecure context): fall back to plain fetch
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The AI model could not be downloaded (HTTP ${res.status}). Check your connection and try again.`);
  const total = Number(res.headers.get('content-length')) || 0;
  let bytes;
  if (res.body && total) {
    const reader = res.body.getReader();
    bytes = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > bytes.length) {
        const bigger = new Uint8Array(Math.max(bytes.length * 2, got + value.length));
        bigger.set(bytes);
        bytes = bigger;
      }
      bytes.set(value, got);
      got += value.length;
      progress(got / total);
    }
    bytes = bytes.subarray(0, got);
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  if (cache) {
    try {
      await cache.put(url, new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream' } }));
      for (const key of await caches.keys()) if (key.startsWith('pinch-ai-') && key !== CACHE_NAME) await caches.delete(key);
    } catch { /* quota or private mode: not fatal */ }
  }
  return bytes;
}

const BUNDLES = { webgpu: './ort/ort.webgpu.min.mjs', wasm: './ort/ort.wasm.min.mjs' };
const failures = {}; // backend -> reason it could not run this model (kept for the worker's life)

async function importOrt(backend) {
  const ort = await import(BUNDLES[backend]);
  ort.env.wasm.wasmPaths = new URL('ort/', BASE).href;
  // GitHub Pages cannot send COOP/COEP headers, so threads are usually unavailable.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';
  return ort;
}

// Order: WebGPU, then WebAssembly (always works). `want` forces one backend.
async function createEngine(want, progress) {
  const order = want === 'auto' ? ['webgpu', 'wasm'] : [want];
  if (!BUNDLES[order[0]]) throw new Error(`Unknown AI backend "${want}".`);
  progress(0, 'Loading AI engine');
  let lastErr = null;
  for (const backend of order) {
    if (backend === 'webgpu' && !(await hasWebGPU())) { lastErr = new Error('WebGPU is not available in this browser.'); continue; }
    if (failures[backend] && want === 'auto') continue;
    try {
      const model = await loadModel(MODEL_URL, (f) => progress(f, 'Downloading AI model'));
      progress(1, 'Starting AI engine');
      const ort = await importOrt(backend);
      const session = await ort.InferenceSession.create(model, { graphOptimizationLevel: 'all', executionProviders: [backend] });
      return { ort, session, backend };
    } catch (err) {
      failures[backend] = String(err && err.message || err);
      lastErr = err;
    }
  }
  throw lastErr || new Error('The AI engine could not start in this browser.');
}

function getEngine(want, progress) {
  if (enginePromise && enginePromise.want === want) return enginePromise;
  enginePromise = createEngine(want, progress);
  enginePromise.want = want;
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

// Give fully transparent pixels the colour of their nearest visible neighbours, so the model
// does not pull dark (or random) hidden colour into the visible edges.
function bleedColour(rgba, w, h) {
  const n = w * h;
  const known = new Uint8Array(n);
  let unknown = 0, sr = 0, sg = 0, sb = 0, ns = 0;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] > 0) {
      known[i] = 1;
      sr += rgba[i * 4]; sg += rgba[i * 4 + 1]; sb += rgba[i * 4 + 2]; ns++;
    } else unknown++;
  }
  if (!unknown) return;
  if (!ns) return; // fully transparent image: nothing to bleed
  const next = new Uint8Array(n);
  for (let pass = 0; pass < 24 && unknown; pass++) {
    let changed = 0;
    next.set(known);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        if (x > 0 && known[i - 1]) { const j = (i - 1) * 4; r += rgba[j]; g += rgba[j + 1]; b += rgba[j + 2]; c++; }
        if (x < w - 1 && known[i + 1]) { const j = (i + 1) * 4; r += rgba[j]; g += rgba[j + 1]; b += rgba[j + 2]; c++; }
        if (y > 0 && known[i - w]) { const j = (i - w) * 4; r += rgba[j]; g += rgba[j + 1]; b += rgba[j + 2]; c++; }
        if (y < h - 1 && known[i + w]) { const j = (i + w) * 4; r += rgba[j]; g += rgba[j + 1]; b += rgba[j + 2]; c++; }
        if (c) {
          const j = i * 4;
          rgba[j] = r / c; rgba[j + 1] = g / c; rgba[j + 2] = b / c;
          next[i] = 1;
          changed++;
        }
      }
    }
    known.set(next);
    unknown -= changed;
    if (!changed) break;
  }
  if (unknown) {
    const r = sr / ns, g = sg / ns, b = sb / ns;
    for (let i = 0; i < n; i++) if (!known[i]) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; }
  }
}

// Tile grid: the length is split into equal cores of at most `tile` px, each read with up to
// `pad` px of real context. Every crop has the same size (shifted inward at the borders), so the
// model always sees one input shape and little work is repeated.
function plan(len, tile, pad) {
  if (len <= tile + 2 * pad) return [{ c0: 0, c1: len, s: 0, crop: len }];
  const n = Math.ceil(len / tile);
  const core = Math.ceil(len / n);
  const crop = Math.min(len, core + 2 * pad);
  const out = [];
  for (let c0 = 0; c0 < len; c0 += core) {
    const c1 = Math.min(len, c0 + core);
    const s = Math.max(0, Math.min(c0 - pad, len - crop));
    out.push({ c0, c1, s, crop });
  }
  return out;
}

async function run(msg) {
  const { id, width: W, height: H, scale, backend: want = 'auto' } = msg;
  const rgba = new Uint8ClampedArray(msg.rgba);
  const progress = (fraction, label) => post({ type: 'progress', id, fraction, label });
  const t0 = performance.now();
  current.backend = null;

  // Phase weights: engine/model 0-0.1, tiles 0.1-0.96, encode 0.96-1.
  const engine = await getEngine(want, (f, label) => progress(0.1 * Math.min(1, f), label));
  const { ort, session, backend } = engine;
  current.backend = backend;
  const tReady = performance.now();

  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { hasAlpha = true; break; }

  const OW = W * scale, OH = H * scale;
  const out = new Uint8ClampedArray(OW * OH * 4);

  if (hasAlpha) {
    progress(0.1, 'Preparing transparency');
    const alpha = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) alpha[i] = rgba[i * 4 + 3];
    const up = resample(alpha, W, H, 1, OW, OH);
    for (let i = 0; i < OW * OH; i++) out[i * 4 + 3] = up[i]; // Uint8ClampedArray rounds and clamps
    bleedColour(rgba, W, H);
  } else {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
  }

  const tile = backend === 'webgpu' ? 256 : 192;
  const pad = backend === 'webgpu' ? 16 : 12;
  const cols = plan(W, tile, pad);
  const rows = plan(H, tile, pad);
  const total = cols.length * rows.length;
  const cw = cols[0].crop, ch = rows[0].crop;
  const iw = cw, ih = ch; // model input size (the crop)
  const input = new Float32Array(3 * iw * ih);
  const plane = iw * ih;
  const f = 1 / 255;
  let done = 0;
  progress(0.1, `Upscaling tile 1 of ${total}`);

  for (const ry of rows) {
    for (const cx of cols) {
      if (cancelled.has(id)) throw new DOMException('Upscale cancelled', 'AbortError');
      for (let y = 0; y < ih; y++) {
        const row = ((ry.s + Math.min(y, ch - 1)) * W + cx.s) * 4;
        let di = y * iw;
        for (let x = 0; x < iw; x++, di++) {
          const si = row + Math.min(x, cw - 1) * 4;
          input[di] = rgba[si] * f;
          input[plane + di] = rgba[si + 1] * f;
          input[2 * plane + di] = rgba[si + 2] * f;
        }
      }
      const tensor = new ort.Tensor('float32', input, [1, 3, ih, iw]);
      const result = await session.run({ input: tensor });
      const outT = result.output;
      let data = outT.data;
      let tw = iw * MODEL_SCALE, th = ih * MODEL_SCALE;
      if (scale !== MODEL_SCALE) {
        // Downscale the whole padded tile, then crop: the filter sees real context at the cut.
        const dw = iw * scale, dh = ih * scale, tp = tw * th, dp = dw * dh;
        const small = new Float32Array(3 * dp);
        for (let c = 0; c < 3; c++) small.set(resample(data.subarray(c * tp, (c + 1) * tp), tw, th, 1, dw, dh), c * dp);
        data = small; tw = dw; th = dh;
      }
      outT.dispose?.();
      tensor.dispose?.();
      const tp = tw * th;
      const ox0 = cx.c0 * scale, ox1 = cx.c1 * scale, oy0 = ry.c0 * scale, oy1 = ry.c1 * scale;
      const offX = (cx.c0 - cx.s) * scale, offY = (ry.c0 - ry.s) * scale;
      for (let oy = oy0; oy < oy1; oy++) {
        let si = (oy - oy0 + offY) * tw + offX;
        let di = (oy * OW + ox0) * 4;
        for (let ox = ox0; ox < ox1; ox++, si++, di += 4) {
          out[di] = data[si] * 255;
          out[di + 1] = data[tp + si] * 255;
          out[di + 2] = data[2 * tp + si] * 255;
        }
      }
      done++;
      progress(0.1 + 0.86 * (done / total), done < total ? `Upscaling tile ${done + 1} of ${total}` : 'Saving PNG');
    }
  }
  if (cancelled.has(id)) throw new DOMException('Upscale cancelled', 'AbortError');
  const tTiles = performance.now();

  const stats = { backend, tiles: total, tile, pad, hasAlpha, msEngine: Math.round(tReady - t0), msInfer: Math.round(tTiles - tReady), skipped: { ...failures } };
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(OW, OH);
    const ctx = canvas.getContext('2d');
    if (ctx && canvas.convertToBlob) {
      ctx.putImageData(new ImageData(out, OW, OH), 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      stats.msEncode = Math.round(performance.now() - tTiles);
      post({ type: 'done', id, blob, width: OW, height: OH, stats });
      return;
    }
  }
  // No OffscreenCanvas: hand the pixels back and let the page encode them.
  post({ type: 'done', id, pixels: out.buffer, width: OW, height: OH, stats }, [out.buffer]);
}

const cancelled = new Set();
const current = { backend: null };

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled.add(msg.id); return; }
  if (msg.type === 'warm') {
    try {
      const { backend } = await getEngine(msg.backend || 'auto', () => {});
      post({ type: 'warm', id: msg.id, backend });
    } catch (err) {
      post({ type: 'error', id: msg.id, message: String(err && err.message || err) });
    }
    return;
  }
  if (msg.type !== 'run') return;
  try {
    try {
      await run(msg);
    } catch (err) {
      // WebGPU can also fail mid-run (device lost, out of GPU memory): retry once on WebAssembly.
      const auto = !msg.backend || msg.backend === 'auto';
      if (!auto || current.backend !== 'webgpu' || (err && err.name === 'AbortError') || cancelled.has(msg.id)) throw err;
      failures.webgpu = String(err && err.message || err);
      enginePromise = null;
      await run(msg);
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, name: err && err.name, message: String(err && err.message || err) });
  } finally {
    cancelled.delete(msg.id);
  }
};
