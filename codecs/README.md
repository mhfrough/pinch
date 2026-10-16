# Pinch codecs (generated)

Built by `node tools/build-codecs.mjs` from `src/`. Do not edit files here by hand.
Everything is same-origin; nothing is fetched from a CDN. `worker.js` is the module worker that
`engine.js` starts (from a Blob URL of its source, so restarts work offline).

## Files

| File | What | Size |
|---|---|---|
| worker.js | worker: pipeline, cache, all codec JS glue, quantiser, GIF/BMP/ICO writers, Magic Kernel Sharp (loaded when the engine starts) | 179 KB |
| avif_enc.wasm | AVIF encoder (libavif + libaom, single thread) | 3404 KB |
| avif_dec.wasm | AVIF decoder (only if the browser cannot decode AVIF) | 1143 KB |
| webp_enc_simd.wasm | WebP encoder (SIMD browsers) | 337 KB |
| webp_enc.wasm | WebP encoder (no SIMD) | 275 KB |
| mozjpeg_enc.wasm | MozJPEG encoder | 246 KB |
| squoosh_oxipng_bg.wasm | OxiPNG (PNG optimiser) | 160 KB |
| webp_dec.wasm | WebP decoder (only if the browser cannot decode WebP) | 135 KB |
| squooshhqx_bg.wasm | hqx pixel-art upscaler | 132 KB |
| squoosh_resize_bg.wasm | Lanczos3 resizer | 34 KB |
| heif.js | HEIC decoder (libheif + libde265, LGPL-3.0, wasm embedded); only when the browser cannot open a HEIC file | 3074 KB |
| fallback-codecs.js | pure-JS PNG/GIF codecs for the canvas fallback (no module workers / WebAssembly); classic script | 70 KB |

Every .wasm (and heif.js) is fetched the first time it is needed. Once the page is idle, the engine
also warms them all in the background (AVIF encoder last; skipped on Save-Data except the small ones)
and shares the compiled WebAssembly modules with every worker, so Pinch keeps working offline.

The multi-threaded AVIF encoder and multi-threaded OxiPNG are deliberately not included:
they need SharedArrayBuffer (COOP/COEP headers), which GitHub Pages cannot send.

## Versions

| Package | Version |
|---|---|
| @jsquash/jpeg | 1.6.0 |
| @jsquash/webp | 1.5.0 |
| @jsquash/avif | 2.1.1 |
| @jsquash/oxipng | 2.3.0 |
| @jsquash/resize | 2.1.1 |
| @jsquash/png | 3.1.1 |
| wasm-feature-detect | 1.9.0 |
| gifenc | 1.0.3 |
| upng-js | 2.1.0 |
| pako | 1.0.11 |
| heic-to | 1.6.6 |
| esbuild | 0.25.10 |

Codec versions inside jSquash: MozJPEG 4 (libjpeg-turbo), libwebp, libavif + libaom, OxiPNG,
resize (PistonDevelopers), hqx (wasmboy-rs). HEIC: libheif 1.23.6 with libde265 1.0.16,
as built by heic-to (no unsafe-eval build).

## Licences

Files are in `licenses/`.

- jSquash wrappers and Squoosh glue: Apache-2.0
- MozJPEG / libjpeg-turbo: IJG + BSD-3-Clause + zlib
- libwebp: BSD-3-Clause
- libavif, libaom: BSD-2-Clause (plus the AOM patent licence)
- OxiPNG, resize: MIT; hqx: Apache-2.0. Magic Kernel Sharp 2021 is implemented in Pinch's own JS
  (src/shared/resample.js) from John Costella's published kernel (https://johncostella.com/magic/)
- UPNG.js (palette quantiser), gifenc, pako: MIT
- heic-to / libheif / libde265: **LGPL-3.0**. The HEIC decoder is kept as its own file,
  `heif.js`, loaded only when a HEIC/HEIF file is opened and the browser cannot decode it
  natively (or during the idle warm-up). It is unmodified and can be replaced with any compatible
  build. Source: https://github.com/hoppergee/heic-to and https://github.com/strukturag/libheif.
