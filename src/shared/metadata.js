// Lossless metadata stripping, used only when Pinch hands back the original file (kept: true)
// and settings.stripMetadata is on. Re-encoded output never carries EXIF/GPS/XMP in the first place.
// Returns { bytes, changed } or null when the original cannot be safely stripped
// (for example a JPEG whose EXIF orientation would be lost).

export function stripMetadata(u8, format) {
  try {
    if (format === 'jpeg') return stripJpeg(u8);
    if (format === 'png') return stripPng(u8);
    if (format === 'webp') return stripWebp(u8);
    if (format === 'avif') return findAscii(u8, 'Exif', 4096) || findAscii(u8, 'mime', 4096) ? null : { bytes: u8, changed: false };
    if (format === 'gif' || format === 'bmp') return { bytes: u8, changed: false };
  } catch (e) { /* fall through */ }
  return null;
}

function findAscii(u8, s, limit) {
  const end = Math.min(u8.length - s.length, limit);
  outer: for (let i = 0; i < end; i++) {
    for (let j = 0; j < s.length; j++) if (u8[i + j] !== s.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

function stripJpeg(u8) {
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  const keep = [u8.subarray(0, 2)];
  let o = 2, changed = false;
  while (o + 4 <= u8.length) {
    if (u8[o] !== 0xff) return null;
    const m = u8[o + 1];
    if (m === 0xff) { o++; continue; }
    if (m === 0xda || m === 0xd9) { keep.push(u8.subarray(o)); break; } // start of scan: copy the rest
    if (m >= 0xd0 && m <= 0xd7) { keep.push(u8.subarray(o, o + 2)); o += 2; continue; }
    const len = (u8[o + 2] << 8) | u8[o + 3];
    const seg = u8.subarray(o, o + 2 + len);
    let drop = false;
    if (m === 0xe1) {
      if (exifOrientation(seg) > 1) return null; // orientation needed to show it the right way up
      drop = true;
    } else if (m === 0xfe || m === 0xed || m === 0xec || (m >= 0xe3 && m <= 0xeb) || m === 0xef) drop = true;
    else if (m === 0xe2 && !isIcc(seg)) drop = true;
    if (drop) changed = true; else keep.push(seg);
    o += 2 + len;
  }
  return { bytes: changed ? concat(keep) : u8, changed };
}

function isIcc(seg) {
  return String.fromCharCode.apply(null, seg.subarray(4, 15)) === 'ICC_PROFILE';
}

/** EXIF orientation (1-8) from an APP1 segment, or 0. */
export function exifOrientation(seg) {
  if (String.fromCharCode.apply(null, seg.subarray(4, 8)) !== 'Exif') return 0;
  const t = 10; // TIFF header start
  const le = seg[t] === 0x49;
  const r16 = (p) => (le ? seg[p] | (seg[p + 1] << 8) : (seg[p] << 8) | seg[p + 1]);
  const r32 = (p) => (le ? (seg[p] | (seg[p + 1] << 8) | (seg[p + 2] << 16) | (seg[p + 3] << 24)) : ((seg[p] << 24) | (seg[p + 1] << 16) | (seg[p + 2] << 8) | seg[p + 3])) >>> 0;
  const ifd = t + r32(t + 4);
  const n = r16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > seg.length) break;
    if (r16(e) === 0x0112) return r16(e + 8);
  }
  return 0;
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function stripPng(u8) {
  const keep = [u8.subarray(0, 8)];
  let o = 8, changed = false;
  while (o + 12 <= u8.length) {
    const len = ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
    const type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]);
    const end = o + 12 + len;
    if (PNG_DROP.has(type)) changed = true; else keep.push(u8.subarray(o, end));
    o = end;
    if (type === 'IEND') break;
  }
  return { bytes: changed ? concat(keep) : u8, changed };
}

function stripWebp(u8) {
  const keep = [];
  let o = 12, changed = false, vp8x = -1, size = 12;
  while (o + 8 <= u8.length) {
    const type = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    const len = (u8[o + 4] | (u8[o + 5] << 8) | (u8[o + 6] << 16) | (u8[o + 7] << 24)) >>> 0;
    const end = o + 8 + len + (len & 1);
    if (type === 'EXIF' || type === 'XMP ') changed = true;
    else {
      if (type === 'VP8X') vp8x = size; // chunk offset within the new file
      keep.push(u8.subarray(o, end)); size += end - o;
    }
    o = end;
  }
  if (!changed) return { bytes: u8, changed: false };
  const head = new Uint8Array(12);
  head.set(u8.subarray(0, 12));
  const out = concat([head].concat(keep));
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  if (vp8x >= 0) out[vp8x + 8] &= ~0x0c; // clear EXIF and XMP flags
  return { bytes: out, changed: true };
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
