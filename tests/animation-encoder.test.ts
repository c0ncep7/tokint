import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildSync } from 'esbuild';
import { gifInfo } from '../src/gif-info';
import { optimizeGif } from '../src/gif-optimizer';

// Exercise the same bundled gifenc module that the browser uses. The upstream
// package's Node ESM entry does not expose its advertised named exports.
const bundle = buildSync({
  stdin: { contents: 'export { AnimationEncoder } from "./src/animation-encoder"; export { gifPalette } from "./src/gif-palette";', resolveDir: process.cwd() },
  bundle: true, format: 'esm', write: false,
}).outputFiles[0].text;
const { AnimationEncoder, gifPalette }: {
  AnimationEncoder: typeof import('../src/animation-encoder').AnimationEncoder;
  gifPalette: typeof import('../src/gif-palette').gifPalette;
} = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);

test('transferred GIF frames retain dimensions, frame delays, and source pixels without canvas copies', async () => {
  const canvas = { width: 4, height: 2, getContext() { throw new Error('A transferred GIF frame must not read back from a canvas.'); } } as unknown as OffscreenCanvas;
  const encoder = new AnimationEncoder('gif', canvas);
  const first = new Uint8ClampedArray(32);
  for (let i = 0; i < first.length; i += 4) first.set([255, 0, 0, 255], i);
  const second = first.slice(); second.set([0, 0, 255, 255], 24);
  const expected = second.slice();
  await encoder.addFrame(50, first);
  await encoder.addFrame(50, second);
  await encoder.addFrame(100, second.slice());
  assert.deepEqual(second, expected);
  const blob = encoder.finish();
  assert.deepEqual(gifInfo(new Uint8Array(await blob.arrayBuffer())), { width: 4, height: 2, frames: 3, duration: 200 });
  await assert.rejects(encoder.addFrame(50, new Uint8ClampedArray(4)), /Invalid animation frame/);
});

test('fast GIF palettes retain exact flat colors and represent complex RGB frames with 256 colors', () => {
  const simple = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255]);
  assert.deepEqual(gifPalette(simple, 256).sort(), [[255, 0, 0], [0, 0, 255], [0, 255, 0]].sort());
  const complex = new Uint8ClampedArray(32768 * 4);
  for (let i = 0; i < 32768; i++) complex.set([(i & 31) * 8, ((i >> 5) & 31) * 8, ((i >> 10) & 31) * 8, 255], i * 4);
  const palette = gifPalette(complex, 256);
  assert.equal(palette.length, 256);
  let error = 0;
  for (let i = 0; i < complex.length; i += 4) {
    error += Math.min(...palette.map(color => color.reduce((sum, v, c) => sum + (v - complex[i + c]) ** 2, 0)));
  }
  assert.ok(Math.sqrt(error / 32768 / 3) < 16, 'bounded palette must retain representative RGB colors');
});

test('GIFs already within the file limit bypass additional compression without changing bytes or timing', async () => {
  const blob = new Blob([await readFile(new URL('fixtures/moving.gif', import.meta.url))], { type: 'image/gif' });
  const result = await optimizeGif(blob, 15_000_000, () => { throw new Error('Unnecessary compression pass'); });
  assert.equal(result.blob, blob);
  assert.equal(result.width, 320); assert.equal(result.height, 160);
  assert.equal(result.duration, 1000); assert.equal(result.frames, 20);
});
