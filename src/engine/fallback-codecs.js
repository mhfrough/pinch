// Pure-JS codecs for the canvas fallback (no module workers or no WebAssembly).
// Built as a classic script (codecs/fallback-codecs.js) and loaded only when the fallback needs it.
import UPNG from 'upng-js';
import { GIFEncoder } from 'gifenc';
import { quantize } from '../shared/quant.js';

window.PinchFallbackCodecs = {
  quantize,
  GIFEncoder,
  /** RGBA -> PNG bytes (UPNG + pako). With an RGBA of <= 256 colours UPNG writes a palette PNG. */
  png(data, width, height) {
    const buf = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.slice().buffer;
    return new Uint8Array(UPNG.encode([buf], width, height, 0));
  },
};
