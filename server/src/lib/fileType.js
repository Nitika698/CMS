/**
 * Identifies an upload from its first bytes. The browser-supplied Content-Type and file extension are never trusted:
 * a script renamed to "photo.png" is rejected because its bytes don't look like a PNG.
 * Only formats that cannot carry active content are allowed (no SVG, HTML, PDF-with-JS is accepted as a document
 * but is always served as a download-safe inline PDF with nosniff).
 */
export const HEAD_BYTES = 64;

const ascii = (buf, start, end) => buf.subarray(start, end).toString('latin1');
const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash']);

/** @returns {{ mime: string, ext: string, resourceType: 'image'|'video'|'document' } | null} */
export function detectFileType(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return null;

  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: '.jpg', resourceType: 'image' };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: '.png', resourceType: 'image' };
  if (['GIF87a', 'GIF89a'].includes(ascii(head, 0, 6))) return { mime: 'image/gif', ext: '.gif', resourceType: 'image' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp', resourceType: 'image' };
  if (ascii(head, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: '.pdf', resourceType: 'document' };

  // ISO base media (MP4 / QuickTime): "ftyp" box at offset 4, brand at 8.
  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: '.mov', resourceType: 'video' };
    if (MP4_BRANDS.has(brand)) return { mime: 'video/mp4', ext: '.mp4', resourceType: 'video' };
    return null; // HEIC/AVIF/audio brands etc. are intentionally not accepted
  }

  // WebM = EBML header whose DocType is "webm" (Matroska .mkv shares the magic number, so check the doctype).
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]) && head.includes(Buffer.from('webm'))) {
    return { mime: 'video/webm', ext: '.webm', resourceType: 'video' };
  }
  return null;
}

/** Display-only file name: no directories, no control characters, bounded length. Never used to build a path. */
export function sanitizeDisplayName(name) {
  const utf8 = Buffer.from(String(name ?? ''), 'latin1').toString('utf8'); // multer decodes names as latin1
  const base = utf8.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(0, 120);
  return cleaned || 'file';
}
