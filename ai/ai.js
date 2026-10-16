/* Pinch AI upscaling: window.PinchAI
 *
 *   PinchAI.available() -> Promise<{ webgpu, webgl, wasm, modelBytes, cached }>
 *   PinchAI.upscale(fileOrBlob, { scale: 2|4, signal, onProgress(fraction, label) }) -> Promise<Blob>  (PNG)
 *
 * Real-ESRGAN (realesr-general-x4v3) on onnxruntime-web, inside a module worker (ai/worker.js).
 * Backend order: WebGPU, then WebAssembly. `webgl` in available() is informational only: onnxruntime's
 * WebGL backend runs this model about 9x slower than WebAssembly, so it is not used (see ai/README.md).
 * Everything loads from this origin; the model is kept in the Cache API after the first use.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var BASE = new URL('./', (script && script.src) || location.href);
  var WORKER_URL = new URL('worker.js', BASE).href;
  var MODEL_URL = new URL('models/realesr-general-x4v3.onnx', BASE).href;
  var MODEL_BYTES = 2441140; // models/realesr-general-x4v3.onnx
  var CACHE_NAME = 'pinch-ai-v1';
  var MAX_OUTPUT_PIXELS = 4096 * 4096; // about 16.8 MP

  var worker = null;
  var nextId = 1;
  var queue = Promise.resolve();
  var pending = new Map();

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL, { type: 'module', name: 'pinch-ai' });
    worker.onmessage = function (e) {
      var msg = e.data;
      var job = pending.get(msg.id);
      if (!job) return;
      if (msg.type === 'progress') job.progress(msg.fraction, msg.label);
      else if (msg.type === 'done' || msg.type === 'warm') { pending.delete(msg.id); job.resolve(msg); }
      else if (msg.type === 'error') {
        pending.delete(msg.id);
        var err = msg.name === 'AbortError' ? abortError() : new Error(msg.message);
        job.reject(err);
      }
    };
    worker.onerror = function (e) {
      var err = new Error('The AI engine stopped unexpectedly' + (e && e.message ? ': ' + e.message : '.') + ' Reload the page and try again.');
      killWorker(err);
    };
    return worker;
  }

  function killWorker(reason) {
    if (worker) worker.terminate();
    worker = null;
    pending.forEach(function (job) { job.reject(reason); });
    pending.clear();
  }

  function abortError() {
    try { return new DOMException('Upscale cancelled', 'AbortError'); }
    catch (_) { var e = new Error('Upscale cancelled'); e.name = 'AbortError'; return e; }
  }

  // An adapter is not enough: some builds find one but cannot create a device (e.g. missing DXC on Windows).
  var gpuCheck = null;
  function hasWebGPU() {
    if (!gpuCheck) {
      gpuCheck = (async function () {
        try {
          if (!navigator.gpu) return false;
          var adapter = await navigator.gpu.requestAdapter();
          if (!adapter) return false;
          var device = await adapter.requestDevice();
          var lost = await Promise.race([
            device.lost.then(function () { return true; }),
            new Promise(function (r) { setTimeout(function () { r(false); }, 100); })
          ]);
          device.destroy();
          return !lost;
        } catch (_) { return false; }
      })();
    }
    return gpuCheck;
  }

  // true for WebGL 2 on a hardware GPU (not SwiftShader/llvmpipe). Reported only; not used for upscaling.
  function hasWebGL() {
    try {
      var c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      var gl = c.getContext('webgl2');
      if (!gl) return false;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return !/swiftshader|llvmpipe|software|basic render/i.test(name);
    } catch (_) { return false; }
  }

  async function isCached(url) {
    try {
      if (!window.caches) return false;
      var cache = await caches.open(CACHE_NAME);
      return !!(await cache.match(url));
    } catch (_) { return false; }
  }

  async function available() {
    var wasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function' && typeof Worker === 'function';
    var res = await Promise.all([hasWebGPU(), isCached(MODEL_URL)]);
    return { webgpu: res[0], webgl: hasWebGL(), wasm: wasm, modelBytes: MODEL_BYTES, cached: res[1] };
  }

  function fmtMP(px) { return (px / 1e6).toFixed(1).replace(/\.0$/, '') + ' MP'; }

  function tooBig(w, h, scale) {
    var maxIn = MAX_OUTPUT_PIXELS / (scale * scale);
    var k = Math.sqrt(maxIn / (w * h));
    var fitW = Math.max(1, Math.floor(w * k)), fitH = Math.max(1, Math.floor(h * k));
    var msg = 'This image is too large for AI upscaling at ' + scale + 'x. The result would be ' +
      (w * scale) + ' x ' + (h * scale) + ' px (' + fmtMP(w * h * scale * scale) + '), and the limit is ' +
      fmtMP(MAX_OUTPUT_PIXELS) + ' so your browser does not run out of memory. ' +
      (scale === 4 && w * h * 4 <= MAX_OUTPUT_PIXELS ? 'Try 2x, or resize' : 'Resize') +
      ' it to at most ' + fitW + ' x ' + fitH + ' px first.';
    var err = new Error(msg);
    err.name = 'RangeError';
    err.code = 'too-large';
    err.maxPixels = MAX_OUTPUT_PIXELS;
    return err;
  }

  async function decode(blob) {
    var bmp;
    try {
      bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
    } catch (_) {
      bmp = await new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This image could not be opened for AI upscaling. Try converting it to PNG or JPEG first.')); };
        img.src = url;
      });
    }
    var w = bmp.naturalWidth || bmp.width, h = bmp.naturalHeight || bmp.height;
    return { source: bmp, width: w, height: h };
  }

  function pixelsOf(img) {
    var canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img.source, 0, 0);
    if (img.source.close) img.source.close();
    return ctx.getImageData(0, 0, img.width, img.height).data;
  }

  function encodePNG(pixels, w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('The upscaled image could not be saved as PNG.')); }, 'image/png');
    });
  }

  async function runJob(blob, opts) {
    var scale = Number(opts.scale) || 4;
    if (scale !== 2 && scale !== 4) throw new RangeError('AI upscaling supports 2x or 4x.');
    var signal = opts.signal;
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var last = 0;
    function progress(f, label) {
      f = Math.max(last, Math.min(1, f)); // never goes backwards
      last = f;
      try { onProgress(f, label); } catch (_) { /* a UI bug must not break the job */ }
    }
    if (signal && signal.aborted) throw abortError();
    if (!(blob instanceof Blob)) throw new TypeError('PinchAI.upscale needs a File or Blob.');

    progress(0, 'Opening image');
    var img = await decode(blob);
    if (!img.width || !img.height) throw new Error('This image has no pixels to upscale.');
    if (img.width * img.height * scale * scale > MAX_OUTPUT_PIXELS) {
      if (img.source.close) img.source.close();
      throw tooBig(img.width, img.height, scale);
    }
    if (signal && signal.aborted) throw abortError();
    var rgba = pixelsOf(img);

    var id = nextId++;
    var w = getWorker();
    var t0 = performance.now();
    var result = await new Promise(function (resolve, reject) {
      var onAbort = function () {
        // Stop at once: terminate the worker (a running tile cannot be interrupted) and start fresh next time.
        pending.delete(id);
        killWorker(abortError());
        reject(abortError());
      };
      pending.set(id, {
        progress: progress,
        resolve: function (m) { if (signal) signal.removeEventListener('abort', onAbort); resolve(m); },
        reject: function (e) { if (signal) signal.removeEventListener('abort', onAbort); reject(e); }
      });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      w.postMessage({ type: 'run', id: id, rgba: rgba.buffer, width: img.width, height: img.height, scale: scale, backend: opts.backend || 'auto' }, [rgba.buffer]);
    });

    var out = result.blob || (await encodePNG(result.pixels, result.width, result.height));
    api.lastRun = Object.assign({ ms: Math.round(performance.now() - t0), width: result.width, height: result.height, scale: scale }, result.stats);
    progress(1, 'Done');
    return out;
  }

  function upscale(fileOrBlob, opts) {
    opts = opts || {};
    // One job at a time: they share one model and one worker.
    var job = queue.then(function () { return runJob(fileOrBlob, opts); });
    queue = job.catch(function () {});
    return job;
  }

  // Optional: load the engine and model ahead of time (e.g. when the user picks "AI (detail)").
  function warm(opts) {
    opts = opts || {};
    var job = queue.then(function () {
      var id = nextId++;
      return new Promise(function (resolve, reject) {
        pending.set(id, { progress: function () {}, resolve: function (m) { resolve({ backend: m.backend }); }, reject: reject });
        getWorker().postMessage({ type: 'warm', id: id, backend: opts.backend || 'auto' });
      });
    });
    queue = job.catch(function () {});
    return job;
  }

  var api = {
    available: available,
    upscale: upscale,
    warm: warm,
    maxOutputPixels: MAX_OUTPUT_PIXELS,
    modelBytes: MODEL_BYTES,
    lastRun: null
  };
  window.PinchAI = api;
})();
