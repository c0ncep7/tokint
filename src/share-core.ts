export const SHARE_SOURCE_LIMIT = 100 * 1024 * 1024;
export const SHARE_TIMEOUT = 120_000;
export const MAX_SOURCE_PIXELS = 32_000_000;
export const MAX_ANIMATION_PIXELS = 160_000_000;
export type AnimationFormat = 'gif' | 'webp';
export type ShareOptions = {
  format?: AnimationFormat;
  // The UI uses web limits; custom limits exercise bounded encoder failures in tests.
  target: 'web' | 'custom';
  maxEdge: number;
  maxMB: number;
  fps: number;
  background: '#000000' | '#ffffff';
};
export type MediaInfo = { width: number; height: number; frames: number; bytes: number; type: string };
export type ShareResult = { blob: Blob; width: number; height: number; frames: number; duration: number; extension: 'jpg' | AnimationFormat; notes: string[] };
export type ShareMessage = { kind: 'info'; info: MediaInfo } | { kind: 'progress'; text: string; value: number } | { kind: 'done'; result: ShareResult } | { kind: 'error'; message: string; code?: 'size'; suggestedEdge?: number };

export function fitDimensions(width: number, height: number, maxEdge: number, allowUpscale = false) {
  if (![width, height].every(n => Number.isFinite(n) && (allowUpscale ? n > 0 : n >= 1)) || !Number.isFinite(maxEdge) || maxEdge < 1) throw new Error('Export dimensions must be at least one pixel.');
  const edge = Math.floor(allowUpscale ? Math.min(maxEdge, 2000) : maxEdge);
  const scale = allowUpscale ? edge / Math.max(width, height) : Math.min(1, edge / Math.max(width, height));
  // HTML and SVG can fill the selected size; raster output stays within each
  // source dimension, including when source dimensions are fractional.
  const fit = (dimension: number) => Math.min(allowUpscale ? edge : Math.floor(dimension), edge, Math.max(1, Math.round(dimension * scale)));
  return { width: fit(width), height: fit(height) };
}
export function assertExportDimensions(output: { width: number; height: number }, source: { width: number; height: number }, maxEdge: number, allowUpscale = false) {
  const edge = allowUpscale ? Math.min(maxEdge, 2000) : maxEdge;
  if (![source.width, source.height].every(n => Number.isFinite(n) && (allowUpscale ? n > 0 : n >= 1)) || !Number.isFinite(maxEdge) || maxEdge < 1 || ![output.width, output.height].every(n => Number.isInteger(n) && n >= 1) || output.width > Math.min(allowUpscale ? edge : source.width, edge) || output.height > Math.min(allowUpscale ? edge : source.height, edge)) {
    throw new Error('Export dimensions exceed the original image or selected maximum. Choose smaller dimensions and retry.');
  }
}
export function validateOptions(options: ShareOptions) {
  if (!['web', 'custom'].includes(options.target) || !Number.isInteger(options.maxEdge) || options.maxEdge < 1 || options.maxEdge > 2000 || !Number.isFinite(options.maxMB) || options.maxMB < 0.1 || options.maxMB > 15 || ![0, 10, 15, 20, 25, 30, 50].includes(options.fps) || !['gif', 'webp'].includes(options.format ?? 'gif') || !['#000000', '#ffffff'].includes(options.background)) {
    throw new Error('Choose an edge of 1–2000 px and a file limit of 0.1–15 MB.');
  }
}
export function targetBytes(options: ShareOptions, animated: boolean) {
  return Math.floor((options.target === 'custom' ? options.maxMB : animated ? 15 : 5) * 1_000_000);
}
// Use the encoded timeline for both sampling and frame delays, avoiding a
// second clock when GIF rounds frame boundaries to centiseconds.
export function animationFrameTime(index: number, frames: number, duration: number, format: AnimationFormat = 'gif') {
  const precision = format === 'gif' ? 10 : 1;
  return Math.round(index * duration / frames / precision) * precision;
}

export function sizeLabel(bytes: number) { return bytes < 1_000_000 ? `${(bytes / 1000).toFixed(1)} kB` : `${(bytes / 1_000_000).toFixed(2)} MB`; }

// Group fast frames without changing the timeline. GIF stores centiseconds;
// WebP stores milliseconds. Both use a browser-friendly minimum of 20 ms.
export function animationSchedule(durations: number[], fps: number, format: AnimationFormat = 'gif') {
  const minimum = Math.max(20, fps ? 1000 / fps : 0);
  const groups: { index: number; duration: number }[] = [];
  let start = 0, pending = 0;
  for (let i = 0; i < durations.length; i++) {
    if (!Number.isFinite(durations[i]) || durations[i] <= 0) throw new Error('Animation has invalid frame timing.');
    pending += durations[i];
    if (pending >= minimum) { groups.push({ index: start, duration: pending }); start = i + 1; pending = 0; }
  }
  if (pending) {
    if (pending < minimum && groups.length) groups[groups.length - 1].duration += pending;
    else groups.push({ index: start, duration: pending });
  }
  let total = 0, written = 0;
  return groups.map(group => {
    total += group.duration;
    const precision = format === 'gif' ? 10 : 1;
    const end = Math.round(total / precision) * precision;
    const duration = end - written; written = end;
    if (duration < 20 || duration > (format === 'gif' ? 655350 : 0xffffff)) throw new Error(`Animation timing cannot be represented faithfully as ${format.toUpperCase()}.`);
    return { index: group.index, duration };
  });
}

// Inspect dimensions before asking the browser to allocate a decoded image.
export function rasterHeader(bytes: Uint8Array): { type: string; width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  let width = 0, height = 0, type = '';
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(text(0, 6))) {
    type = 'image/gif'; width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    type = 'image/webp';
    const uint24 = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
    if (text(12, 16) === 'VP8X') { width = 1 + uint24(24); height = 1 + uint24(27); }
    else if (text(12, 16) === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    else if (text(12, 16) === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else if (bytes.length >= 24 && bytes[0] === 137 && text(1, 4) === 'PNG') {
    type = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    type = 'image/jpeg';
    for (let i = 2; i + 3 < bytes.length;) {
      if (bytes[i++] !== 255) break;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > bytes.length) break;
      const length = view.getUint16(i);
      if (length < 2 || i + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        height = view.getUint16(i + 3); width = view.getUint16(i + 5); break;
      }
      i += length;
    }
  }
  if (!type) throw new Error('Sharing export supports JPEG, GIF, WebP and PNG images. Use the original download for this format.');
  if (!width || !height) throw new Error('Could not read the image dimensions. The file may be malformed.');
  if (width * height > MAX_SOURCE_PIXELS || width > 32768 || height > 32768) throw new Error('This image is too large to decode safely here (32 megapixels maximum). Use the original file in a dedicated image editor.');
  return { type, width, height };
}
