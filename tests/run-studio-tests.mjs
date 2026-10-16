// Pinch studio end-to-end tests (Playwright, Chromium).
//   node pinch/tests/run-studio-tests.mjs            all tests + screenshots
//   node pinch/tests/run-studio-tests.mjs --shots    screenshots only
//   STUDIO_URL=http://localhost:8150/ node ...       run against the real index.html
// Needs the static server: python -m http.server 8150 --directory pinch
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TMP = 'D:\\workspace-personal\\mhfrough_projects\\.devcache\\tmp';
fs.mkdirSync(TMP, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = TMP;

const PW = 'D:\\workspace-personal\\mhfrough_projects\\quorum\\node_modules\\playwright\\index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const URL_ = process.env.STUDIO_URL || 'http://localhost:8150/tests/studio.html';
const SAMPLES = ['p11.jpg', 'p266.jpg', 'p353.jpg', 'p989.jpg'].map((f) => path.join(ROOT, 'assets', 'samples', f));
const SHOTS_ONLY = process.argv.includes('--shots');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}

const browser = await chromium.launch({ args: ['--enable-features=SharedArrayBuffer'] });

async function open(viewport, colorScheme, extra = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: viewport.width < 600 ? 2 : 1, acceptDownloads: true, ...extra });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__cls = 0; window.__shifts = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__cls += e.value;
          window.__shifts.push({ v: e.value, nodes: (e.sources || []).map((s) => s.node && (s.node.className || s.node.nodeName)) });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) { /* not supported */ }
  });
  await page.goto(URL_, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.PinchStudio && document.fonts && document.fonts.status === 'loaded', null, { timeout: 60000 });
  } catch (e) {
    console.log('  page did not boot:', JSON.stringify(await page.evaluate(() => ({ studio: !!window.PinchStudio, fonts: document.fonts.status, pinch: !!window.Pinch }))), errors);
    throw e;
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.ps-sample img')).every((i) => i.complete && i.naturalWidth > 0));
  return { ctx, page, errors };
}
const idle = (page) => page.evaluate(() => window.PinchStudio.idle()).then(() => page.waitForTimeout(60));
const files = (page) => page.evaluate(() => window.PinchStudio.files);
async function addSamples(page) {
  await page.setInputFiles('.ps-pick', SAMPLES);
  await page.waitForFunction(() => window.PinchStudio.files.length >= 4);
  await page.waitForTimeout(200);
  await idle(page);
}
const pick = (page, name, value) => page.click(`label:has(> input[name="${name}"][value="${value}"])`);
async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
}
async function shot(page, name) {
  await page.waitForTimeout(450); // let transitions settle
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log('  shot ' + name);
}

