# Pinch: design brief

Pinch compresses, converts and upscales images in the browser. Nothing is uploaded. This brief is the shared contract for everyone building the site.

## The bar

The craft should be at the level of Apple, Linear, Things or CleanShot, with an identity of its own. The product is the hero: the first screen *is* the tool, already showing what it does. Everything is precise and calm. One thing moves at a time. Light and dark themes get equal care.

The user rejected the previous version: a flat sky-blue page, words pushed to the edges, big empty areas and a poster headline. Do not bring any of that back.

## What research says users want (and competitors miss)

1. No caps, no sign-up, no uploads. Users must be able to check the privacy claim (it works offline after load).
2. A live before/after comparison with zoom and pan (Squoosh does this best, but only one file at a time).
3. Batch work with one set of settings, per-file overrides and a single ZIP download.
4. A live output size and % change, and a warning when the output is larger (then keep the original).
5. Presets. No competitor offers them: Web, Email, Social, Favicon, Lossless PNG.
6. Target file size ("under 100 KB" for forms).
7. Opening HEIC photos from iPhones.
8. Keyboard shortcuts with a visible cheat sheet. No competitor has them.
9. Transparency handled when converting to JPG (a background colour picker).

## System

- **Tokens:** `tokens.css` defines every colour, size, radius, space and timing. Use only those variables, and add to tokens.css only if a value is truly missing.
- **Type:** Geist (self-hosted, variable 100–900). Display sizes use weight 600 and tracking around -0.035em. UI text is 13–15px at weight 450–550. Every number gets `font-variant-numeric: tabular-nums`. Geist Mono is only for `<kbd>` and very dense numeric readouts.
- **Colour:** neutral surfaces separated by tone. Signal blue (`--accent`) is only for the primary action, focus and the compare divider. Green, amber and red only mean good, warning and error.
- **Shape:** radii are nested (outer = inner + padding). Panels use `--r-lg`, controls `--r-sm`/`--r-full`, the stage `--r-xl`.
- **Elevation:** surfaces sit flat on the page. Only floating things (popovers, sheets, dialogs, toasts, a dragged file) get `--shadow-float`.
- **Motion:** 120–420 ms with `--ease-out`, on transform and opacity only. Springs only for small confirmations (save, copy). Every motion has a `prefers-reduced-motion` fallback.
- **Icons:** one hand-drawn inline SVG set, 1.5px stroke, 20px grid, `currentColor`. No emoji, no icon fonts, no icon CDN.
- **Never:** gradients as decoration, glass/blur blobs, glowing borders, eyebrow labels above headings, numbered 01/02/03 markers, rows of identical icon cards, violet, centred text everywhere, stock illustrations, lorem ipsum.

## Copy

Write plainly, from the user's side ("Save all", not "Export batch"). Use sentence case. No em dashes or en dashes in UI copy. Error messages say what happened and how to fix it. Every claim must be true; there are no customers or testimonials. Use concrete numbers measured on the real samples.

## Layout contract (files and owners)

| Part | Files | Owner |
|---|---|---|
| Engine and codecs | `engine.js`, `src/`, `codecs/`, `tools/build-codecs.mjs`, `tests/engine*` | engine agent |
| AI upscaling | `ai/` (`ai/ai.js` exposes `window.PinchAI`), `tests/ai*` | AI agent |
| Studio (the tool UI) | `app.js`, `app.css`, `tests/studio*` | studio agent |
| Page shell and landing | `index.html`, `site.css`, `site.js`, `assets/og-image.jpg`, `README.md` | landing agent |
| Tokens, fonts, this brief | `tokens.css`, `assets/fonts/`, `DESIGN.md` | lead |

`index.html` loads, in this order: `tokens.css`, `app.css`, `site.css`, then the scripts `engine.js`, `ai/ai.js` (defer), `app.js`, `site.js`. It contains `<main>` → `<section id="studio" aria-label="Pinch studio"></section>` as the first thing under the top bar, then the landing sections. `app.js` renders the whole studio into `#studio` and owns everything inside it.

The top bar (landing agent) is 56px tall, sticky, and on the page background: the Pinch wordmark, links (Features, Formats, Privacy, Questions), a theme toggle (system/light/dark, stored in localStorage as `pinch-theme`, applied as `data-theme` on `<html>`) and a GitHub link (`https://github.com/mhfrough/pinch`). The studio fills `calc(100svh - 56px)` on desktop.

## Engine API (from engine.js)

```
Pinch.ready -> Promise<{ wasm, webpNative, avifNative, workers }>
Pinch.FORMATS -> { jpeg|png|webp|avif|gif|bmp|ico: { label, ext, mime, lossy, alpha } }
Pinch.inspect(file) -> Promise<{ width, height, format, alpha, bytes, colours: 'photo'|'graphic', thumbUrl }>
Pinch.process(file, settings, { signal, onProgress }) -> Promise<{ blob, url, width, height, format, quality, bytes, notes[], kept, ms }>
  settings = { format: 'auto'|'same'|'jpeg'|'png'|'webp'|'avif'|'gif'|'bmp'|'ico', quality 1-100, lossless,
               pngColors 0|256|128|64|32|16, resize: { mode: 'none'|'percent'|'fit'|'width'|'height', percent, width, height },
               upscale: { factor 1|2|3|4, method: 'smooth'|'sharp'|'pixel' }, target (bytes, 0 = off), background '#ffffff',
               stripMetadata true, skipAvif }
Pinch.compare(file, settings) -> Promise<{ jpeg, webp, avif, png }>   // each { bytes } or { error }
Pinch.cancel(file); Pinch.zip([{ name, blob }]) -> Promise<Blob>; Pinch.bytes(n); Pinch.outName(name, format)
```

## AI upscaling API (from ai/ai.js)

```
PinchAI.available() -> Promise<{ webgpu, wasm, modelBytes }>
PinchAI.upscale(fileOrBlob, { scale: 2|4, signal, onProgress(fraction, label) }) -> Promise<Blob>   // PNG, exact scale
```

The studio offers it as a fourth upscale method, "AI (detail)". The model downloads on first use, and the UI says so with its size. The upscaled blob then goes through `Pinch.process` with the user's format settings (upscale factor 1).

## Samples (assets/samples)

- `p11.jpg`: valley, Paul Jarvis
- `p266.jpg`: harbour with ships, John Maravelakis
- `p989.jpg`: lake in low cloud, Paul Jarvis
- `p353.jpg`: forested hills, Forrest Cavale

All are 2400×1600 from Unsplash via picsum.photos (Unsplash licence). Credit them in the footer.
