import { address, Failure, htmlDataUri, imageDataUri } from './core';

function titleSlug(title: string): string {
  const slug = title.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');
  // Bound UTF-8 bytes as well as characters so long/non-Latin titles fit common
  // filesystem limits alongside the full address and a uint256 token ID.
  let result = '', bytes = 0;
  for (const char of slug) {
    bytes += new TextEncoder().encode(char).length;
    if (bytes > 80) break;
    result += char;
  }
  return result.replace(/^-+|-+$/g, '') || 'untitled';
}
export function downloadName(contract: string, id: bigint, kind: 'media' | 'web', extension: string, title = ''): string {
  if (id < 0n || !/^[a-z0-9]+$/.test(extension)) throw new Failure('input', 'Invalid download filename.');
  const label = kind === 'web' ? `${titleSlug(title)}--web` : kind;
  return `${address(contract).toLowerCase()}--${id}--${label}.${extension}`;
}

export function embeddedMediaBlob(uri: string): Blob {
  if (!imageDataUri(uri) && !htmlDataUri(uri)) throw new Failure('image', 'This embedded media format is not supported.');
  const comma = uri.indexOf(',');
  const header = uri.slice(5, comma);
  const type = header.split(';')[0].toLowerCase();
  try {
    const data = decodeURIComponent(uri.slice(comma + 1));
    const bytes = /;base64(?:;|$)/i.test(header)
      ? Uint8Array.from(atob(data), c => c.charCodeAt(0))
      : new TextEncoder().encode(data);
    return new Blob([bytes], { type });
  } catch { throw new Failure('image', 'The embedded media could not be decoded.'); }
}

export async function mediaExtension(blob: Blob, source: string): Promise<string> {
  if (blob.type.split(';')[0].toLowerCase() === 'text/html') return 'html';
  const bytes = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  if (bytes[0] === 0x89 && text.slice(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (/^GIF8[79]a/.test(text)) return 'gif';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'webp';
  if (text.slice(4, 8) === 'ftyp' && /avif|avis/.test(text.slice(8, 32))) return 'avif';
  if (text.startsWith('BM')) return 'bmp';
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) return 'svg';
  const types: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/tiff': 'tiff' };
  const type = types[blob.type.split(';')[0].toLowerCase()];
  if (type) return type;
  try {
    const match = new URL(source).pathname.match(/\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|tiff?)$/i);
    if (match) return match[1].toLowerCase().replace(/^jpeg$/, 'jpg');
  } catch { /* A data URI has no useful filename. */ }
  return 'bin';
}
