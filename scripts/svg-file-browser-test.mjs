import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

if (!process.env.SVG_FILE) throw new Error('Set SVG_FILE to a local SVG to verify. The file is not copied into the extension.');
const svg = await readFile(process.env.SVG_FILE);
const edge = Number(process.env.EDGE || 500), fps = Number(process.env.FPS || 10), seconds = Number(process.env.CLIP_SECONDS || 10), format = process.env.FORMAT || 'gif';
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/svg-file-profile-'));
const extension = path.resolve('extension');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true,
  acceptDownloads: true, viewport: { width: 1200, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const contract = '0xbb6eefd83daab02fa1a697eb9d8495eec9f9b384';
  const imageUrl = 'https://gateway.pinata.cloud/local-svg-fixture.svg';
  await context.route(imageUrl, route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await context.route('https://ethereum-rpc.publicnode.com/**', route => {
    const request = route.request().postDataJSON();
    const result = request.method === 'eth_chainId' ? '0x1' : request.params[0].data.startsWith('0x01ffc9a7')
      ? encodeAbiParameters([{ type: 'bool' }], [true])
      : encodeAbiParameters([{ type: 'string' }], ['data:application/json,' + encodeURIComponent(JSON.stringify({ name: 'Local SVG verification', image: imageUrl }))]);
    return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/results.html#contract=${contract}&token=10&run=1`);
  await page.waitForFunction(() => !document.querySelector('#image').hidden);
  assert.match(await page.locator('#media-caption').textContent(), /^4096 × 4096/);
  await page.locator('#share-media').click();
  await page.locator('#share-svg-duration').waitFor({ state: 'visible' });
  assert.match(await page.locator('#share-original').textContent(), /^4096 × 4096 · 69.3 kB original$/);
  assert.equal(await page.locator('#share-status').getAttribute('data-warning'), 'false');
  console.log('PASS supplied SVG accepts responsive CSS and internal shape-reference animations; original size is 4096 × 4096');
  await page.locator('#share-edge').selectOption(String(edge));
  await page.locator('#share-format').selectOption(format);
  await page.locator('#share-fps').selectOption(String(fps));
  assert.equal(await page.locator('#share-svg-duration').inputValue(), '11.2');
  await page.locator('#share-svg-duration').fill(String(seconds));
  await page.locator('#share-generate').click();
  const progressTimer = setInterval(async () => { try { console.log('STATUS', await page.locator('#share-status').textContent()); } catch {} }, 15000);
  try { await page.waitForFunction(() => !document.querySelector('#share-download').hidden || document.querySelector('#share-status').dataset.warning === 'true', null, { timeout: 305000 }); } finally { clearInterval(progressTimer); }
  assert.equal(await page.locator('#share-status').getAttribute('data-warning'), 'false', await page.locator('#share-status').textContent());
  const info = await page.evaluate(async () => {
    const blob = await (await fetch(document.querySelector('#share-download').href)).blob();
    const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
    await decoder.tracks.ready; await decoder.completed;
    const count = decoder.tracks.selectedTrack.frameCount;
    const hashes = new Set(); let duration = 0; let width, height;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      width = image.displayWidth; height = image.displayHeight; duration += image.duration / 1000;
      const canvas = new OffscreenCanvas(width, height); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
      const pixels = ctx.getImageData(0, 0, width, height).data;
      hashes.add(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))).join(','));
    }
    decoder.close(); return { width, height, count, duration, uniqueFrames: hashes.size, bytes: blob.size };
  });
  assert.ok(info.width <= edge); assert.equal(info.height, info.width);
  assert.equal(info.count, Math.ceil(fps * seconds)); assert.equal(info.duration, Math.round(seconds * 1000));
  assert.ok(info.uniqueFrames > 10); assert.ok(info.bytes <= 15_000_000);
  const event = page.waitForEvent('download'); await page.locator('#share-download').click();
  const download = await event;
  assert.equal(download.suggestedFilename(), `${contract}--10--local-svg-verification--web.${format}`);
  await download.saveAs(`test-results/${download.suggestedFilename()}`);
  await page.screenshot({ path: 'test-results/svg-file-export.png', fullPage: true });
  await page.locator('#close-share-modal').click();
  await page.locator('#share-media').click();
  assert.match(await page.locator('#share-original').textContent(), /^4096 × 4096/);
  assert.deepEqual(errors, []);
} finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
