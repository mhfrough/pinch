// "More free tools" section on the landing page (Playwright, Chromium).
//   node pinch/tests/run-more-tests.mjs
// Needs the static server: python -m http.server 8150 --directory pinch
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TMP = 'D:\\workspace-personal\\mhfrough_projects\\.devcache\\tmp';
fs.mkdirSync(TMP, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = TMP;

const PW = 'D:\\workspace-personal\\mhfrough_projects\\quorum\\node_modules\\playwright\\index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const URL_ = process.env.INDEX_URL || 'http://localhost:8150/';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}

const browser = await chromium.launch();
const EXPECT = ['flick', 'scrawl', 'sizzle', 'swoop', 'jot'].map((n) => `https://mhfrough.github.io/${n}/`);

for (const [w, cols] of [[1440, 4], [768, 2], [360, 1]]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 800 : 900 }, colorScheme: scheme, deviceScaleFactor: w < 600 ? 2 : 1 });
    const page = await ctx.newPage();
    const errs = [];
    const offsite = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('request', (r) => { if (/mhfrough\.github\.io/.test(r.url())) offsite.push(r.url()); });
    await page.goto(URL_, { waitUntil: 'load' });
    // sections above skip layout until near (content-visibility), so the page grows while scrolling: scroll to the end until it settles
    for (let i = 0, h = 0; i < 10; i++) {
      const nh = await page.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); return document.documentElement.scrollHeight; });
      if (nh === h) break;
      h = nh;
      await page.waitForTimeout(150);
    }
    await page.locator('#more').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !document.querySelector('#more .is-pending'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const sec = document.getElementById('more');
      const cards = [...sec.querySelectorAll('a.more-card')];
      const tops = new Set(cards.map((a) => Math.round(a.getBoundingClientRect().top)));
      return {
        hrefs: cards.map((a) => a.href),
        names: cards.map((a) => a.querySelector('.more-name').textContent),
        icons: cards.every((a) => { const s = a.querySelector('svg.more-ico'); return s && s.getAttribute('aria-hidden') === 'true' && s.getBoundingClientRect().width > 0; }),
        perRow: cards.filter((a) => Math.round(a.getBoundingClientRect().top) === Math.min(...tops)).length,
        shown: getComputedStyle(sec.querySelector('.more-grid')).opacity === '1',
        lastBeforeFooter: sec === document.querySelector('main').lastElementChild,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    const tag = `more ${w} ${scheme}`;
    check(`${tag}: links to Flick, Scrawl, Sizzle, Swoop and Jot`, JSON.stringify(m.hrefs) === JSON.stringify(EXPECT), m.hrefs);
    check(`${tag}: Pinch is not listed`, !m.hrefs.some((h) => /pinch/i.test(h)) && !m.names.includes('Pinch'), m.names);
    check(`${tag}: every card has a hidden icon`, m.icons);
    check(`${tag}: ${cols} per row`, m.perRow === cols, m.perRow);
    check(`${tag}: cards are shown once scrolled to`, m.shown);
    check(`${tag}: last section before the footer`, m.lastBeforeFooter);
    check(`${tag}: no horizontal overflow`, !m.overflow);
    check(`${tag}: no requests to the other sites`, offsite.length === 0, offsite);
    if (w === 1440 && scheme === 'light') {
      await page.locator('a.more-card').first().focus();
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => { const a = document.activeElement; return a.matches('a.more-card') && getComputedStyle(a).boxShadow !== 'none'; });
      check(`${tag}: keyboard focus is visible`, ring);
      await page.locator('a.more-card').first().hover();
    }
    await page.locator('#more').screenshot({ path: path.join(SHOTS, `more-${w}-${scheme}.png`) });
    check(`${tag}: no page errors`, errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
