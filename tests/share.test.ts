import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertExportDimensions, fitDimensions, rasterHeader, targetBytes, validateOptions, type ShareOptions } from '../src/share-core';
import { downloadName } from '../src/downloads';
import { loadImage } from '../src/network';
const options: ShareOptions = { target: 'web', maxEdge: 2000, maxMB: 15, fps: 0, background: '#000000' };

test('sharing dimensions fit landscape, portrait, square and custom edges without upscaling', () => {
  assert.deepEqual(fitDimensions(6000, 4000, 2000), { width: 2000, height: 1333 });
  assert.deepEqual(fitDimensions(4000, 6000, 500), { width: 333, height: 500 });
  assert.deepEqual(fitDimensions(800, 800, 750), { width: 750, height: 750 });
  assert.deepEqual(fitDimensions(320, 160, 2000), { width: 320, height: 160 });
  assert.deepEqual(fitDimensions(20000, 1, 500), { width: 500, height: 1 });
  assert.throws(() => fitDimensions(0, 20, 2000));
});
test('HTML and SVG exports upscale proportionally within the selected edge and the 2000 px cap', () => {
  for (const [width, height, maxEdge, expectedWidth, expectedHeight] of [
    [32, 16, 2000, 2000, 1000],
    [16, 32, 2000, 1000, 2000],
    [10, 10, 2000, 2000, 2000],
    [32, 16, 750, 750, 375],
    [6000, 4000, 2000, 2000, 1333],
    [10.8, 5.6, 2000, 2000, 1037],
    [0.5, 1, 2000, 1000, 2000],
    [32, 16, 5000, 2000, 1000],
    [1, 10000, 1, 1, 1],
  ]) {
    const source = { width, height };
    const output = fitDimensions(width, height, maxEdge, true);
    assert.deepEqual(output, { width: expectedWidth, height: expectedHeight });
    assertExportDimensions(output, source, maxEdge, true);
  }
  for (const output of [{ width: 2001, height: 1000 }, { width: 1000, height: 2001 }, { width: 10.5, height: 5 }, { width: NaN, height: 1 }]) {
    assert.throws(() => assertExportDimensions(output, { width: 32, height: 16 }, 5000, true), /selected maximum/);
  }
  assert.throws(() => assertExportDimensions({ width: 1000, height: 500 }, { width: 32, height: 16 }, 750, true), /selected maximum/);
  for (const width of [0, -1, NaN, Infinity]) assert.throws(() => fitDimensions(width, 20, 2000, true));
});
test('sharing target limits distinguish still images, animations and custom test bounds', () => {
  assert.equal(targetBytes(options, false), 5_000_000);
  assert.equal(targetBytes(options, true), 15_000_000);
  assert.equal(targetBytes({ ...options, target: 'custom', maxMB: 0.1 }, true), 100_000);
});
test('invalid conversion options fail before allocating resources', () => {
  validateOptions(options);
  for (const change of [{ maxEdge: 0 }, { maxEdge: 2001 }, { maxEdge: 10.5 }, { maxMB: 0 }, { maxMB: Infinity }, { fps: 120 }, { background: 'red' }, { target: 'unknown' }]) assert.throws(() => validateOptions({ ...options, ...change } as ShareOptions));
});
test('headers identify real JPEG, GIF, animated WebP and PNG dimensions before decoding', async () => {
  for (const [name, type, width, height] of [['wide.jpg', 'image/jpeg', 3200, 1600], ['moving.gif', 'image/gif', 320, 160], ['moving.webp', 'image/webp', 320, 160], ['noise.png', 'image/png', 600, 300]] as const) {
    assert.deepEqual(rasterHeader(await readFile(new URL(`fixtures/${name}`, import.meta.url))), { type, width, height });
  }
});
test('malformed and oversized image headers produce actionable errors', async () => {
  assert.throws(() => rasterHeader(new Uint8Array()), /supports/);
  assert.throws(() => rasterHeader(new TextEncoder().encode('<html>bad</html>')), /supports/);
  const oversized = new Uint8Array(await readFile(new URL('fixtures/moving.gif', import.meta.url)));
  oversized[6] = oversized[8] = 0xff; oversized[7] = oversized[9] = 0x7f;
  assert.throws(() => rasterHeader(oversized), /too large/);
  oversized[6] = oversized[7] = 0;
  assert.throws(() => rasterHeader(oversized), /malformed/);
});
test('web postfix retains the complete address and large token ID', () => {
  assert.equal(downloadName('0x00000000000000000000000000000000000000ab', 900719925474099312345n, 'web', 'gif'), '0x00000000000000000000000000000000000000ab--900719925474099312345--web.gif');
});
test('original media is unlimited while callers can bound conversion inputs', async () => {
  const response = () => new Response('GIF89a', { headers: { 'Content-Type': 'image/gif', 'Content-Length': String(21 * 1024 * 1024) } });
  const opts = { permitted: async () => true, fetcher: async () => response() };
  assert.equal((await loadImage('https://example.com/image', opts)).size, 6);
  assert.equal((await loadImage('https://example.com/image', opts, 100 * 1024 * 1024)).size, 6);
  await assert.rejects(loadImage('https://example.com/image', { ...opts, fetcher: async () => new Response('123456') }, 5), /exceeds/);
});

