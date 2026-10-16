# Pinch reel: Lighter, and it never leaves

**Length:** 25 seconds, 9:16 vertical (1080x1920 CSS, rendered at 2x to 2160x3840, 30 fps, 750 frames)
**Goal:** a viewer gets the one promise ("smaller images, made on your own device") and goes to mhfrough.github.io/pinch.
**Visuals:** `promo/pinch-reel.html`. The studio is rebuilt from Pinch's own stylesheets (`../tokens.css`, `../app.css`) and class names: the compare figure (`.ps-demo`, `.ps-split`, `.ps-tag`), the result card (`.ps-res`), preset chips (`.ps-chip-opt`), file rows (`.ps-row`), the bottom bar (`.ps-bar`, `.btn-primary`), segmented controls (`.ps-seg`) and the toast (`.ps-toast`), with app.js's own icon paths and wording. Every image and number on screen came out of Pinch's real engine (`Pinch.process`, `Pinch.zip`) and AI module (`PinchAI.upscale`) run on `assets/samples` in Chromium (2026-10-16). The outputs are in `promo/media/`.
**Look:** Pinch's light theme: page `#f6f6f4`, white raised panels, ink `#111214`, one signal blue `#2f5cff`, Geist 600 with tight tracking (self-hosted, through `tokens.css`). The background is the studio's transparency checkerboard, faded and drifting slowly. Two signature moves, both taken from the product: the **pinch** (the whole screen becomes the Pinch mark, a dark tile with two corner brackets and the blue dot, then pinches down into the brand pill; it comes back at the CTA) and the **compare divider** (the blue line and knob sweep across photos, and once across the whole screen to switch the reel into Pinch's dark theme). How it differs from the series: Flick is dark with lime, Scrawl is dotted paper with highlighter yellow and hand lettering, and Sizzle is a black film poster in bronze. Pinch is a calm, precise neutral UI with one blue accent, no hand-drawn marks and no film motifs.
**Audio:** music only, picked after the visuals are approved. The lines below also work as a voiceover script.

## Script (on-screen copy, also readable as a voiceover)

> Image too big to upload?
> Pinch. Make images lighter. Keep them private.
> 44% lighter. Same photo.
> A preset for every place.
> A whole folder. One ZIP.
> Too small? Upscale it 4×.
> Nothing is uploaded.
> Try Pinch. Free, in your browser. mhfrough.github.io/pinch

## Shot list

| Time | On screen |
|---|---|
| 0.0 - 2.9 | **Hook.** "Image too big / to upload?" Four chips pop in around it (Max file size 2 MB, photo.jpg · 4.8 MB, Upload it to shrink it?, Sign up to download). A blue strike runs through each one on the half beats, then they drop away. |
| 2.95 - 5.25 | **Reveal.** A small dark tile at the centre grows to fill the screen: the reel becomes the Pinch mark, with corner brackets at the screen corners and the blue dot. "Pinch" rises letter by letter, then the tagline "Make images lighter. / Keep them private." At 4.7 s the whole mark pinches down into the brand pill (mark · Pinch · Compress, convert, upscale). |
| 5.3 - 8.9 | **Compare.** "44% lighter. / Same photo." The valley sample in the compare figure: Original 353 KB on the left, WebP encoding on the right. The divider sweeps across, and the tag and result card fill in: WebP · quality 75, 2400 × 1600, **198 KB −44%**, from 353 KB. |
| 8.9 - 12.0 | **Presets.** "A preset for / every place." Chips Web · Email · Social · Favicon · Lossless pop in under the photo. A tap on Social: the card shows Encoding…, then JPG · quality 82, 1080 × 720, **82 KB −77%**. The right half of the photo switches to the real Social output. |
| 12.0 - 15.3 | **Batch.** "A whole folder. / One ZIP." The files panel slides in with valley, harbour, lake and hills, each encoding with a progress line, then 198 KB −44%, 288 KB −33%, 151 KB −48%, 440 KB −24%. The bar reads 4 files, 1.61 MB → 1.05 MB, 35% smaller. A tap on Save all brings the toast "Saved 4 images as pinch-images.zip". |
| 15.3 - 18.6 | **Upscale.** "Too small? / Upscale it 4×." A 160 × 160 crop, shown in hard pixels. A tap on 4× turns it into Pinch's Smooth 4× (640 × 640). A tap on AI detail, and the divider sweeps to show Smooth on the left and the real Real-ESRGAN 4× output on the right. "Real-ESRGAN, running on your device." |
| 18.6 - 21.5 | **Proof.** A full-height blue divider sweeps left to right and the reel switches to Pinch's dark theme, its brand pill included. "Nothing is / uploaded." A card reads Uploads **0 bytes**, followed by Account None · Daily limit None · Price Free · Licence MIT, and a pill: Works offline once loaded. |
| 21.5 - 25.0 | **CTA.** The dark screen fades to the full-screen mark and pinches into the app icon at the centre. "Try Pinch." "Free, in your browser." The URL types itself into a blue pill: mhfrough.github.io/pinch. It holds for about 1.7 s. |

## Claims check

Every claim on screen, and where Pinch backs it. "Measured" means `Pinch.process` / `Pinch.zip` / `PinchAI.upscale` were run on the file in Chromium (headless, served from `http://localhost:8150`, no external requests).

| Claim | Source |
|---|---|
| "Pinch", "Compress, convert, upscale" | README line 3 ("Compress, convert and upscale images in your browser."). |
| "Make images lighter. Keep them private." | The studio's own headline, `app.js` (`.ps-h1` in the empty state). |
| Valley: Original 353 KB | `assets/samples/p11.jpg` = 361,245 bytes; `app.js` `SAMPLES` + `fmtBytes` → "353 KB". |
| WebP · quality 75 → 198 KB, −44%, 2400 × 1600 (so "44% lighter") | Measured: Web preset (`app.js` `PRESETS.web` = WebP q75, fit 2560, through `engineSettings`) on p11.jpg → 202,434 bytes = 198 KB, −44%, 2400 × 1600. It matches the Compress tile in `index.html`. The right half of the compare is that real file (`media/valley-web.webp`). |
| Presets Web · Email · Social · Favicon · Lossless | `app.js` `PRESETS`; README "Presets for Web, Email, Social, Favicon and Lossless". |
| Social: JPG · quality 82, 1080 × 720, 82 KB, −77% | Measured: `PRESETS.social` (JPG q82, fit 1080 × 1350) on p11.jpg → 83,493 bytes = 82 KB, 1080 × 720. The image is the real output (`media/valley-social.jpg`). |
| Batch: 198 KB −44%, 288 KB −33%, 151 KB −48%, 440 KB −24% | Measured: Web preset on p11, p266, p989, p353 → 202,434 / 294,626 / 154,188 / 450,922 bytes. It matches the batch tile in `index.html` and the FAQ ("24% to 48% smaller"). |
| 4 files, 1.61 MB → 1.05 MB, 35% smaller | Sum of the four (1,690,802 → 1,102,170 bytes, −35%). The wording follows `app.js` `renderTotals` ("N files", "35% smaller"). |
| Save all → one ZIP, "Saved 4 images as pinch-images.zip" | `app.js` Save all button (`data-act="saveall"`), `Pinch.zip`, toast text in `saveAll`. Measured: the ZIP of the four outputs is 1,102,580 bytes (1.05 MB). README "Batch: ... one ZIP". |
| Upscale 1× 2× 3× 4×; Smooth, Sharp, Pixel art, AI detail | `app.js` inspector segments `ps-up` and `ps-method`; README "Upscale 2x to 4x with Smooth, Sharp or Pixel resampling, or AI (detail)". |
| 160 × 160 → 640 × 640, Smooth vs AI detail | Measured: hills (p353.jpg) made 600 px wide by Pinch, 160 × 160 crop at (228, 150) (`media/hills-crop-160.png`); `Pinch.process` upscale 4× smooth → 640 × 640 (`media/hills-smooth-4x.webp`); `PinchAI.upscale(crop, {scale: 4})` on the WASM backend → 640 × 640 in 9.6 s (`media/hills-ai-4x.webp`). Both are re-encoded as WebP q92 by Pinch for the reel. |
| "Real-ESRGAN, running on your device" | README ("AI (detail) with Real-ESRGAN running on your device"); `ai/README.md` (onnxruntime-web in a Web Worker, same-origin files only). |
| "Nothing is uploaded." | README line 3 and Privacy section; `app.js` lede "Nothing is uploaded, ever."; FAQ in `index.html`. |
| Uploads 0 bytes · Account None · Daily limit None · Price Free · Licence MIT | `index.html` footer `.foot-facts` (the same five facts, in that order: Uploads 0 bytes, Account None, Daily limit None, Price Free, Licence MIT); LICENSE (MIT). |
| "Works offline once loaded" | `app.js` hero foot ("Once the page has loaded, it works offline."); README Privacy. Scope: compress, convert and resize. AI detail needs its 2.33 MB model downloaded once, and the reel makes no offline claim about AI. |
| "Free, in your browser." | README ("in your browser", "no account and no limit"); FAQ "Is it really free? Yes." |
| mhfrough.github.io/pinch | README link, `index.html` canonical URL. |
| Hook chips (Max file size 2 MB, photo.jpg · 4.8 MB, Upload it to shrink it?, Sign up to download) | Generic pains of the old way (upload limits and upload-based tools, `DESIGN.md` "What research says users want" 1). None names a product, and none is a claim about Pinch. |

Not claimed anywhere: speeds, comparisons with named tools, customer numbers, AI working offline, or HEIC (true, but no room).

Observation for the AI owner (not a reel issue): on this crop the Real-ESRGAN output is a little darker than the input (mean RGB 15/42/38 vs 21/46/41), while Smooth keeps the same tone. It shows in the compare as a slightly darker right half.

## Retiming

All times are in `CUES` in `pinch-reel.html`. Change a cue and everything tied to it moves: headlines (`data-in`/`data-out`), the pinch keyframes (generated in `measure()` from the brand pill's and the CTA's mark slots), the taps (placed on the measured controls) and the UI states in `BEATS`. In render mode, beats fire from the renderer's own seek time rather than `setTimeout`. The renderer's fake clock advances in whole milliseconds (34 ms per 33.33 ms frame), which would make timer beats run about 2% fast and arrive about 0.5 s early by the end.

## Music

**Track used:** [Perfection In Details](https://pixabay.com/music/corporate-perfection-in-details-559784/) by Rockot, under the Pixabay Content License (free for commercial use, no credit required). Checked on the live page on 2026-10-16: not Content ID Registered, not AI generated (a known Content ID page showed the label with the same check). Downloaded on 2026-10-16 from the page's own Pixabay CDN link (`rockot-perfection-in-details-559784.mp3`, 2:39, MP3 256 kb/s 48 kHz, 5.1 MB) and saved as `promo/pinch-bgm.mp3`. The file is gitignored because the licence doesn't allow redistributing the track on its own.

The reel starts the track at **29.38 s**, so the build plays under the hook (−15.5 dB) and the hit at 32.33 s in the track lands on the reveal (`wipe`, 2.95 s). The full section (−8.3 dB) carries the rest of the reel, and the window ends well before the track's outro (~114 s). Mixed at −14 dB, normalised to −14 LUFS with a −1 dBTP true-peak limit, 1.2 s fade-out.

```sh
python -I <skill>/tools/music_sync.py promo/pinch-bgm.mp3 --cue 2.95 --length 25
#   hit 32.33s  offset 29.38  pre -15.5 dB  body -8.3 dB  dips at -  fits yes
```

Credit line (optional under the licence): Music: "Perfection In Details" by Rockot (Pixabay).

## Render

```sh
python <skill>/tools/reel.py stills promo/reel.json 1.5,4,7,10,13,16,19,23
python <skill>/tools/reel.py all promo/reel.json
```

Rendered 2026-10-16: `videos/pinch-reel.mp4` (2160 × 3840, H.264 High crf 16, AAC 192k, 25.000 s, −14.0 LUFS, −2.85 dBTP, 15.4 MB) and `videos/pinch-reel.webp` (poster from 7.2 s, 720 × 1280). The web copy for the site, `assets/media/pinch-reel.mp4` (720 × 1280, H.264 High crf 24, AAC 128k, faststart, 2.0 MB) and `assets/media/pinch-reel.webp`, was re-encoded from the master with PyAV.
