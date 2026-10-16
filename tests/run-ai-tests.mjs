// Runs tests/ai.html in Chromium and checks PinchAI.
//   node pinch/tests/run-ai-tests.mjs [--base http://localhost:8150] [--channel msedge] [--software] [--headed]
// Needs a server for pinch/ (python -m http.server 8150 --directory pinch).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || 'D:/workspace-personal/mhfrough_projects/quorum/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8150');
const headed = process.argv.includes('--headed');

let failures = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
};

async function newPage(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.goto(`${BASE}/tests/ai.html`);
  await page.waitForFunction(() => window.runAiTests && window.PinchAI);
  return { page, errors, external };
}

// --channel msedge|chrome uses an installed browser. Playwright's own Chromium on Windows finds a WebGPU
// adapter but cannot create a device (no dxil.dll), so WebGPU is only timed with an installed browser.
const channel = arg('--channel', undefined);
const browser = await chromium.launch({
  channel,
  headless: !headed,
  // Use the real GPU through ANGLE/D3D11 (Windows) so WebGPU and hardware WebGL can be timed.
  // Pass --software to force SwiftShader instead (then WebGPU is absent and WebGL is software).
  args: process.argv.includes('--software')
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu']
});
try {
  // 1. Full suite on the WASM backend.
  const { page, errors, external } = await newPage(browser);
  page.setDefaultTimeout(600000);
  const R = await page.evaluate(() => runAiTests({ backend: 'wasm' }));
  const shots = join(here, 'shots');
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, 'ai-compare.png'), Buffer.from(R.compareDataUrl.split(',')[1], 'base64'));
  delete R.compareDataUrl;

  console.log('available():', JSON.stringify(R.available));
  check(R.available.wasm === true, 'available().wasm');
  check(R.available.modelBytes > 1e6, 'available().modelBytes', R.available.modelBytes);
  for (const [k, w, h] of [['photo_x4', 1280, 852], ['photo_x2', 640, 426], ['alpha_x2', 192, 128], ['alpha_x4', 384, 256]]) {
    const r = R[k];
    check(r.w === w && r.h === h && r.type === 'image/png', `${k} exact size PNG`, `${r.w}x${r.h} ${r.type}, ${r.ms} ms on ${r.run.backend}, ${r.run.tiles} tiles`);
    check(r.progressEnd === 1 && r.monotonic, `${k} progress reaches 1 and never goes back`, `${r.progressCount} updates`);
  }
  check(R.cachedAfterRun === true, 'model stored in the Cache API after first use');
  for (const s of [2, 4]) {
    const a = R['alpha_x' + s];
    check(a.cornerAlpha === 0 && a.centreAlpha === 255, `alpha x${s}: transparent stays transparent, opaque stays opaque`, `corner ${a.cornerAlpha}, centre ${a.centreAlpha}`);
    check(Math.abs(a.barAlpha - a.inputBarAlpha) <= 2, `alpha x${s}: half-transparent area kept`, `${a.barAlpha} vs input ${a.inputBarAlpha}`);
    check(a.alphaVsLanczos.mean < 0.5, `alpha x${s}: alpha matches a Lanczos resize`, JSON.stringify(a.alphaVsLanczos));
    check(a.run.hasAlpha === true, `alpha x${s}: alpha path used`);
  }
  check(R.cancel.errName === 'AbortError' && R.cancel.sawTile, 'cancel rejects with AbortError', `${R.cancel.rejectMsAfterAbort} ms after abort`);
  check(R.cancel.rejectMsAfterAbort < 250, 'cancel is immediate');
  check(R.cancel.afterwardsOk, 'works again after cancel', `${R.cancel.afterwardsMs} ms`);
  check(R.preAborted === 'AbortError', 'pre-aborted signal rejects');
  check(R.tooLarge && R.tooLarge.code === 'too-large' && R.tooLargeHint2x, 'size cap gives a friendly error', R.tooLarge && R.tooLarge.message);
  check(R.badScale === 'RangeError', 'scale other than 2 or 4 is refused');
  const sh = R.compareSharpness;
  check(sh['AI (Real-ESRGAN)'] > sh['Lanczos 3'] * 1.3, 'AI result is sharper than Lanczos (gradient energy)', JSON.stringify(sh));
  check(external.length === 0, 'no requests to other origins', external.join(', '));
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  console.log('\nWASM timings (320x213 crop):');
  console.log(`  x4 cold (engine + model + run): ${R.photo_x4.ms} ms  [engine ${R.photo_x4.run.msEngine} ms, inference ${R.photo_x4.run.msInfer} ms, encode ${R.photo_x4.run.msEncode} ms]`);
  console.log(`  x2 warm: ${R.photo_x2.ms} ms  [inference ${R.photo_x2.run.msInfer} ms]`);
  await page.close();

  // 2. Each backend in a fresh page: time it and compare its output with WASM.
  const { page: p2 } = await newPage(browser);
  const avail = await p2.evaluate(() => PinchAI.available());
  const gpuName = await p2.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'none'; });
  await p2.close();
  console.log(`\nGPU: ${gpuName}`);
  console.log('Per-backend timings, 320x213 crop (x4 -> 1280x852, x2 -> 640x426):');
  for (const b of ['webgpu', 'wasm']) {
    if (!avail[b]) { console.log(`  ${b}: not available in this browser (skipped)`); continue; }
    const { page: pb, errors: eb } = await newPage(browser);
    pb.setDefaultTimeout(900000);
    try {
      const T = await pb.evaluate((b) => timeBackend(b), b);
      const ran = [T.cold_x4, T.warm_x4, T.warm_x2].map((r) => r.run.backend);
      check(ran.every((r) => r === b) && T.warm_x4.w === 1280 && T.warm_x2.w === 640, `${b}: x4 and x2 ran on ${b}`, `ran on ${[...new Set(ran)].join(', ')}`);
      if (b !== 'wasm') check(T.vsWasm.mean < 1, `${b}: output matches WASM`, `mean abs diff ${T.vsWasm.mean}/255, max ${T.vsWasm.max}`);
      console.log(`  ${b}: x4 cold ${T.cold_x4.ms} ms (engine ${T.cold_x4.run.msEngine} ms), x4 warm ${T.warm_x4.ms} ms (inference ${T.warm_x4.run.msInfer} ms, ${T.warm_x4.run.tiles} tiles), x2 warm ${T.warm_x2.ms} ms`);
    } catch (e) {
      check(false, `${b}: runs`, e.message.split(String.fromCharCode(10))[0]);
    }
    if (eb.length) console.log(`  ${b} page errors: ${eb.join(' | ')}`);
    await pb.close();
  }
  // 3. Auto: which backend gets picked here.
  const { page: pa } = await newPage(browser);
  pa.setDefaultTimeout(600000);
  const auto = await pa.evaluate(async () => {
    const r = await fetch('../assets/samples/p989.jpg').then((r) => r.blob());
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    c.getContext('2d').drawImage(await createImageBitmap(r), 0, 0, 64, 48);
    const b = await new Promise((res) => c.toBlob(res));
    await PinchAI.upscale(b, { scale: 4 });
    return PinchAI.lastRun.backend;
  });
  console.log(`\nauto picks: ${auto}`);
  await pa.close();
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
