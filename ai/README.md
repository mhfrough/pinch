# Pinch AI upscaling (`ai/`)

Real-ESRGAN runs in the browser with onnxruntime-web, inside a module Web Worker. Nothing is uploaded and
every file loads from this origin: no CDN, no network calls besides same-origin files.

## API (`ai/ai.js`, a classic script that sets `window.PinchAI`)

```
PinchAI.available() -> Promise<{ webgpu, webgl, wasm, modelBytes, cached }>
PinchAI.upscale(fileOrBlob, { scale: 2|4, signal, onProgress(fraction, label) }) -> Promise<Blob>  // PNG, exact scale
```

- `webgpu` is true only when a WebGPU device can actually be created (an adapter alone is not enough).
- `webgl` is true for WebGL 2 on a hardware GPU. It is informational only: Pinch does not upscale on WebGL
  (see "WebGL" below).
- `modelBytes` is the model download (2,441,140 bytes); `cached` is true once it sits in the Cache API.
- `onProgress(fraction, label)`: fraction only ever grows and ends at exactly 1. Labels: "Opening image",
  "Loading AI engine", "Downloading AI model", "Starting AI engine", "Preparing transparency",
  "Upscaling tile N of M", "Saving PNG", "Done".
- `signal`: aborting rejects at once with a `DOMException` named `AbortError`. The worker is terminated (a tile in
  progress cannot be interrupted) and a fresh one starts on the next call; the model then comes from the cache.
- Calls are queued and run one at a time (they share one worker and one model).
- Errors are plain sentences meant for the UI. Too large: `err.code === 'too-large'` (name `RangeError`), e.g.
  "This image is too large for AI upscaling at 4x. The result would be 4400 x 4000 px (17.6 MP), and the limit is
  16.8 MP so your browser does not run out of memory. Try 2x, or resize it to at most 1073 x 976 px first."
- Extras (optional): `PinchAI.warm()` loads engine and model ahead of time; `PinchAI.maxOutputPixels` (4096 x 4096);
  `PinchAI.lastRun` (backend, tiles, timings of the last job). `upscale` also accepts
  `backend: 'webgpu'|'wasm'` to force one (used by the tests).

## How it works

- **Backends, in order:** WebGPU, then WebAssembly (SIMD, single thread; GitHub Pages cannot send the COOP/COEP
  headers that threads need; if the page ever is cross-origin isolated it uses up to 4 threads). If WebGPU fails to
  create a session, WebAssembly is used.
- **Tiles:** the image is split into equal tiles (at most 256 px on WebGPU, 192 on WASM), each read
  with 12 to 16 px of real neighbouring pixels as context, so memory stays bounded and there are no seams. All tiles
  have the same shape (crops shift inward at the borders), which suits GPU shader caches. Progress is reported per tile.
- **2x:** the x4 model runs and each padded tile is reduced by Lanczos-3 before cropping (`ai/resample.js`), so the
  filter sees real context at tile edges.
- **Alpha:** the alpha channel is resized separately with Lanczos-3 and recombined. Fully transparent pixels first
  get the colour of their nearest visible neighbours, so hidden colour does not bleed into visible edges.
- **Cap:** output at most 16.8 MP (4096 x 4096), checked before any work.
- **Cache:** the model is stored with the Cache API (`pinch-ai-v1`) on first use. It is same-origin anyway; the cache
  makes later visits instant and offline-proof. Bump the cache name when the model changes (old `pinch-ai-*` caches
  are deleted automatically).

## Model

| | |
|---|---|
| Model | Real-ESRGAN `realesr-general-x4v3` (SRVGGNetCompact, 64 features, 32 convs, x4, PReLU) |
| Source | https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth |
| Source SHA-256 | `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292` (4,885,111 bytes) |
| Licence | BSD-3-Clause, Copyright (c) 2021 Xintao Wang (`models/LICENSE`) |
| `models/realesr-general-x4v3.onnx` | float16 weights, float32 compute, any input size. 2,441,140 bytes, SHA-256 `d495788b8ec6e4aa635a63b332b81f243fadd86c538c770b453b11294112c9a7` |

We converted the official checkpoint ourselves (no third-party ONNX copy), with `tools/convert_model.py`. It reads the
.pth with a restricted unpickler (no PyTorch needed, no arbitrary code) and writes the graph with `onnx.helper`:

```
python -m venv venv && venv/Scripts/pip install onnx numpy onnxruntime
venv/Scripts/python -I tools/convert_model.py realesr-general-x4v3.pth models/realesr-general-x4v3.onnx --fp16-weights
```

(`--static 152x152` without `--fp16-weights` makes the float32, fixed-shape variant used for the WebGL trial below.)

