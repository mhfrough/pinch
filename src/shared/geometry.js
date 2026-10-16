import { MAX_SIDE, MAX_PIXELS } from './constants.js';

/**
 * Work out the output size from the source size and the settings.
 *  - upscale.factor multiplies the source first (1-4).
 *  - resize.mode then applies to that:
 *      'percent' scales by percent/100 (may enlarge),
 *      'fit'     fits inside width x height (either may be 0 = no limit) and never enlarges,
 *      'width' / 'height' set that side exactly and keep the aspect ratio (may enlarge;
 *               the upscale factor is then irrelevant, only the method is used).
 *  - finally the caps (12000 px longest side, 40 MP) apply, with a note.
 */
export function plan(W, H, s) {
  const r = s.resize, f = s.upscale.factor;
  let w = W * f, h = H * f;
  if (r.mode === 'percent') { w *= r.percent / 100; h *= r.percent / 100; }
  else if (r.mode === 'fit' && (r.width || r.height)) {
    const k = Math.min(r.width ? r.width / w : Infinity, r.height ? r.height / h : Infinity, 1);
    w *= k; h *= k;
  } else if (r.mode === 'width' && r.width) { w = r.width; h = H * r.width / W; }
  else if (r.mode === 'height' && r.height) { h = r.height; w = W * r.height / H; }
  const notes = [];
  const k = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
  if (k < 1) {
    w = Math.floor(w * k); h = Math.floor(h * k); // floor so the result never goes over the limit
    notes.push('Capped at ' + w + ' x ' + h + ' px (the limit is 12000 px on the longest side and 40 megapixels) so the browser does not run out of memory.');
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), notes, capped: k < 1 };
}

/** Size to decode a huge source at, so we never hold more than the caps in memory. */
export function capSize(W, H) {
  const k = Math.min(1, MAX_SIDE / Math.max(W, H), Math.sqrt(MAX_PIXELS / (W * H)));
  const r = k < 1 ? Math.floor : Math.round;
  return { w: Math.max(1, r(W * k)), h: Math.max(1, r(H * k)), capped: k < 1 };
}
