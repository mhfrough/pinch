// Codec loaders. The codecs' JS glue is bundled into worker.js (small); their .wasm files are
// fetched lazily from codecs/ the first time a codec is used, compiled to a WebAssembly.Module and
// shared through the main thread with every other worker (and with workers spawned later, for
// example after a cancel), so after the warm-up nothing needs the network again: Pinch keeps
// working offline. The HEIC decoder (LGPL) stays a separate file, codecs/heif.js.

import mozjpegEnc from '@jsquash/jpeg/codec/enc/mozjpeg_enc.js';
import { defaultOptions as jpegDefaults } from '@jsquash/jpeg/meta.js';
import webpEnc from '@jsquash/webp/codec/enc/webp_enc.js';
import webpEncSimd from '@jsquash/webp/codec/enc/webp_enc_simd.js';
import { defaultOptions as webpDefaults } from '@jsquash/webp/meta.js';
// Single-threaded AVIF only: GitHub Pages cannot send COOP/COEP, so SharedArrayBuffer threads are
// unavailable anyway; importing the codec directly keeps the -mt build out of the bundle.
import avifEnc from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions as avifDefaults } from '@jsquash/avif/meta.js';
import avifDec from '@jsquash/avif/codec/dec/avif_dec.js';
import webpDec from '@jsquash/webp/codec/dec/webp_dec.js';
import initOxipng, { optimise_raw } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import initResize, { resize as wasmResize } from '@jsquash/resize/lib/resize/pkg/squoosh_resize.js';
import initHqx, { resize as wasmHqx } from '@jsquash/resize/lib/hqx/pkg/squooshhqx.js';

export const BASE = (() => {
  const n = self.name || '';
  const i = n.indexOf('|');
  return i >= 0 ? n.slice(i + 1) : String(self.location.href).replace(/[^/]*$/, '');
})();
self.__pinchBase = BASE; // import.meta.url in the bundled codec glue points here (see build define)

const SIMD = (() => {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; }
})();
const WEBP_WASM = SIMD ? 'webp_enc_simd.wasm' : 'webp_enc.wasm';

// -------------------------------------------------------------- shared compiled modules
let notify = () => {};
let share = () => {};
export function setLoadNotifier(fn) { notify = fn || (() => {}); }
export function setSharer(fn) { share = fn || (() => {}); }

const modules = Object.create(null);  // file name -> WebAssembly.Module (or Blob for heif.js)
const pending = Object.create(null);

export function receive(name, value) { if (!modules[name]) modules[name] = value; }

export const LABELS = {
  'mozjpeg_enc.wasm': 'JPG encoder (MozJPEG, 0.25 MB)',
  'webp_enc.wasm': 'WebP encoder (0.3 MB)',
  'webp_enc_simd.wasm': 'WebP encoder (0.35 MB)',
  'avif_enc.wasm': 'AVIF encoder (3.4 MB)',
  'avif_dec.wasm': 'AVIF decoder (1.1 MB)',
  'webp_dec.wasm': 'WebP decoder (0.14 MB)',
  'squoosh_oxipng_bg.wasm': 'PNG optimiser (OxiPNG, 0.16 MB)',
  'squoosh_resize_bg.wasm': 'resizer (0.03 MB)',
  'squooshhqx_bg.wasm': 'pixel-art upscaler (0.13 MB)',
  'heif.js': 'HEIC decoder (3 MB)',
};

/** Get a codec file: from memory, else fetch (and compile) it once and share it. */
export function file(name, quiet) {
  if (modules[name]) return Promise.resolve(modules[name]);
  if (!pending[name]) {
    if (!quiet) notify(name, LABELS[name] || name);
    pending[name] = (async () => {
      const url = new URL(name, BASE).href;
      let value;
      if (name.endsWith('.wasm')) {
        try { value = await WebAssembly.compileStreaming(fetch(url)); } catch (e) {
          const r = await fetch(url);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          value = await WebAssembly.compile(await r.arrayBuffer());
        }
      } else {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        value = await r.blob();
      }
      modules[name] = value;
      share(name, value);
      return value;
    })().catch((e) => {
      delete pending[name];
      const err = new Error('Could not load the ' + (LABELS[name] || name) + '. Check your connection and try again.');
      err.cause = e;
      throw err;
    });
  }
  return pending[name];
}