test('animation timing preserves the full timeline when reducing fps or grouping fast frames', async () => {
  const { animationSchedule } = await import('../src/share-core');
  const original = animationSchedule(Array(20).fill(50), 0);
  assert.equal(original.length, 20);
  const slower = animationSchedule(Array(20).fill(50), 10);
  assert.equal(slower.length, 10); assert.equal(slower.reduce((sum, f) => sum + f.duration, 0), 1000);
  const fast = animationSchedule(Array(100).fill(10), 0);
  assert.equal(fast.length, 50); assert.equal(fast.reduce((sum, f) => sum + f.duration, 0), 1000);
  const tail = animationSchedule([50, 50, 50, 50, 10], 10);
  assert.deepEqual(tail, [{ index: 0, duration: 100 }, { index: 2, duration: 110 }]);
  const rounded = animationSchedule([25, 25, 25, 25], 0);
  assert.deepEqual(rounded.map(f => f.duration), [30, 20, 30, 20]);
  assert.throws(() => animationSchedule([NaN], 0), /timing/);
});

test('without upscaling, fractional dimensions round down and exports enforce each source dimension', () => {
  assert.deepEqual(fitDimensions(10.8, 5.6, 2000), { width: 10, height: 5 });
  assert.deepEqual(fitDimensions(1.8, 10.8, 2000), { width: 1, height: 10 });
  assert.throws(() => fitDimensions(0.5, 10, 2000), /one pixel/);
  const source = { width: 320, height: 160 };
  assertExportDimensions({ width: 320, height: 160 }, source, 2000);
  assertExportDimensions({ width: 160, height: 80 }, source, 2000);
  for (const output of [{ width: 321, height: 160 }, { width: 320, height: 161 }, { width: 320.1, height: 160 }, { width: NaN, height: 1 }]) assert.throws(() => assertExportDimensions(output, source, 2000), /original image/);
  assert.throws(() => assertExportDimensions(source, source, 100), /selected maximum/);
});


test('higher rates and both animation formats validate; WebP retains millisecond timing', async () => {
  const { animationSchedule } = await import('../src/share-core');
  for (const format of ['gif', 'webp'] as const) for (const fps of [25, 30, 50]) validateOptions({ ...options, format, fps });
  assert.throws(() => validateOptions({ ...options, format: 'png' } as unknown as ShareOptions));
  const fast = animationSchedule(Array(50).fill(20), 50, 'webp');
  assert.equal(fast.length, 50); assert.equal(fast.reduce((sum, frame) => sum + frame.duration, 0), 1000);
  assert.deepEqual(animationSchedule([25, 25, 25, 25], 0, 'webp').map(f => f.duration), [25, 25, 25, 25]);
});


test('SVG clips retain selected dimensions and timing above the former aggregate pixel budget', async () => {
  const { svgExportSize } = await import('../src/svg');
  const plan = { width: 4096, height: 4096, animated: true, duration: 3, frame: () => '' };
  assert.deepEqual(svgExportSize(plan, { ...options, fps: 25 }, 3), { width: 2000, height: 2000, frames: 75, duration: 3000 });
  assert.deepEqual(svgExportSize(plan, { ...options, fps: 50 }, 10), { width: 2000, height: 2000, frames: 500, duration: 10000 });
});

test('SVG and HTML animation plans upscale small sources without changing clip timing', async () => {
  const { svgExportSize } = await import('../src/svg');
  const plan = { width: 32, height: 16, animated: true };
  assert.deepEqual(svgExportSize(plan, { ...options, fps: 20 }, 0.4), { width: 2000, height: 1000, frames: 8, duration: 400 });
  assert.deepEqual(svgExportSize(plan, { ...options, maxEdge: 500, fps: 20 }, 0.4), { width: 500, height: 250, frames: 8, duration: 400 });
});


test('generated GIF inspection checks dimensions, complete frame count and total timing', async () => {
  const { gifInfo } = await import('../src/gif-info');
  const bytes = await readFile(new URL('fixtures/moving.gif', import.meta.url));
  assert.deepEqual(gifInfo(bytes), { width: 320, height: 160, frames: 20, duration: 1000 });
  assert.throws(() => gifInfo(bytes.subarray(0, bytes.length - 1)), /end marker/);
});
test('SVG sampling follows encoded GIF and WebP timestamps and accepts the full 11.2 second cycle', async () => {
  const { animationFrameTime } = await import('../src/share-core');
  assert.deepEqual([0, 1, 2, 3].map(i => animationFrameTime(i, 30, 1000, 'gif')), [0, 30, 70, 100]);
  assert.deepEqual([0, 1, 2, 3].map(i => animationFrameTime(i, 30, 1000, 'webp')), [0, 33, 67, 100]);
  const { svgExportSize } = await import('../src/svg');
  const plan = { width: 4096, height: 4096, animated: true, duration: 11.2, frame: () => '' };
  assert.deepEqual(svgExportSize(plan, { ...options, fps: 25, maxEdge: 1000 }, 11.2), { width: 1000, height: 1000, frames: 280, duration: 11200 });
});