// ---------------------------------------------------------------- screenshots
const sizes = [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]];
for (const [label, vp] of sizes) {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errors } = await open(vp, scheme);
    await page.evaluate(() => scrollTo(0, 0));
    check(`empty ${label} ${scheme}: no horizontal overflow`, await noOverflow(page));
    const fits = await page.evaluate(() => { const h = document.querySelector('.ps-hero').getBoundingClientRect(); return h.bottom <= innerHeight + 1; });
    check(`empty ${label} ${scheme}: hero fits the first screen`, fits);
    await page.waitForFunction(() => { const d = document.querySelector('.ps-demo'); return !d || !d.offsetParent || (!document.querySelector('.ps-demo-tag').classList.contains('is-busy') && !d.classList.contains('is-stale')); }, null, { timeout: 60000 });
    check(`empty ${label} ${scheme}: live preview shows a real size`, await page.evaluate(() => { const d = document.querySelector('.ps-demo'); return !d.offsetParent || /KB|MB/.test(d.querySelector('.ps-tag-b b').textContent); }));
    await shot(page, `studio-empty-${label}-${scheme}.png`);
    await addSamples(page);
    await page.mouse.move(5, 5);
    await page.evaluate(() => scrollTo(0, 0));
    check(`work ${label} ${scheme}: no horizontal overflow`, await noOverflow(page));
    await shot(page, `studio-work-${label}-${scheme}.png`);
    if (label === '390') {
      await page.click('.ps-grab');
      await shot(page, `studio-sheet-${label}-${scheme}.png`);
      const box = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
        return { insp: r('.ps-insp'), bar: r('.ps-bar'), work: r('.ps-work') };
      });
      check(`sheet ${scheme}: open sheet sits above the bar`, box.insp.bottom <= box.bar.top + 1 && box.insp.top >= box.work.top, box.insp);
      await page.click('.ps-grab');
    }
    check(`${label} ${scheme}: no console errors`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- the real page (index.html)
{
  const INDEX = new URL('/', URL_).href;
  for (const w of [1440, 1024, 768, 390]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : w < 1100 ? 1024 : 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      await page.goto(INDEX, { waitUntil: 'load' });
      await page.waitForFunction(() => window.PinchStudio, null, { timeout: 60000 });
      await page.waitForFunction(() => { const d = document.querySelector('.ps-demo'); return !d.offsetParent || !d.classList.contains('is-stale'); }, null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => {
        const sec = document.getElementById('studio').getBoundingClientRect();
        const ps = document.querySelector('.ps').getBoundingClientRect();
        let deepest = 0;
        document.querySelectorAll('#studio .ps-empty *').forEach((n) => { const r = n.getBoundingClientRect(); if (r.height && n.offsetParent) deepest = Math.max(deepest, r.bottom); });
        const next = document.getElementById('studio').nextElementSibling;
        return { secBottom: sec.bottom, psBottom: ps.bottom, deepest, nextTop: next ? next.getBoundingClientRect().top : null, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      check(`index ${w} ${scheme}: studio content stays inside #studio`, m.deepest <= m.secBottom + 1 && (m.nextTop === null || m.nextTop >= m.secBottom - 1) && !m.overflow, m);
      if (w === 1024 || w === 768) await page.screenshot({ path: path.join(SHOTS, `studio-index-${w}-${scheme}.png`) });
      if (w === 1440 && scheme === 'light') {
        await page.evaluate(() => { window.__pf = []; window.addEventListener('pinch:files', (e) => window.__pf.push(e.detail.count)); });
        await page.setInputFiles('.ps-pick', SAMPLES.slice(0, 2));
        await page.click('[data-act="clear"]').catch(() => {});
        await page.click('.ps-sample >> nth=0');
        await page.waitForTimeout(800);
        const pf = await page.evaluate(() => window.__pf);
        check('pinch:files fires with the count of files added', JSON.stringify(pf) === '[2,1]', pf);
      }
      check(`index ${w} ${scheme}: no page errors`, errs.length === 0, errs.slice(0, 3));
      await ctx.close();
    }
  }
}

if (!SHOTS_ONLY) {
  // -------------------------------------------------------------- functional tests (desktop)
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, 'light');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(URL_).origin });

  check('empty: h1 present', await page.locator('h1.ps-h1').isVisible());
  check('empty: four samples', (await page.locator('.ps-sample').count()) === 4);

  // sample button through the UI
  await page.click('.ps-sample >> nth=1');
  await page.waitForFunction(() => window.PinchStudio.files.length === 1);
  await idle(page);
  let f = await files(page);
  check('sample button opens one file and encodes it', f.length === 1 && f[0].status === 'done' && f[0].out > 0, f[0]);
  await page.click('[data-act="clear"]');
  check('clear returns to the empty state', await page.locator('.ps-empty').isVisible());

  // load the four samples through the file input (the real picker path)
  const t0 = Date.now();
  await addSamples(page);
  f = await files(page);
  check('4 files encoded with the Web preset', f.length === 4 && f.every((x) => x.status === 'done'), Date.now() - t0 + ' ms');
  check('Web preset: WebP and smaller than originals', f.every((x) => x.format === 'webp' && x.out < x.bytes), f.map((x) => [x.bytes, x.out]));
  const cls = await page.evaluate(() => window.__cls);
  check('no layout shift while results arrive (CLS < 0.02)', cls < 0.02, cls.toFixed(4));
  const tot = await page.textContent('.ps-totals');
  check('totals show before and after', /4 files/.test(tot) && /smaller/.test(tot), tot.replace(/\s+/g, ' ').trim());

  // format change
  const webpBytes = (await files(page))[0].out;
  await pick(page, 'ps-fmt', 'jpeg');
  await idle(page);
  f = await files(page);
  check('format JPG re-encodes every file', f.every((x) => x.format === 'jpeg'), f.map((x) => x.format));
  check('result panel shows JPG', /JPG/.test(await page.textContent('.ps-res-fmt')));
  check('preset switches to Custom', await page.isChecked('input[name="ps-preset"][value="custom"]'));

  // quality
  const before = (await files(page))[0].out;
  await page.$eval('#ps-q', (el) => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await idle(page);
  const after = (await files(page))[0].out;
  check('lower quality makes a smaller file', after < before, [before, after]);
  check('quality readout updates', (await page.textContent('.ps-f-quality output')).trim() === '35');

  // presets
  await pick(page, 'ps-preset', 'email');
  await idle(page);
  f = await files(page);
  check('Email preset: JPG under 1 MB', f.every((x) => x.format === 'jpeg' && x.out <= 1e6), f.map((x) => x.out));
  await pick(page, 'ps-preset', 'social');
  await idle(page);
  f = await files(page);
  check('Social preset: fits 1080 x 1350', f.every((x) => x.width <= 1080 && x.height <= 1350), f.map((x) => [x.width, x.height]));
  await pick(page, 'ps-preset', 'favicon');
  await idle(page);
  f = await files(page);
  check('Favicon preset: ICO', f.every((x) => x.format === 'ico'), f.map((x) => x.format));
  await pick(page, 'ps-preset', 'lossless');
  await idle(page);
  f = await files(page);
  check('Lossless preset: PNG', f.every((x) => x.format === 'png' || x.kept), f.map((x) => x.format));
  const warnShown = await page.isVisible('.ps-warn');
  check('larger output shows a warning', !f.some((x) => x.out > x.bytes) || warnShown);
  await pick(page, 'ps-preset', 'web');
  await idle(page);

  // target size
  await page.click('label.ps-switch:has(#ps-t-on)');
  await page.fill('#ps-t-val', '100');
  await pick(page, 'ps-t-unit', 'KB');
  await idle(page);
  f = await files(page);
  check('target 100 KB: every file under 100 KB', f.every((x) => x.out <= 100000), f.map((x) => x.out));
  await page.click('label.ps-switch:has(#ps-t-on)');
  await idle(page);

  // resize
  await page.selectOption('#ps-rmode', 'width');
  await page.fill('#ps-w', '800');
  await idle(page);
  f = await files(page);
  check('resize to width 800', f.every((x) => x.width === 800), f.map((x) => x.width));
  await page.selectOption('#ps-rmode', 'none');
  await idle(page);

  // upscale 2x smooth
  await pick(page, 'ps-up', '2');
  await page.waitForSelector('.ps-f-method:not([hidden])');
  await idle(page);
  f = await files(page);
  check('upscale 2x doubles the size', f.every((x) => x.width === 4800), f.map((x) => [x.width, x.kept, x.status, x.format]).concat(await page.textContent('.ps-warn p')));
  check('AI detail option is offered', await page.isVisible('label:has(> input[name="ps-method"][value="ai"])'));
  await pick(page, 'ps-method', 'ai');
  await page.waitForTimeout(300);
  const aiText = await page.textContent('.ps-ai-text');
  check('AI detail shows a first-download notice with the model size', /model/.test(aiText) && /(KB|MB)/.test(aiText), aiText);
  // start an AI run on the current file only, check progress and Cancel, then cancel it
  await pick(page, 'ps-scope', 'file');
  await page.waitForSelector('.ps-ai-go:not([hidden])', { timeout: 10000 }).catch(() => {});
  if (await page.isVisible('.ps-ai-go')) await page.click('.ps-ai-go');
  try {
    await page.waitForSelector('.ps-res-cancel:not([hidden])', { timeout: 20000 });
    check('AI run shows a Cancel button', true);
    await page.waitForTimeout(1500);
    const lbl = (await page.textContent('.ps-res-l3')).trim();
    check('AI run shows a progress label', lbl.length > 0, lbl);
    await page.click('.ps-res-cancel');
    await page.waitForTimeout(300);
    const meta = await page.textContent('.ps-row.is-cur .ps-row-meta');
    check('Cancel stops the AI run', /Cancelled/.test(meta) && (await page.isHidden('.ps-res-cancel')), meta);
  } catch (e) { check('AI run shows a Cancel button', false, String(e.message).slice(0, 120)); }
  await pick(page, 'ps-scope', 'all');
  await pick(page, 'ps-method', 'sharp');
  await pick(page, 'ps-up', '1');
  await pick(page, 'ps-preset', 'web');
  await idle(page);

  // compare stage: divider by keyboard and by mouse
  await page.focus('.ps-vp .ps-split');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  check('divider moves with arrow keys', (await page.getAttribute('.ps-vp .ps-split', 'aria-valuenow')) === '40');
  const vp = await page.locator('.ps-vp').boundingBox();
  const knob = await page.locator('.ps-vp .ps-split-knob').boundingBox();
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(vp.x + vp.width * 0.25, knob.y + 10, { steps: 6 });
  await page.mouse.up();
  const sv = Number(await page.getAttribute('.ps-vp .ps-split', 'aria-valuenow'));
  check('divider drags with the mouse', Math.abs(sv - 25) <= 2, sv);
  await page.evaluate(() => document.activeElement.blur());

  // zoom
  await page.keyboard.press('1');
  let v = await page.evaluate(() => window.PinchStudio.view);
  check('1 sets 100%', Math.abs(v.zoom - 1) < 0.01 && (await page.textContent('.ps-zoomval')).trim() === '100%', v.zoom);
  await page.keyboard.press('f');
  v = await page.evaluate(() => window.PinchStudio.view);
  check('F fits', v.fit && v.zoom < 1, v.zoom);
  const z0 = v.zoom;
  await page.mouse.move(vp.x + vp.width * 0.6, vp.y + vp.height * 0.5);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  v = await page.evaluate(() => window.PinchStudio.view);
  check('wheel zooms in', v.zoom > z0 * 1.3, [z0, v.zoom]);
  const z1 = v.zoom;
  await page.keyboard.press('-');
  v = await page.evaluate(() => window.PinchStudio.view);
  check('- zooms out', v.zoom < z1, v.zoom);
  await page.keyboard.press('+');
  // pan
  const p0 = await page.evaluate(() => window.PinchStudio.view);
  await page.mouse.move(vp.x + vp.width * 0.7, vp.y + vp.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(vp.x + vp.width * 0.7 - 120, vp.y + vp.height * 0.4 + 60, { steps: 5 });
  await page.mouse.up();
  const p1 = await page.evaluate(() => window.PinchStudio.view);
  check('drag pans the image', Math.abs(p1.x - p0.x + 120) < 2 && Math.abs(p1.y - p0.y - 60) < 2, [p1.x - p0.x, p1.y - p0.y]);
  await page.click('[data-act="fit"]');
  check('Fit button', (await page.evaluate(() => window.PinchStudio.view)).fit);
  const outSrc = await page.getAttribute('.ps-img-b', 'src');
  check('output side shows the real encoded file', /^blob:/.test(outSrc || ''));
  const outDecoded = await page.evaluate(() => document.querySelector('.ps-img-b').naturalWidth);
  check('output image decodes', outDecoded > 0, outDecoded);

  // space for original
  await page.keyboard.down('Space');
  check('Space shows the original', await page.evaluate(() => document.querySelector('.ps-vp').classList.contains('is-orig')));
  await page.keyboard.up('Space');
  check('releasing Space shows the output', !(await page.evaluate(() => document.querySelector('.ps-vp').classList.contains('is-orig'))));

  // file navigation
  const c0 = await page.evaluate(() => window.PinchStudio.current);
  await page.keyboard.press(']');
  const c1 = await page.evaluate(() => window.PinchStudio.current);
  await page.keyboard.press('[');
  const c2 = await page.evaluate(() => window.PinchStudio.current);
  check('] and [ move between files', c0 !== c1 && c2 === c0, [c0, c1, c2]);

  // shortcuts sheet
  await page.keyboard.press('Shift+Slash');
  check('? opens the shortcuts sheet', await page.evaluate(() => document.querySelector('.ps-sheet').open));
  await page.waitForTimeout(450);
  await shot(page, 'studio-keys-1440-light.png');
  await page.keyboard.press('Escape');
  check('Escape closes it', !(await page.evaluate(() => document.querySelector('.ps-sheet').open)));

  // O opens the picker
  const chooser = page.waitForEvent('filechooser', { timeout: 3000 }).then(() => true, () => false);
  await page.keyboard.press('o');
  check('O opens the file picker', await chooser);

  // keys ignored while typing
  await page.selectOption('#ps-rmode', 'percent');
  await page.click('#ps-pct');
  await page.keyboard.press(']');
  check('shortcuts are ignored while typing', (await page.evaluate(() => window.PinchStudio.current)) === c0);
  await page.selectOption('#ps-rmode', 'none');
  await page.evaluate(() => document.activeElement.blur());
  await idle(page);

  // per-file override
  await pick(page, 'ps-scope', 'file');
  await pick(page, 'ps-fmt', 'png');
  await idle(page);
  f = await files(page);
  const curName = await page.evaluate(() => window.PinchStudio.current);
  const cur = f.find((x) => x.name === curName);
  const others = f.filter((x) => x.name !== curName);
  check('This file only: override applies to one file', cur.override && (cur.format === 'png' || cur.kept) && others.every((x) => !x.override && x.format === 'webp'), f.map((x) => [x.name, x.format, x.override]));
  check('row shows an override indicator', await page.isVisible('.ps-row.is-cur .ps-ovr'));
  await pick(page, 'ps-scope', 'all');
  await idle(page);
  f = await files(page);
  check('All files clears the override', f.every((x) => !x.override && x.format === 'webp'));

  // smallest format hint (Pinch.compare)
  try {
    await page.waitForFunction(() => document.querySelector('.ps-row.is-cur .ps-hint-btn, .ps-row.is-cur .ps-meta-ok'), null, { timeout: 60000 });
    check('smallest format hint appears', true, (await page.textContent('.ps-row.is-cur .ps-row-meta')).trim());
  } catch (e) { check('smallest format hint appears', false, 'timed out'); }

  // save current
  const dl1 = page.waitForEvent('download');
  await page.keyboard.press('s');
  const d1 = await dl1;
  check('S saves the current image', /\.webp$/.test(d1.suggestedFilename()), d1.suggestedFilename());

  // save all (ZIP)
  const dl2 = page.waitForEvent('download');
  await page.keyboard.press('Shift+S');
  const d2 = await dl2;
  const zipPath = path.join(TMP, 'studio-test.zip');
  await d2.saveAs(zipPath);
  let zipInfo = '';
  try {
    zipInfo = execFileSync('python', ['-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"bad": z.testzip(), "names": z.namelist(), "sizes": [i.file_size for i in z.infolist()]}))', zipPath], { encoding: 'utf8' });
    const zi = JSON.parse(zipInfo);
    check('Save all makes a valid ZIP with 4 images', zi.bad === null && zi.names.length === 4 && zi.names.every((n) => /\.webp$/.test(n)), zi.names);
  } catch (e) { check('Save all makes a valid ZIP with 4 images', false, String(e.message || e).slice(0, 200)); }

  // copy to clipboard
  if (await page.isVisible('[data-act="copy"]')) {
    await page.click('[data-act="copy"]');
    await page.waitForTimeout(800);
    const t = await page.textContent('.ps-toast-t');
    check('Copy puts the image on the clipboard', /Copied/.test(t), t);
  }

  // a larger output shows the warning
  await pick(page, 'ps-fmt', 'bmp');
  await idle(page);
  check('BMP (larger) shows a clear warning', await page.isVisible('.ps-warn'), (await page.textContent('.ps-warn p')).trim());
  await pick(page, 'ps-preset', 'web');
  await idle(page);

  // Delete removes the current file
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Delete');
  check('Delete removes the current file', (await files(page)).length === 3);

  // an unsupported file shows an error with a fix in its row
  await page.setInputFiles('.ps-pick', { name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('not really a heic file, just bytes for the test') });
  await page.waitForFunction(() => window.PinchStudio.files.some((x) => x.name === 'IMG_0001.heic' && x.status === 'error'), null, { timeout: 20000 }).catch(() => {});
  const errRow = await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.ps-row')).find((x) => x.textContent.includes('IMG_0001.heic')); return r ? { s: r.dataset.status, t: r.querySelector('.ps-row-meta').textContent } : null; });
  check('HEIC error appears in the row with a fix-it message', errRow && errRow.s === 'error' && errRow.t.length > 20, errRow);
  await page.waitForTimeout(300);
  await shot(page, 'studio-error-1440-light.png');

  check('no layout overflow after all of that', await noOverflow(page));
  check('functional run: no console errors', errors.length === 0, errors.slice(0, 5));
  await ctx.close();

  // -------------------------------------------------------------- phone interactions
  {
    const { ctx: c2, page: p2, errors: e2 } = await open({ width: 390, height: 844 }, 'light', { hasTouch: true, isMobile: true });
    await addSamples(p2);
    const tb = await p2.evaluate(() => Array.from(document.querySelectorAll('.ps-tools button')).filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height));
    check('phone: toolbar buttons are at least 44px', tb.every((h) => h >= 44), tb);
    const ab = await p2.evaluate(() => Array.from(document.querySelectorAll('.ps-actions .btn')).filter((b) => b.offsetParent).map((b) => [b.getBoundingClientRect().width, b.getBoundingClientRect().height]));
    check('phone: bar buttons are at least 44px', ab.every(([w, h]) => w >= 44 && h >= 44), ab);
    const strip = await p2.evaluate(() => { const l = document.querySelector('.ps-list'); return { dir: getComputedStyle(l).flexDirection, h: l.getBoundingClientRect().height }; });
    check('phone: file strip is horizontal', strip.dir === 'row', strip);
    await p2.tap('.ps-row:nth-child(2) .ps-row-main');
    check('phone: tapping a thumbnail selects it', (await p2.evaluate(() => window.PinchStudio.current)) === 'p266.jpg');
    await p2.tap('.ps-grab');
    await p2.waitForTimeout(500);
    check('phone: grab handle opens the sheet', await p2.evaluate(() => document.querySelector('.ps-insp').classList.contains('is-open')));
    await p2.tap('label:has(> input[name="ps-fmt"][value="jpeg"])');
    await idle(p2);
    check('phone: format change from the sheet works', (await files(p2)).every((x) => x.format === 'jpeg'));
    check('phone: no console errors', e2.length === 0, e2.slice(0, 3));
    await c2.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('Failed:\n' + failed.map((r) => '  - ' + r.name).join('\n')); process.exitCode = 1; }