Checks: the script compares the ONNX file with a NumPy implementation of the network, and we also compared it with
the official PyTorch `SRVGGNetCompact` (from `realesrgan/archs/srvgg_arch.py`, loaded with `strict=True`): max abs
difference 1.6e-3 on 0..1 RGB (under half a level of 255); the float32 variant matches to 5.4e-6.

Graph notes: the nearest x4 upsample of the input that the network adds back is written as a 1x1 convolution that
repeats each channel 16 times, added before `DepthToSpace(CRD)`. This is exact and avoids `Resize`.

## WebGL (tried, not used)

The lead asked for a WebGL path between WebGPU and WASM. onnxruntime-web 1.30's WebGL backend can run this network,
but only after three changes, found by trying it:

1. It has no float16 tensors ("unsupported data type: FLOAT16"), so it needs float32 weights (4.9 MB instead of 2.4 MB).
2. It rejects symbolic input sizes ("expected shape '[1,3,,]'") and inputs without a shape, so it needs a fixed input
   (we used 152 x 152 and padded each tile to it).
3. Its packed `Resize` has no nearest mode ("resize (packed) does not support mode: 'nearest'"); fixed for every
   backend by the 1x1 conv in the graph above.

It then gives correct output but is far too slow. One 128 px tile (152 px with context), x4, Edge 155 on an Intel UHD
Graphics 620 (hardware WebGL 2 through ANGLE/D3D11):

| Backend | Time per tile (warm) |
|---|---|
| WebGPU | 0.57 s |
| WebAssembly (1 thread) | 3.7 s |
| WebGL, packed (default) | 32.5 s |
| WebGL, unpacked | 69 s |
| WebGL on SwiftShader (software) | 60 s |

WebGL is about 9 times slower than WebAssembly, so a WebGL step would only make upscaling slower for the browsers
that would reach it (those without WebGPU). Pinch therefore keeps WebGPU, then WebAssembly, and does not ship the
WebGL bundle (472 KB) or the float32 model (4.9 MB). `available().webgl` still reports hardware WebGL 2 support.

## onnxruntime-web (`ort/`)

onnxruntime-web 1.30.0, MIT (`ort/LICENSE`), copied from npm without source maps:

| File | Bytes | Used by |
|---|---|---|
| `ort.webgpu.min.mjs` | 66,305 | WebGPU |
| `ort-wasm-simd-threaded.asyncify.mjs` / `.wasm` | 53,057 / 26,781,914 | WebGPU (gzip: 6.6 MB) |
| `ort.wasm.min.mjs` | 50,084 | WASM |
| `ort-wasm-simd-threaded.mjs` / `.wasm` | 24,381 / 14,239,897 | WASM (gzip: 3.7 MB) |

`ort.env.wasm.wasmPaths` points at `ai/ort/`. Each visitor only downloads one backend's files plus one model.

Shipped total for `ai/`: 43.7 MB. What one visitor downloads: WebGPU about 29.4 MB (26.9 MB runtime + 2.4 MB model),
WASM about 16.8 MB (14.3 MB + 2.4 MB). Less on hosts that gzip `.wasm` (6.6 MB / 3.7 MB). Then cached by the browser
(and the model by the Cache API).

## Measured speed

320 x 213 crop of `assets/samples/p989.jpg`, Edge 155, Intel Core laptop with UHD Graphics 620 (laptop timings vary
by about 30% with heat):

| Backend | x4 (1280 x 852), first run incl. engine start | x4, warm | x2 (640 x 426), warm |
|---|---|---|---|
| WebGPU | 8.9 s | 3.6 s | 4.1 s |
| WebAssembly, 1 thread | 15 to 24 s | 14 to 22 s | 14 to 23 s |

Roughly: WASM does about 3,500 to 4,500 input pixels per second here and WebGPU about 5 times that. A 1 MP input
(the 4x limit) would take about 4 to 5 minutes on WASM and under a minute on WebGPU; the UI should show progress
and offer cancel. WebGPU output matches WASM (mean difference 0.001 of 255, max 1).

## Tests

`node tests/run-ai-tests.mjs [--channel msedge]` (server for `pinch/` on port 8150) drives `tests/ai.html` in
Chromium on the real GPU (ANGLE/D3D11), or SwiftShader with `--software`. Playwright's bundled Chromium on Windows
finds a WebGPU adapter but cannot create a device (it lacks `dxil.dll`), so WebGPU is timed with `--channel msedge`
(installed Edge); the bundled run checks the fallback to WASM. It writes `tests/shots/ai-compare.png`
(nearest vs Lanczos vs AI).
