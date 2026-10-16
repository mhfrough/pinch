# Pinch

Compress, convert and upscale images in your browser. Nothing is uploaded.

**[Open Pinch](https://mhfrough.github.io/pinch/)**

- **Compress** JPG, PNG, WebP and AVIF, with the new size shown before you save. If a file would come out larger, Pinch keeps the original.
- **Convert** between JPG, PNG, WebP, AVIF, GIF, BMP and ICO. Opens SVG and iPhone HEIC photos too.
- **Upscale** 2x to 4x with Smooth, Sharp or Pixel resampling, or AI (detail) with Real-ESRGAN running on your device.
- **Presets** for Web, Email, Social, Favicon and Lossless, and a **target file size** ("under 100 KB").
- **Batch**: one set of settings for many files, per-file changes, one ZIP.
- **Compare** before and after with zoom, and keyboard shortcuts for everything (press `?`).

## Privacy

Pinch is a static web page. Images are read from your device, processed in Web Workers inside the tab and saved back to your device. There is no server that receives them, no account and no limit.

You can check it: open your browser's developer tools, choose Network, then add an image. The privacy section on the page also counts every request made after your first image.

Two downloads can happen later, both from this site or GitHub, never carrying images:

- The AI upscaling model and its runtime, fetched from this site the first time you choose AI (detail), then kept in the browser's cache.
- The star count on the GitHub button, fetched from `api.github.com` at most once every five minutes.

## Run it locally

Any static file server works:

```
python -m http.server 8150 --directory pinch
```

Then open http://localhost:8150.

## How it is built

| Part | Files |
|---|---|
| Image engine and codecs (WebAssembly, Web Workers) | `engine.js`, `src/`, `codecs/`, `tools/build-codecs.mjs` |
| AI upscaling (Real-ESRGAN on ONNX Runtime Web) | `ai/` |
| The studio (the tool itself) | `app.js`, `app.css` |
| Page shell and landing sections | `index.html`, `site.css`, `site.js` |
| Design tokens and fonts | `tokens.css`, `assets/fonts/` |

`DESIGN.md` is the design brief. No frameworks, no build step for the page, no CDN: every font and script is served from this repository.

### Numbers on the page

The sizes in the features section were measured on the sample photos with Pinch's own engine (`Pinch.process`) in Chromium: valley as WebP at each quality, harbour in each format at quality 75, hills as JPG with a target size, and all four with the Web preset. The compare tile goes further and makes its WebP live in your browser when it scrolls into view.

## Credits

- Sample photos from Unsplash: Paul Jarvis (valley, lake), John Maravelakis (harbour), Forrest Cavale (hills), via picsum.photos.
- Geist and Geist Mono by Vercel, SIL OFL 1.1.
- Codecs: MozJPEG, libwebp, libavif, libheif, OxiPNG, gifenc, the Squoosh resizers via jSquash, Real-ESRGAN on ONNX Runtime Web. Their licences are in `codecs/licenses/`.

Made by Mohammad Hamza. MIT licence, 2026.
