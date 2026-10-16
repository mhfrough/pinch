#!/usr/bin/env node
// Headless test run of tests/engine.html (WebAssembly mode, then the canvas fallback).
// Needs the static server on http://localhost:8150 serving pinch/ and Playwright with Chromium.
//   node pinch/tests/run-engine-tests.mjs
// PLAYWRIGHT_PATH may point at a folder containing node_modules/playwright.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pwRoot = process.env.PLAYWRIGHT_PATH || path.resolve(here, '..', '..', 'quorum');
const { chromium } = createRequire(path.join(pwRoot, 'noop.js'))('playwright');
const BASE = process.env.PINCH_URL || 'http://localhost:8150/tests/engine.html';

async function run(url, offline) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (process.env.VERBOSE && m.text().startsWith('[pinch-test]')) console.log('  ' + m.text().slice(13)); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  const loaded = new Set();
  page.on('requestfinished', (r) => { const u = new URL(r.url()); if (u.pathname.includes('/codecs/')) loaded.add(path.basename(u.pathname)); });
  await page.goto(url);
  if (offline) {
    await page.waitForFunction(() => window.__warmed || (window.__results && window.__results.done), null, { timeout: 5 * 60 * 1000, polling: 250 });
    await context.setOffline(true);
    await page.evaluate(() => { window.__offline = true; });
  }
  await page.waitForFunction(() => window.__results && window.__results.done, null, { timeout: 15 * 60 * 1000, polling: 500 });
  const results = await page.evaluate(() => window.__results);
  await browser.close();
  return { results, errors, external, loaded: [...loaded].sort() };
}

function verifyZip(b64, expect) {
  const file = path.join(os.tmpdir(), 'pinch-test-' + process.pid + '.zip');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  const py = 'import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad":z.testzip(),"names":z.namelist(),"sizes":[i.file_size for i in z.infolist()]}))';
  const out = JSON.parse(execFileSync('python', ['-c', py, file], { encoding: 'utf8' }));
  fs.unlinkSync(file);
  const ok = out.bad === null && JSON.stringify(out.names) === JSON.stringify(expect.names) && JSON.stringify(out.sizes) === JSON.stringify(expect.sizes);
  return { ok, detail: JSON.stringify(out) };
}

let failed = 0;
const ONLY = process.argv[2]; // optional: wasm | offline | fallback
const PASSES = [
  ['wasm', 'WebAssembly', BASE, false],
  ['offline', 'offline after warm-up (?offline)', BASE + '?offline', true],
  ['fallback', 'fallback (?pinch-nowasm)', BASE + '?pinch-nowasm', false],
];
for (const [key, label, url, offline] of PASSES) {
  if (ONLY && ONLY !== key) continue;
  console.log('\n=== ' + label + ' ===');
  const { results, errors, external, loaded } = await run(url, offline);
  if (results.fatal) { console.log('FATAL ' + results.fatal); failed++; continue; }
  if (results.zipBase64) {
    const z = verifyZip(results.zipBase64, results.zipExpect);
    results.checks.push({ name: 'zip opens in Python zipfile with the right names and sizes', ok: z.ok, detail: z.detail });
  }
  results.checks.push({ name: 'no requests to other hosts', ok: external.length === 0, detail: external.join(' ') });
  for (const c of results.checks) {
    if (!c.ok) failed++;
    console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  [' + c.detail + ']' : ''));
  }
  if (Object.keys(results.timings).length) {
    console.log('\nTimings on a 2400x1600 photo (cold = first use incl. codec download/compile and decode; warm = cached decode + encode):');
    for (const [k, t] of Object.entries(results.timings)) console.log('  ' + k.padEnd(16) + String(t.coldMs ?? '-').padStart(7) + ' ms cold ' + String(t.warmMs).padStart(7) + ' ms warm ' + String(Math.round(t.bytes / 1024)).padStart(7) + ' KB');
  }
  if (Object.keys(results.sizes).length) console.log('\nSizes: ' + JSON.stringify(results.sizes, null, 1));
  if (results.compare) console.log('Compare: ' + JSON.stringify(results.compare));
  if (loaded.length) console.log('Codec files fetched: ' + loaded.join(', '));
  const realErrors = errors.filter((e) => !(offline && /ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/.test(e)));
  if (realErrors.length) console.log('Console errors:\n  ' + realErrors.join('\n  '));
}
console.log('\n' + (failed ? failed + ' check(s) FAILED' : 'All checks passed'));
process.exit(failed ? 1 : 0);
