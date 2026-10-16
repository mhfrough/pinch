// Identify a file from its first bytes (MIME types and extensions lie), and spot animation.

const MIME = {
  'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/pjpeg': 'jpeg', 'image/png': 'png', 'image/apng': 'png',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/x-ms-bmp': 'bmp',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg',
  'image/heic': 'heic', 'image/heif': 'heic', 'image/heic-sequence': 'heic', 'image/heif-sequence': 'heic',
  'image/tiff': 'tiff',
};
const EXT = {
  jpg: 'jpeg', jpeg: 'jpeg', jfif: 'jpeg', jpe: 'jpeg', png: 'png', apng: 'png', webp: 'webp', avif: 'avif',
  gif: 'gif', bmp: 'bmp', dib: 'bmp', ico: 'ico', cur: 'ico', svg: 'svg', svgz: 'svg', heic: 'heic', heif: 'heic',
  hif: 'heic', tif: 'tiff', tiff: 'tiff',
};

const str = (u8, a, b) => String.fromCharCode.apply(null, u8.subarray(a, b));

/** Format from a file's header bytes (at least 64 bytes, ideally ~4 KB), falling back to MIME / extension. */
export function sniff(u8, file) {
  let format = null;
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) format = 'jpeg';
  else if (u8.length >= 8 && u8[0] === 0x89 && str(u8, 1, 4) === 'PNG') format = 'png';
  else if (str(u8, 0, 4) === 'GIF8') format = 'gif';
  else if (str(u8, 0, 4) === 'RIFF' && str(u8, 8, 12) === 'WEBP') format = 'webp';
  else if (str(u8, 0, 2) === 'BM') format = 'bmp';
  else if (u8[0] === 0 && u8[1] === 0 && (u8[2] === 1 || u8[2] === 2) && u8[3] === 0 && u8.length > 6) format = 'ico';
  else if (str(u8, 4, 8) === 'ftyp') {
    const size = Math.min(u8.length, (u8[0] << 24 | u8[1] << 16 | u8[2] << 8 | u8[3]) >>> 0 || 32);
    const brands = [];
    for (let o = 8; o + 4 <= size; o += 4) if (o !== 12) brands.push(str(u8, o, o + 4));
    if (brands.includes('avif') || brands.includes('avis')) format = 'avif';
    else if (brands.some((b) => /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(b))) format = 'heic';
  } else if ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 42) || (u8[0] === 0x4d && u8[1] === 0x4d && u8[3] === 42)) format = 'tiff';
  else {
    const text = str(u8, 0, Math.min(u8.length, 1024)).replace(/^﻿/, '').trim();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text) || (/^<\?xml/.test(text) && /<svg[\s>]/i.test(text))) format = 'svg';
  }
  if (!format && file) {
    format = MIME[file.type] || EXT[((file.name || '').split('.').pop() || '').toLowerCase()] || null;
  }
  return { format, animated: format ? isAnimated(u8, format) : false };
}

/** Best-effort animation check on the header bytes. */
export function isAnimated(u8, format) {
  if (format === 'webp') {
    // VP8X chunk flags: bit 1 = animation
    if (str(u8, 12, 16) === 'VP8X') return (u8[20] & 2) !== 0;
    return false;
  }
  if (format === 'png') {
    // acTL before IDAT means APNG
    let o = 8;
    while (o + 8 <= u8.length) {
      const len = (u8[o] << 24 | u8[o + 1] << 16 | u8[o + 2] << 8 | u8[o + 3]) >>> 0;
      const type = str(u8, o + 4, o + 8);
      if (type === 'acTL') return true;
      if (type === 'IDAT') return false;
      o += 12 + len;
    }
    return false;
  }
  if (format === 'gif') {
    // count Graphic Control Extensions; NETSCAPE loop block also means animation
    if (str(u8, 0, u8.length).indexOf('NETSCAPE2.0') !== -1) return true;
    let n = 0;
    for (let i = 0; i + 2 < u8.length; i++) if (u8[i] === 0x21 && u8[i + 1] === 0xf9 && u8[i + 2] === 4 && ++n > 1) return true;
    return false;
  }
  return false;
}
