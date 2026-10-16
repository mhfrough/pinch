/* Pinch engine tests. Results land in window.__results for tests/run-engine-tests.mjs. */
(async function () {
  'use strict';
  if (/[?&]manual(=|&|$)/.test(location.search)) return; // load the page without running the suite
  const logEl = document.getElementById('log');
  const R = { mode: null, checks: [], timings: {}, sizes: {}, notes: {}, zipBase64: null, done: false };
  window.__results = R;
  const log = (s, cls) => {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = s;
    logEl.appendChild(line);
    console.log('[pinch-test] ' + s);
  };
  function check(name, ok, detail) {
    R.checks.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
    log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' - ' + detail : ''), ok ? 'pass' : 'fail');
  }
  async function test(name, fn) {
    try { await fn(); } catch (e) { check(name, false, (e && e.stack) || e); }
  }

  // ---------------------------------------------------------------- helpers
  const fetchFile = async (url, name, type) => {
    const b = await (await fetch(url)).blob();
    return new File([b], name, { type: type || b.type });
  };
  const dims = async (blob) => { const b = await createImageBitmap(blob); const d = { w: b.width, h: b.height }; b.close(); return d; };
  async function pixels(blob) {
    const b = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = b.width; c.height = b.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(b, 0, 0);
    const d = ctx.getImageData(0, 0, b.width, b.height);
    b.close();
    return { at: (x, y) => Array.from(d.data.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4)), w: d.width, h: d.height };
  }
  const canvasOf = (bmp, w, h) => {
    const c = document.createElement('canvas'); c.width = w || bmp.width; c.height = h || bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  };
  const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
  async function parseIco(blob) {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const v = new DataView(u8.buffer);
    if (v.getUint16(0, true) !== 0 || v.getUint16(2, true) !== 1) throw new Error('not an ICO');
    const n = v.getUint16(4, true), out = [];
    for (let i = 0; i < n; i++) {
      const e = 6 + i * 16;
      const w = u8[e] || 256, h = u8[e + 1] || 256, size = v.getUint32(e + 8, true), off = v.getUint32(e + 12, true);
      const png = new Blob([u8.subarray(off, off + size)], { type: 'image/png' });
      const d = await dims(png);
      out.push({ w, h, ok: d.w === w && d.h === h });
    }
    return out;
  }
  function graphicFile(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e66f5'; ctx.beginPath(); ctx.arc(w / 2, h / 2, h * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f5a524'; ctx.fillRect(w * 0.1, h * 0.1, w * 0.25, h * 0.2);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold ' + Math.round(h / 8) + 'px sans-serif'; ctx.fillText('Pinch', w * 0.35, h * 0.55);
    return toBlob(c, 'image/png').then((b) => new File([b], 'graphic.png', { type: 'image/png' }));
  }
  const b64 = async (blob) => {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const S = (o) => Object.assign({ format: 'jpeg', quality: 75 }, o);
  const kb = (n) => Math.round(n / 102.4) / 10 + ' KB';

  // ---------------------------------------------------------------- setup
  const st = await Pinch.ready;
  R.mode = st.wasm ? 'wasm' : 'fallback';
  R.ready = st;
  log('ready: ' + JSON.stringify(st));

  const samples = [];
  for (const n of ['p11', 'p266', 'p353', 'p989']) samples.push(await fetchFile('../assets/samples/' + n + '.jpg', n + '.jpg', 'image/jpeg'));
  const photoBmp = await createImageBitmap(samples[0]);
  const photoPng = new File([await toBlob(canvasOf(photoBmp), 'image/png')], 'photo.png', { type: 'image/png' });
  const smallPhoto = new File([await toBlob(canvasOf(photoBmp, 120, 80), 'image/png')], 'small.png', { type: 'image/png' });
  const graphic = await graphicFile(480, 320);
  window.__heicFile = await fetchFile('fixtures/sample.heic', 'IMG_0002.HEIC', '');

  if (!st.wasm) return runFallback();
  if (/[?&]offline(=|&|$)/.test(location.search)) return runOffline();

  await test('ready', async () => {
    check('ready.wasm is true', st.wasm === true);
    check('ready.workers in 1..4', st.workers >= 1 && st.workers <= 4, st.workers);
  });

  await test('inspect', async () => {
    const a = await Pinch.inspect(samples[0]);
    check('inspect photo', a.width === 2400 && a.height === 1600 && a.format === 'jpeg' && a.colours === 'photo' && !a.alpha && a.thumbUrl.startsWith('blob:'), JSON.stringify(a));
    const g = await Pinch.inspect(graphic);
    check('inspect graphic', g.colours === 'graphic' && g.alpha && g.format === 'png', JSON.stringify(g));
    for (const f of samples.slice(1)) {
      const i = await Pinch.inspect(f);
      check('inspect ' + f.name + ' is photo', i.colours === 'photo', i.colours);
    }
    try { await Pinch.inspect(new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'x.txt', { type: 'text/plain' })); check('inspect rejects non-image', false); }
    catch (e) { check('inspect rejects non-image with a friendly message', /not a picture/.test(e.message), e.message); }
  });

  // ---- round trips + timings on the 2400x1600 photo
  const ALL = [
    ['jpeg', {}], ['webp', {}], ['webp-lossless', { format: 'webp', lossless: true }], ['avif', {}],
    ['png', {}], ['png-256', { format: 'png', pngColors: 256 }], ['gif', {}], ['bmp', {}], ['ico', {}],
  ];
  await test('round trips', async () => {
    for (const [name, extra] of ALL) {
      const fmt = extra.format || name;
      const set = S(Object.assign({ format: fmt }, extra));
      const cold = await Pinch.process(photoPng, set);
      const warm = await Pinch.process(photoPng, Object.assign({}, set, { quality: 74 }));
      R.timings[name] = { coldMs: cold.ms, warmMs: warm.ms, bytes: cold.bytes };
      if (fmt === 'ico') {
        const entries = await parseIco(cold.blob);
        check('round trip ico', entries.length === 7 && entries.every((e) => e.ok), entries.map((e) => e.w).join(','));
      } else {
        const d = await dims(cold.blob);
        check('round trip ' + name, d.w === 2400 && d.h === 1600 && cold.blob.type === Pinch.FORMATS[fmt].mime && cold.format === fmt,
          d.w + 'x' + d.h + ' ' + kb(cold.bytes) + ' cold ' + cold.ms + ' ms, warm ' + warm.ms + ' ms');
      }
    }
  });

  await test('sizes', async () => {
    for (const f of samples) {
      const bmp = await createImageBitmap(f);
      const c = canvasOf(bmp);
      const canvasJpeg = await toBlob(c, 'image/jpeg', 0.75);
      const png = new File([await toBlob(c, 'image/png')], f.name.replace('.jpg', '.png'), { type: 'image/png' });
      const moz = await Pinch.process(png, S({ format: 'jpeg', quality: 75 }));
      R.sizes[f.name] = { mozjpeg75: moz.bytes, canvasJpeg75: canvasJpeg.size, original: f.size };
      check('MozJPEG q75 < canvas JPEG q75 (' + f.name + ')', moz.bytes < canvasJpeg.size && !moz.kept, kb(moz.bytes) + ' vs ' + kb(canvasJpeg.size));
      Pinch.release(png);
    }
    const g = await Pinch.process(graphic, { format: 'png' });
    check('OxiPNG <= canvas PNG (graphic)', g.bytes <= graphic.size, kb(g.bytes) + ' vs ' + kb(graphic.size));
    const p = await Pinch.process(photoPng, { format: 'png' });
    check('OxiPNG <= canvas PNG (photo)', p.bytes <= photoPng.size, kb(p.bytes) + ' vs ' + kb(photoPng.size));
    R.sizes.png = { graphicOxi: g.bytes, graphicCanvas: graphic.size, photoOxi: p.bytes, photoCanvas: photoPng.size };
    // a flat graphic with few colours (no anti-aliasing) should come out as a palette PNG
    const fc = document.createElement('canvas'); fc.width = 300; fc.height = 200;
    const fx = fc.getContext('2d');
    ['#e11d48', '#2563eb', '#16a34a', '#f59e0b'].forEach((c, i) => { fx.fillStyle = c; fx.fillRect(20 + i * 60, 30 + i * 20, 50, 80); });
    const flat = new File([await toBlob(fc, 'image/png')], 'flat.png', { type: 'image/png' });
    const fr = await Pinch.process(flat, { format: 'png' });
    const fBuf = new Uint8Array(await fr.blob.arrayBuffer());
    check('flat graphic (5 colours) becomes a palette PNG (colour type 3)', fBuf[25] === 3, 'colour type ' + fBuf[25] + ', ' + fr.bytes + ' B vs canvas ' + flat.size + ' B');
  });

  await test('transparency', async () => {
    for (const [fmt, extra] of [['png', {}], ['webp', {}], ['webp', { lossless: true }], ['avif', {}], ['png', { pngColors: 64 }], ['gif', {}]]) {
      const r = await Pinch.process(graphic, Object.assign({ format: fmt, quality: 75 }, extra));
      const px = await pixels(r.blob);
      const corner = px.at(2, px.h - 3), centre = px.at(Math.round(px.w / 2), Math.round(px.h / 2));
      check('transparency kept in ' + fmt + (extra.lossless ? ' lossless' : extra.pngColors ? ' 64 colours' : ''), corner[3] <= 8 && centre[3] >= 247, 'corner ' + corner + ' centre ' + centre);
    }
    const j = await Pinch.process(graphic, { format: 'jpeg', background: '#ff0000' });
    const px = await pixels(j.blob);
    const c = px.at(2, px.h - 3);
    check('JPEG flattens onto the background colour', c[0] > 230 && c[1] < 30 && c[2] < 30 && j.notes.some((n) => /transparency/.test(n)), c + ' ' + j.notes.join(' | '));
  });

  await test('target size', async () => {
    const cases = [['jpeg', 150e3], ['webp', 100e3], ['avif', 60e3], ['jpeg', 15e3], ['webp', 8e3], ['gif', 200e3], ['bmp', 900e3]];
    for (const [fmt, target] of cases) {
      const r = await Pinch.process(photoPng, { format: fmt, quality: 90, target });
      R.notes['target ' + fmt + ' ' + target] = r.notes;
      check('target ' + fmt + ' <= ' + kb(target), r.bytes <= target, kb(r.bytes) + ' q' + r.quality + ' ' + r.width + 'x' + r.height + ' ' + r.ms + ' ms | ' + r.notes.join(' | '));
    }
    const g = await Pinch.process(graphic, { format: 'png', target: 6000 });
    R.notes['target png 6000'] = g.notes;
    check('target png (colour ladder) <= 5.9 KB', g.bytes <= 6000, kb(g.bytes) + ' | ' + g.notes.join(' | '));
    const p = await Pinch.process(photoPng, { format: 'png', target: 400e3 });
    check('target png photo <= 391 KB', p.bytes <= 400e3, kb(p.bytes) + ' ' + p.width + 'x' + p.height + ' | ' + p.notes.join(' | '));
  });

  await test('upscale', async () => {
    for (const factor of [2, 4]) {
      for (const method of ['smooth', 'sharp', 'pixel']) {
        const r = await Pinch.process(smallPhoto, { format: 'png', upscale: { factor, method } });
        const d = await dims(r.blob);
        check('upscale ' + factor + 'x ' + method, d.w === 120 * factor && d.h === 80 * factor && r.width === d.w, d.w + 'x' + d.h + ' ' + r.ms + ' ms');
      }
    }
    const odd = await Pinch.process(smallPhoto, { format: 'png', upscale: { factor: 1, method: 'pixel' }, resize: { mode: 'width', width: 301 } });
    const d = await dims(odd.blob);
    check('pixel upscale to an odd exact width', d.w === 301 && d.h === Math.round(80 * 301 / 120), d.w + 'x' + d.h);
    const ga = await Pinch.process(graphic, { format: 'png', upscale: { factor: 2, method: 'sharp' } });
    const px = await pixels(ga.blob);
    check('sharp upscale keeps transparency', px.w === 960 && px.at(3, px.h - 4)[3] <= 8, px.w + 'x' + px.h);
  });

  await test('resize modes', async () => {
    const cases = [
      [{ mode: 'percent', percent: 50 }, 1200, 800], [{ mode: 'fit', width: 1000, height: 1000 }, 1000, 667],
      [{ mode: 'fit', width: 5000, height: 5000 }, 2400, 1600], [{ mode: 'width', width: 640 }, 640, 427], [{ mode: 'height', height: 200 }, 300, 200],
    ];
    for (const [resize, w, h] of cases) {
      const r = await Pinch.process(photoPng, { format: 'webp', resize });
      check('resize ' + JSON.stringify(resize), r.width === w && r.height === h, r.width + 'x' + r.height);
    }
    const cap = await Pinch.process(photoPng, { format: 'jpeg', quality: 50, upscale: { factor: 4, method: 'smooth' } });
    check('40 MP cap applied with a note', cap.width * cap.height <= 40e6 && cap.notes.some((n) => /Capped/.test(n)), cap.width + 'x' + cap.height + ' ' + cap.ms + ' ms');
  });

  await test('auto and same', async () => {
    const a = await Pinch.process(samples[1], { format: 'auto', quality: 75 });
    check('auto: photo -> WebP', a.format === 'webp' || a.kept, a.format + ' ' + a.notes.join(' | '));
    const g = await Pinch.process(graphic, { format: 'auto' });
    check('auto: graphic -> PNG', g.format === 'png', g.format + ' ' + g.notes.join(' | '));
    const k = await Pinch.process(samples[3], { format: 'same', quality: 95 });
    check('same format, bigger result -> original kept', k.kept && k.format === 'jpeg' && k.bytes <= samples[3].size, k.kept + ' ' + kb(k.bytes) + ' vs ' + kb(samples[3].size));
    // metadata stripping on a kept original
    const jpg = new Uint8Array(await samples[3].arrayBuffer());
    const exif = new Uint8Array([0xff, 0xe1, 0x00, 0x16, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const com = new Uint8Array([0xff, 0xfe, 0x00, 0x0c].concat(Array.from('GPS secret').map((c) => c.charCodeAt(0))));
    const withMeta = new File([jpg.subarray(0, 2), exif, com, jpg.subarray(2)], 'meta.jpg', { type: 'image/jpeg' });
    const m = await Pinch.process(withMeta, { format: 'same', quality: 95 });
    const out = new TextDecoder('latin1').decode(new Uint8Array(await m.blob.arrayBuffer()).subarray(0, 4096));
    check('kept original has EXIF and comments stripped', m.kept && !/Exif|GPS secret/.test(out), m.kept + ' ' + m.notes.join(' | '));
    const m2 = await Pinch.process(withMeta, { format: 'same', quality: 95, stripMetadata: false });
    check('stripMetadata:false keeps the original bytes', m2.kept && m2.bytes === withMeta.size);
  });

  await test('svg + heic inputs', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#0a7"/><circle cx="100" cy="50" r="40" fill="#fff"/></svg>'], 'logo.svg', { type: 'image/svg+xml' });
    const i = await Pinch.inspect(svg);
    const r = await Pinch.process(svg, { format: 'same', upscale: { factor: 2, method: 'smooth' } });
    const d = await dims(r.blob);
    check('SVG -> PNG at 2x', i.format === 'svg' && r.format === 'png' && d.w === 400 && d.h === 200, d.w + 'x' + d.h);
    const heic = await fetchFile('fixtures/sample.heic', 'IMG_0001.HEIC', '');
    const hi = await Pinch.inspect(heic);
    check('HEIC inspect', hi.format === 'heic' && hi.width === 600 && hi.height === 400 && hi.thumbUrl, JSON.stringify(hi));
    const hr = await Pinch.process(heic, { format: 'same', quality: 80 });
    const hd = await dims(hr.blob);
    const px = await pixels(hr.blob);
    const mid = px.at(300, 200);
    check('HEIC -> PNG (same) decodes', hr.format === 'png' && hd.w === 600 && hd.h === 400 && mid[3] === 255 && (mid[0] + mid[1] + mid[2]) > 0, hd.w + 'x' + hd.h + ' ' + hr.ms + ' ms, pixel ' + mid);
    const hj = await Pinch.process(heic, { format: 'jpeg', quality: 80 });
    check('HEIC -> JPG', hj.format === 'jpeg' && hj.bytes > 1000, kb(hj.bytes));
  });

  await test('compare', async () => {
    const c = await Pinch.compare(photoPng, { quality: 75 });
    check('compare returns sizes for jpeg/webp/png/avif', ['jpeg', 'webp', 'png', 'avif'].every((k) => c[k] && c[k].bytes > 0), JSON.stringify(c));
    const c2 = await Pinch.compare(photoPng, { quality: 75, skipAvif: true });
    check('compare skipAvif', c2.avif && c2.avif.skipped && c2.webp.bytes > 0, JSON.stringify(c2));
    R.compare = c;
  });

  await test('cancel', async () => {
    const big = new File([photoPng], 'big.png', { type: 'image/png' });
    let t0 = performance.now();
    const p = Pinch.process(big, { format: 'avif', upscale: { factor: 2, method: 'smooth' } });
    setTimeout(() => Pinch.cancel(big), 400);
    try { await p; check('Pinch.cancel rejects', false, 'resolved'); }
    catch (e) { check('Pinch.cancel rejects with AbortError', e.name === 'AbortError', e.name + ' after ' + Math.round(performance.now() - t0) + ' ms'); }
    const ac = new AbortController();
    t0 = performance.now();
    const p2 = Pinch.process(big, { format: 'avif', upscale: { factor: 2, method: 'sharp' } }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 300);
    try { await p2; check('AbortSignal rejects', false, 'resolved'); }
    catch (e) { check('AbortSignal rejects with AbortError', e.name === 'AbortError', e.name + ' after ' + Math.round(performance.now() - t0) + ' ms'); }
    const after = await Pinch.process(big, { format: 'webp', resize: { mode: 'width', width: 300 } });
    check('worker works again after cancel', after.width === 300, after.width + 'x' + after.height);
    let progressed = 0;
    await Pinch.process(big, { format: 'jpeg', quality: 60 }, { onProgress: () => progressed++ });
    check('onProgress called', progressed > 0, progressed + ' events');
  });

  await test('zip', async () => {
    const a = await Pinch.process(smallPhoto, { format: 'jpeg' });
    const b = await Pinch.process(graphic, { format: 'png' });
    const z = await Pinch.zip([{ name: 'photo.jpg', blob: a.blob }, { name: 'photo.jpg', blob: a.blob }, { name: 'café ☕.png', blob: b.blob }]);
    R.zipBase64 = await b64(z);
    R.zipExpect = { names: ['photo.jpg', 'photo (2).jpg', 'café ☕.png'], sizes: [a.bytes, a.bytes, b.bytes] };
    check('zip built', z.size > a.bytes * 2 && z.type === 'application/zip', kb(z.size));
    check('bytes() and outName()', Pinch.bytes(361245) === '353 KB' && Pinch.outName('IMG 1.HEIC', 'jpeg') === 'IMG 1.jpg', Pinch.bytes(361245) + ' ' + Pinch.outName('IMG 1.HEIC', 'jpeg'));
  });

  finish();

  // ---------------------------------------------------------------- offline (after warm-up)
  async function runOffline() {
    await test('offline', async () => {
      const t0 = performance.now();
      await Pinch.warmed;
      log('warm-up finished after ' + Math.round(performance.now() - t0) + ' ms');
      window.__warmed = true;
      // the runner now switches the browser offline and sets __offline
      while (!window.__offline) await new Promise((r) => setTimeout(r, 100));
      let online = true;
      try { await fetch('../assets/samples/p11.jpg?x=' + Date.now(), { cache: 'no-store' }); } catch (e) { online = false; }
      check('network is really offline', !online);
      const heic = window.__heicFile;
      const cases = [['jpeg', {}], ['png', {}], ['png', { pngColors: 64 }], ['webp', {}], ['webp', { lossless: true }], ['avif', {}], ['gif', {}], ['bmp', {}], ['ico', {}],
        ['png', { upscale: { factor: 2, method: 'smooth' } }], ['png', { upscale: { factor: 2, method: 'sharp' } }], ['png', { upscale: { factor: 3, method: 'pixel' } }]];
      for (const [fmt, extra] of cases) {
        const f = new File([smallPhoto], 'off-' + fmt + '.png', { type: 'image/png' }); // new file: may land on any worker
        try {
          const r = await Pinch.process(f, Object.assign({ format: fmt, quality: 70 }, extra));
          check('offline ' + fmt + ' ' + JSON.stringify(extra), r.bytes > 0 && r.format === fmt, Pinch.bytes(r.bytes) + ' ' + r.width + 'x' + r.height);
        } catch (e) { check('offline ' + fmt + ' ' + JSON.stringify(extra), false, e.message); }
      }
      // a cancel restarts a worker; the new one must work offline too
      const big = new File([photoPng], 'off-big.png', { type: 'image/png' });
      const p = Pinch.process(big, { format: 'avif', upscale: { factor: 2, method: 'smooth' } });
      setTimeout(() => Pinch.cancel(big), 300);
      try { await p; } catch (e) { /* expected AbortError */ }
      for (const fmt of ['avif', 'jpeg', 'png', 'webp']) {
        const r = await Pinch.process(big, { format: fmt, resize: { mode: 'width', width: 400 } });
        check('offline after restart: ' + fmt, r.width === 400 && r.format === fmt, Pinch.bytes(r.bytes));
      }
      const hr = await Pinch.process(heic, { format: 'jpeg' });
      check('offline HEIC decode', hr.width === 600, hr.width + 'x' + hr.height);
      const c = await Pinch.compare(graphic, { quality: 70 });
      check('offline compare', ['jpeg', 'webp', 'png', 'avif'].every((k) => c[k].bytes > 0), JSON.stringify(c));
    });
    finish();
  }

  // ---------------------------------------------------------------- fallback (canvas) mode
  async function runFallback() {
    await test('fallback', async () => {
      check('ready.wasm is false in fallback', st.wasm === false && st.workers === 0, JSON.stringify(st));
      const i = await Pinch.inspect(samples[0]);
      check('fallback inspect', i.width === 2400 && i.colours === 'photo', JSON.stringify(i));
      for (const fmt of ['jpeg', 'png', 'webp', 'gif', 'bmp']) {
        const r = await Pinch.process(photoPng, { format: fmt, quality: 75 });
        const d = await dims(r.blob);
        R.timings['fallback ' + fmt] = { warmMs: r.ms, bytes: r.bytes };
        check('fallback round trip ' + fmt, d.w === 2400 && d.h === 1600 && r.format === fmt, kb(r.bytes) + ' ' + r.ms + ' ms');
      }
      const ico = await Pinch.process(graphic, { format: 'ico' });
      const entries = await parseIco(ico.blob);
      check('fallback ico', entries.length >= 6 && entries.every((e) => e.ok), entries.map((e) => e.w).join(','));
      const p64 = await Pinch.process(graphic, { format: 'png', pngColors: 64 });
      const px = await pixels(p64.blob);
      check('fallback png 64 colours keeps transparency', px.at(2, px.h - 3)[3] <= 8, kb(p64.bytes));
      try { await Pinch.process(photoPng, { format: 'avif' }); check('fallback avif gives a friendly error', st.encode.avif, 'no error'); }
      catch (e) { check('fallback avif gives a friendly error', /WebAssembly/.test(e.message), e.message); }
      const t = await Pinch.process(photoPng, { format: 'jpeg', quality: 90, target: 120e3 });
      check('fallback target size', t.bytes <= 120e3, kb(t.bytes) + ' | ' + t.notes.join(' | '));
      const u = await Pinch.process(smallPhoto, { format: 'png', upscale: { factor: 4, method: 'sharp' } });
      const d = await dims(u.blob);
      check('fallback upscale 4x', d.w === 480 && d.h === 320, d.w + 'x' + d.h);
      const c = await Pinch.compare(photoPng, { quality: 75, skipAvif: true });
      check('fallback compare', c.jpeg.bytes > 0 && c.png.bytes > 0, JSON.stringify(c));
      const z = await Pinch.zip([{ name: 'a.jpg', blob: t.blob }]);
      check('fallback zip', z.size > t.bytes);
    });
    finish();
  }

  function finish() {
    const failed = R.checks.filter((c) => !c.ok).length;
    log('\n' + (R.checks.length - failed) + ' passed, ' + failed + ' failed', failed ? 'fail' : 'pass');
    R.done = true;
  }
})().catch((e) => { window.__results = { done: true, fatal: String((e && e.stack) || e), checks: [] }; });