/** Fetch and compile everything, in order, without announcing it (low-priority warm-up). */
export async function warm(list) {
  for (const name of list || WARM_ORDER) {
    try { await file(name, true); } catch (e) { /* offline or blocked: try again on use */ }
  }
}
// AVIF encoder last: it is by far the largest.
export const WARM_ORDER = ['squoosh_resize_bg.wasm', 'mozjpeg_enc.wasm', WEBP_WASM, 'squoosh_oxipng_bg.wasm',
  'squooshhqx_bg.wasm', 'webp_dec.wasm', 'avif_dec.wasm', 'heif.js', 'avif_enc.wasm'];

// -------------------------------------------------------------- instantiation
const ready = Object.create(null);
function once(key, fn) { return ready[key] || (ready[key] = fn().catch((e) => { delete ready[key]; throw e; })); }

function emscripten(factory, wasmName) {
  return file(wasmName).then((mod) => factory({
    noInitialRun: true,
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(mod, imports).then((inst) => done(inst, mod));
      return {};
    },
  }));
}

export const jpeg = () => once('jpeg', async () => {
  const m = await emscripten(mozjpegEnc, 'mozjpeg_enc.wasm');
  return (img, o) => m.encode(img.data, img.width, img.height, Object.assign({}, jpegDefaults, o));
});

export const webp = () => once('webp', async () => {
  const m = await emscripten(SIMD ? webpEncSimd : webpEnc, WEBP_WASM);
  return (img, o) => m.encode(img.data, img.width, img.height, Object.assign({}, webpDefaults, o));
});

export const avif = () => once('avif', async () => {
  const m = await emscripten(avifEnc, 'avif_enc.wasm');
  return (img, o) => {
    const d = img.data;
    return m.encode(new Uint8Array(d.buffer, d.byteOffset, d.byteLength), img.width, img.height, Object.assign({}, avifDefaults, o));
  };
});

export const decodeAvif = () => once('avifDec', async () => {
  const m = await emscripten(avifDec, 'avif_dec.wasm');
  return (buf) => m.decode(buf, 8);
});

export const decodeWebp = () => once('webpDec', async () => {
  const m = await emscripten(webpDec, 'webp_dec.wasm');
  return (buf) => m.decode(buf);
});

export const oxipng = () => once('oxipng', async () => {
  await initOxipng(await file('squoosh_oxipng_bg.wasm'));
  return optimise_raw;
});

export const resizer = () => once('resize', async () => {
  await initResize(await file('squoosh_resize_bg.wasm'));
  return wasmResize;
});

export const hqx = () => once('hqx', async () => {
  await initHqx(await file('squooshhqx_bg.wasm'));
  return wasmHqx;
});

export const heif = () => once('heif', async () => {
  const blob = await file('heif.js');
  const url = URL.createObjectURL(blob);
  let build;
  try { build = (await import(/* webpackIgnore: true */ url)).default; } finally { URL.revokeObjectURL(url); }
  return new Promise((resolve, reject) => {
    let mod = null, done = false;
    try {
      mod = build({ onRuntimeInitialized: () => { done = true; if (mod) resolve(mod); } });
      if (done) resolve(mod);
    } catch (e) { reject(e); }
  });
});

const BY_FORMAT = {
  jpeg: ['mozjpeg_enc.wasm'], webp: [WEBP_WASM], avif: ['avif_enc.wasm'], png: ['squoosh_oxipng_bg.wasm'],
  ico: ['squoosh_oxipng_bg.wasm'], gif: [], bmp: [],
};
export function preload(format) {
  return Promise.all((BY_FORMAT[format] || []).concat('squoosh_resize_bg.wasm').map((n) => file(n)));
}
