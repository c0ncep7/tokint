import { address, Failure, htmlDataUri, imageDataUri } from './core';

export function downloadName(contract: string, id: bigint, kind: 'media' | 'web', extension: string): string {
  if (id < 0n || !/^[a-z0-9]+$/.test(extension)) throw new Failure('input', 'Invalid download filename.');
  return `${address(contract).toLowerCase()}--${id}--${kind}.${extension}`;
}

export function embeddedImageBlob(uri: string): Blob {
  if (!imageDataUri(uri)) throw new Failure('image', 'This embedded image format is not supported.');
  return embeddedMediaBlob(uri);
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
