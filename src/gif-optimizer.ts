import { gifInfo } from './gif-info';
export const MAX_INTERMEDIATE_BYTES = 80_000_000;
export async function optimizeGif(blob: Blob, limit: number, progress: (text: string) => void) {
  const file = await blob.arrayBuffer();
  const original = gifInfo(new Uint8Array(file));
  // The encoder already emits cropped delta frames. Additional compression is
  // only needed to meet the download limit, not for every successful export.
  if (blob.size <= limit) return { blob, note: 'GIF delta compression.', ...original };
  const { default: run } = await import('./gifsicle-runtime.js');
  let best = blob, note = 'GIF delta compression.';
  // First optimize without additional visual loss, then try bounded color
  // compression. Never change frame delays, speed, dimensions, or clip length.
  for (const [colors, loss] of [[0, 0], [128, 20], [64, 40], [32, 60]]) {
    progress(loss ? `Optimizing GIF · ${colors} colors` : 'Optimizing GIF · preserving colors');
    const outputs = await run({ data: [{ name: 'input.gif', file }], command: [`-O1 --careful ${original.width * original.height * original.frames <= 400_000_000 ? '--no-conserve-memory' : ''} ${loss ? `--colors ${colors} --no-dither --lossy=${loss}` : ''} input.gif -o /out/result.gif`] });
    const bytes = outputs?.find(output => output.name === 'result.gif')?.file;
    if (!bytes?.length) throw new Error('GIF optimization failed. Try smaller dimensions.');
    const info = gifInfo(bytes);
    if (info.width !== original.width || info.height !== original.height || info.duration !== original.duration || !info.frames) throw new Error('GIF optimization changed the animation timeline.');
    if (bytes.length < best.size) { best = new Blob([bytes], { type: 'image/gif' }); note = loss ? `GIF optimized to ${colors} colors with compression ${loss}; color detail may change.` : 'GIF optimized without additional color loss.'; }
    if (best.size <= limit) break;
  }
  return { blob: best, note, ...gifInfo(new Uint8Array(await best.arrayBuffer())) };
}
