import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import gifenc from 'gifenc';
import { createServer } from 'node:http';
import { once } from 'node:events';

await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/share-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium',
  headless: true, acceptDownloads: true, viewport: { width: 1000, height: 900 },
  args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
});
const contract = '0x0000000000000000000000000000000000000001';
const base = 'https://gateway.pinata.cloud/share';
const fixtures = {};
for (const name of ['wide.jpg', 'moving.gif', 'moving.webp', 'noise.png']) fixtures[name] = await readFile(`tests/fixtures/${name}`);
const busy = gifenc.GIFEncoder();
const palette = Array.from({ length: 256 }, (_, i) => [i, (i * 73) % 256, (i * 131) % 256]);
let random = 74231;
for (let f = 0; f < 60; f++) {
  const pixels = new Uint8Array(320 * 160);
  for (let i = 0; i < pixels.length; i++) { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; pixels[i] = random >>> 24; }
  busy.writeFrame(pixels, 320, 160, { palette, delay: 50, repeat: 0 });
}
busy.finish(); fixtures['busy.gif'] = Buffer.from(busy.bytes());
const stillGif = gifenc.GIFEncoder();
stillGif.writeFrame(new Uint8Array(10 * 10), 10, 10, { palette: [[255, 0, 0]], delay: 100 });
stillGif.finish(); fixtures['still.gif'] = Buffer.from(stillGif.bytes());
fixtures['animated.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"><animate attributeName="opacity" values="0;1;0" dur="1s" repeatCount="indefinite"/></rect></svg>');
fixtures['still.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
fixtures['fractional.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10.8" height="5.6"><rect width="10.8" height="5.6" fill="red"/></svg>');
fixtures['fractional-animated.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10.8" height="5.6"><rect width="10.8" height="5.6" fill="red"><animate attributeName="fill" values="red;blue;red" dur="1s" repeatCount="indefinite"/></rect></svg>');
fixtures['css.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><style>@keyframes color{from{fill:red}to{fill:blue}}</style><rect width="80" height="40" style="animation:color 2s linear infinite"/></svg>');
fixtures['large-svg.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="red"><animate attributeName="fill" values="red;blue;red" dur="2s" repeatCount="indefinite"/></rect></svg>');
fixtures['script.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>fetch("https://svg-attacker.example/script")</script><rect width="10" height="10" fill="red"/></svg>');
fixtures['external.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://svg-attacker.example/image"/></svg>');
fixtures['event.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"><animate attributeName="opacity" values="0;1" begin="click" dur="1s"/></rect></svg>');
fixtures['css-delay.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>@keyframes c{from{fill:red}to{fill:blue}}rect{animation:c 1s linear infinite;animation-delay:0.5s}</style><rect fill="green" width="10" height="10"/></svg>');
fixtures['smil-transform.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20" fill="red"><animateTransform attributeName="transform" type="translate" values="0 0;30 0;0 0" dur="2s" repeatCount="indefinite"/></rect></svg>');


fixtures['responsive-shapes.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><style>@supports(display:block){@media(min-aspect-ratio:3/2){.art{opacity:0.5}}}</style><defs><rect id="a" width="20" height="10" fill="red"/><rect id="b" width="20" height="10" fill="blue"/></defs><use class="art" href="#a"><animate attributeName="href" values="#a;#b" dur="1s" calcMode="discrete" repeatCount="indefinite"/></use></svg>');
fixtures['bad-href.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><rect id="a" width="10" height="10"/></defs><use href="#a"><animate attributeName="href" values="#a;https://svg-attacker.example/external.svg#shape" dur="1s"/></use></svg>');
const delta = gifenc.GIFEncoder();
for (let f = 0; f < 10; f++) {
  const pixels = new Uint8Array(64 * 32);
  const x = 7 + 3 * (f === 6 ? 5 : f);
  if (f !== 9) for (let y = 9; y < 17; y++) for (let dx = 0; dx < 8; dx++) pixels[y * 64 + x + dx] = 1;
  delta.writeFrame(pixels, 64, 32, { palette: [[255,255,255], [0,0,0]], delay: 100, repeat: 0 });
}
delta.finish(); fixtures['delta.gif'] = Buffer.from(delta.bytes());
// Stream the large fixture over HTTP: DevTools route.fulfill serializes an entire
// body into a single protocol message and is unsuitable for 100+ MiB fixtures.
const largeServer = createServer(async (req, res) => {
  if (req.url !== '/huge.jpg') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': fixtures['wide.jpg'].length + 101 * 1024 * 1024, 'Access-Control-Allow-Origin': '*' });
  res.write(fixtures['wide.jpg']); const chunk = Buffer.alloc(1024 * 1024);
  try { for (let i = 0; i < 101; i++) { if (res.destroyed) return; if (!res.write(chunk)) await once(res, 'drain'); } res.end(); } catch { res.destroy(); }
});
await new Promise(resolve => largeServer.listen(0, '127.0.0.1', resolve));
const largeUrl = `http://127.0.0.1:${largeServer.address().port}/huge.jpg`;
const check = name => { count++; console.log(`PASS ${name}`); };
let count = 0, mediaRequests = 0, slowAttempts = 0;
const errors = [];
try {
  await (async () => {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

  const extensionId = new URL(sw.url()).host;
  const page = await context.newPage();
  const cspErrors = [];
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Content Security Policy')) cspErrors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://ethereum-rpc.publicnode.com/**', async route => {
    const request = route.request().postDataJSON();
    let result;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.params[0].data.startsWith('0x01ffc9a7')) result = encodeAbiParameters([{ type: 'bool' }], [true]);
    else {
      const id = BigInt('0x' + request.params[0].data.slice(-64)).toString();
      result = encodeAbiParameters([{ type: 'string' }], [`${base}/${id}.json`]);
    }
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } });
  });
  await context.route(`${base}/**`, async route => {
    const filename = new URL(route.request().url()).pathname.split('/').at(-1);
    if (filename.endsWith('.json')) {
      const id = filename.split('.')[0];
      if (id === '8') slowAttempts = 0;
      const image = ({ 1: 'wide.jpg', 2: 'moving.gif', 3: 'moving.webp', 4: 'oversized.jpg', 5: 'broken.gif', 6: 'large-download.jpg', 7: 'blocked.gif', 8: 'slow.jpg', 9: 'huge-download.jpg', 10: 'noise.png', 11: 'busy.gif', 12: 'still.gif', 13: 'still.webp', 14: 'animated.svg', 15: 'still.svg', 16: 'css.svg', 17: 'script.svg', 18: 'external.svg', 19: 'event.svg', 20: 'css-delay.svg', 21: 'smil-transform.svg', 22: 'large-svg.svg', 23: 'fractional.svg', 24: 'fractional-animated.svg', 25: 'responsive-shapes.svg', 26: 'bad-href.svg', 27: 'delta.gif', 28: 'embedded-background.svg', 29: 'embedded-style.svg', 30: 'embedded-image.svg', 31: 'embedded-filter.svg', 32: 'mixed-resources.svg' })[id] ?? 'wide.jpg';
      await route.fulfill({ json: { name: `Sharing fixture ${id}`, image: image === 'huge-download.jpg' ? largeUrl : image === 'blocked.gif' ? 'https://sharing-denied.example/file.gif' : `${base}/${image}` } });
      return;
    }
    mediaRequests++;
    if (filename === 'oversized.jpg') {
      const gif = Buffer.from(fixtures['moving.gif']); gif.writeUInt16LE(32767, 6); gif.writeUInt16LE(32767, 8);
      await route.fulfill({ contentType: 'image/gif', body: gif }); return;
    }
    if (filename === 'broken.gif') { await route.fulfill({ contentType: 'image/gif', body: 'GIF89a broken' }); return; }
    if (filename === 'slow.jpg' && slowAttempts++ === 0) { await route.fulfill({ status: 503, body: 'Temporary preview failure' }); return; }
    if (filename === 'slow.jpg') await new Promise(resolve => setTimeout(resolve, 600));
    const body = fixtures[filename] ?? fixtures['wide.jpg'];
    const headers = {};
    if (filename === 'large-download.jpg' || filename === 'slow.jpg') headers['content-length'] = String(21 * 1024 * 1024);
    try { await route.fulfill({ contentType: filename.endsWith('.svg') ? 'image/svg+xml' : filename.endsWith('.gif') ? 'image/gif' : filename.endsWith('.webp') ? 'image/webp' : filename.endsWith('.png') ? 'image/png' : 'image/jpeg', body, headers }); } catch { /* cancellation */ }
  });
  await page.goto(`chrome-extension://${extensionId}/results.html`);
  await page.waitForFunction(() => document.querySelector('.shell')?.inert === false);
  await page.evaluate(() => {
    const contains = chrome.permissions.contains.bind(chrome.permissions);
    chrome.permissions.contains = query => query.origins?.some(origin => origin.startsWith('http://127.0.0.1/')) ? Promise.resolve(true) : contains(query);
  });
  fixtures['still.webp'] = Buffer.from(await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(10, 10); const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 10, 10);
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp' })).arrayBuffer()));
  }));
  const embeddedPng = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 16, 32);
    ctx.fillStyle = 'blue'; ctx.fillRect(16, 0, 16, 32);
    return canvas.toDataURL('image/png');
  });
  fixtures['embedded-background.svg'] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" style="background-image:url(${embeddedPng});background-size:contain;background-repeat:no-repeat;image-rendering:pixelated"/>`);
  fixtures['embedded-style.svg'] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><style>svg{background-image:url('${embeddedPng}');background-size:contain;image-rendering:pixelated}rect{animation:fade 1s linear infinite}@keyframes fade{from{opacity:0}to{opacity:1}}</style><rect width="32" height="32" fill="blue"/></svg>`);
  fixtures['embedded-image.svg'] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="32"><image width="32" height="32" xlink:href="${embeddedPng}" style="image-rendering:pixelated"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></image></svg>`);
  fixtures['embedded-filter.svg'] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><defs><filter id="image" x="0" y="0" width="100%" height="100%"><feImage href="${embeddedPng}"/></filter></defs><rect width="32" height="32" filter="url(&quot;#image&quot;)"/></svg>`);
  fixtures['mixed-resources.svg'] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" style="background-image:url('${embeddedPng}'),url('https://svg-attacker.example/image')"/>`);
  assert.equal(await page.locator('#share-media').isVisible(), false);
  const submit = async id => {
    await page.locator('#contract').fill(contract); await page.locator('#token').fill(String(id)); await page.locator('#token').press('Enter');
    try { await page.waitForFunction(id => document.querySelector('#name').textContent === `Sharing fixture ${id}`, String(id)); }
    catch (error) { console.log(await page.evaluate(() => ({ status: document.querySelector('#status').textContent, name: document.querySelector('#name').textContent, token: document.querySelector('#token').value, modal: document.querySelector('#share-modal').open })), errors); throw error; }
    await page.waitForFunction(() => !document.querySelector('#image').hidden || document.querySelector('#status-row').dataset.state === 'error');
  };
  const open = async () => { await page.locator('#share-media').click(); assert.equal(await page.locator('#share-modal').evaluate(d => d.open), true); };
  const ready = () => page.waitForFunction(() => !document.querySelector('#share-download').hidden);
  const generate = async () => { await page.locator('#share-generate').click(); await ready(); };
  const inspectOutput = async () => page.evaluate(async () => {
    const blob = await (await fetch(document.querySelector('#share-download').href)).blob();
    const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
    await decoder.tracks.ready; await decoder.completed;
    const count = decoder.tracks.selectedTrack.frameCount;
    const samples = []; let duration = 0; let width, height;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i }); width = image.displayWidth; height = image.displayHeight; duration += (image.duration || 0) / 1000;
      const canvas = new OffscreenCanvas(width, height); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      samples.push([...ctx.getImageData(Math.floor(width / 4), Math.floor(height / 2), 1, 1).data]); image.close();
    }
    decoder.close(); return { count, duration, width, height, samples, size: blob.size, type: blob.type };
  });
  {
    for (const id of [6, 9]) {
      await submit(id);
      if (id === 9) {
        assert.match(await page.locator('#status').textContent(), /exceeds/);
        assert.equal(await page.locator('#image').isVisible(), false);
      } else assert.equal(await page.locator('#status').textContent(), '');
      await open();
      const downloadEvent = page.waitForEvent('download');
      await page.locator(id === 9 ? '#fetch-original-media' : '#download-media').click();
      const file = await downloadEvent; const bytes = await readFile(await file.path());
      assert.equal(file.suggestedFilename(), `${contract}--${id}--media.jpg`);
      assert.equal(bytes.length, fixtures['wide.jpg'].length + (id === 9 ? 101 * 1024 * 1024 : 0));
      assert.deepEqual(bytes.subarray(0, fixtures['wide.jpg'].length), fixtures['wide.jpg']);
      if (id === 9) {
        assert.equal(bytes.subarray(fixtures['wide.jpg'].length).every(n => n === 0), true);
        await page.locator('#share-generate').click();
        await page.waitForFunction(() => document.querySelector('#share-status').textContent.includes('100 MiB'));
      }
      await page.locator('#close-share-modal').click();
    }
    check('automatic preview rejects 101 MiB, explicit originals download exactly, and conversion remains bounded');
    slowAttempts = 0; await submit(8); await open();
    const originalEvent = page.waitForEvent('download'); await page.locator('#fetch-original-media').click();
    const originalFile = await originalEvent;
    assert.deepEqual(await readFile(await originalFile.path()), fixtures['wide.jpg']);
    await page.locator('#close-share-modal').click();
    check('on-demand original retrieval works after a failed preview');
    slowAttempts = 0; await submit(8); await open(); await page.locator('#fetch-original-media').click();
    await page.evaluate(() => { document.querySelector('#token').value = '1'; document.querySelector('#lookup-form').requestSubmit(); });
    await page.waitForFunction(() => !document.querySelector('#share-modal').open && !document.querySelector('#image').hidden);
    await page.waitForTimeout(800); await open();
    assert.equal(await page.locator('#download-media').getAttribute('download'), `${contract}--1--media.jpg`);
    assert.deepEqual(errors, []); check('switching tokens cancels original retrieval without publishing stale downloads');
  }
  await submit(1);
  const before = mediaRequests;
  await open();
  assert.equal(await page.locator('#share-target').count(), 0);
  assert.equal(await page.locator('#share-custom-mb').count(), 0);
  assert.equal(await page.locator('#share-output').textContent(), '');
  assert.equal(await page.locator('#share-preview-stage').isVisible(), false);
  assert.equal(await page.locator('#share-animation-controls').isVisible(), false);
  await page.screenshot({ path: 'test-results/share-empty.png' });
  check('sharing opens without a target dropdown, empty export placeholder, or animation controls for JPEG');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'close-share-modal');
  await page.evaluate(() => document.querySelector('#token').focus());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'close-share-modal');
  await generate();
  let info = await inspectOutput();
  assert.equal(info.width, 2000); assert.equal(info.height, 1000); assert.equal(info.type, 'image/jpeg'); assert.ok(info.size < 5_000_000);
  assert.equal(mediaRequests, before);
  const downloadEvent = page.waitForEvent('download');
  await page.evaluate(() => { document.querySelector('#token').value = '999999999999999999'; });
  await page.locator('#share-download').click(); const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), `${contract}--1--sharing-fixture-1--web.jpg`);
  assert.equal((await readFile(await download.path())).length, info.size);
  check('JPEG fits 2000px / 5MB, preserves 2:1 ratio, reuses source, downloads web postfix with loaded identity');
  await page.locator('#share-edge').selectOption('custom'); await page.locator('#share-custom-edge').fill('333');
  assert.equal(await page.locator('#share-download').isVisible(), false);
  await generate(); info = await inspectOutput(); assert.equal(info.width, 333); assert.equal(info.height, 167);
  await page.screenshot({ path: 'test-results/share-jpeg.png' });
  check('custom dimensions invalidate old output and preserve aspect ratio to the nearest pixel');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#share-modal').evaluate(d => d.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'share-media');
  assert.equal(await page.locator('#share-preview').getAttribute('src'), null);
  check('sharing modal traps focus and Escape clears export and restores focus');
  await submit(2); await open(); await page.locator('#share-fps').waitFor({ state: 'visible' }); await page.locator('#share-edge').selectOption('2000'); await generate(); info = await inspectOutput();
  assert.equal(info.width, 320); assert.equal(info.height, 160); assert.equal(info.count, 20); assert.equal(info.duration, 1000);
  assert.notDeepEqual(info.samples[0], info.samples[1]);
  assert.equal(info.type, 'image/gif'); assert.ok(info.size < 15_000_000);
  assert.equal(await page.locator('#share-format').inputValue(), 'gif');
  check('GIF export preserves animation frames, timing and original small dimensions');
  await page.locator('#share-fps').selectOption('10'); await generate(); info = await inspectOutput();
  assert.equal(info.count, 10); assert.equal(info.duration, 1000);
  check('lower frame rate drops frames while retaining full playback duration');
  await page.locator('#share-background').selectOption('#ffffff');
  await page.locator('#share-edge').selectOption('custom'); await page.locator('#share-custom-edge').fill('160'); await generate(); info = await inspectOutput();
  assert.equal(info.width, 160); assert.equal(info.height, 80);
  assert.ok(info.samples.at(-1).slice(0, 3).every(n => n > 245));
  await page.screenshot({ path: 'test-results/share-animation.png' });
  check('animation resize preserves aspect ratio and selected white background replaces transparency without trails');
  await page.locator('#close-share-modal').click();
  await submit(3); await open(); await page.locator('#share-fps').selectOption('0'); await generate(); info = await inspectOutput();
  assert.equal(info.type, 'image/gif'); assert.equal(info.count, 20); assert.equal(info.duration, 1000); assert.equal(info.width, 160);
  assert.notDeepEqual(info.samples[0], info.samples[1]);
  const gifDownloadEvent = page.waitForEvent('download'); await page.locator('#share-download').click(); const gifDownload = await gifDownloadEvent;
  assert.equal(gifDownload.suggestedFilename(), `${contract}--3--sharing-fixture-3--web.gif`);
  assert.equal((await readFile(await gifDownload.path())).subarray(0, 6).toString(), 'GIF89a');
  check('animated WebP converts to a real animated GIF download with matching duration');
  await page.locator('#share-format').selectOption('webp');
  assert.equal(await page.locator('#share-download').isVisible(), false);
  await page.locator('#share-fps').selectOption('50'); await generate(); info = await inspectOutput();
  assert.equal(info.type, 'image/webp'); assert.equal(info.count, 20); assert.equal(info.duration, 1000);
  assert.equal(info.width, 160); assert.equal(info.height, 80); assert.ok(info.size < 15_000_000);
  assert.notDeepEqual(info.samples[0], info.samples[1]);
  assert.ok(info.samples.at(-1).slice(0, 3).every(n => n > 240));
  const webpDownloadEvent = page.waitForEvent('download'); await page.locator('#share-download').click(); const webpDownload = await webpDownloadEvent;
  assert.equal(webpDownload.suggestedFilename(), `${contract}--3--sharing-fixture-3--web.webp`);
  const webpBytes = await readFile(await webpDownload.path());
  assert.equal(webpBytes.subarray(0, 4).toString(), 'RIFF'); assert.equal(webpBytes.subarray(8, 12).toString(), 'WEBP');
  check('WebP animation download decodes all frames, retains timing, respects size, avoids upscaling and does not invent higher-rate frames');
  await page.locator('#share-format').selectOption('gif'); await page.locator('#share-fps').selectOption('0'); await generate();

  assert.equal(await page.locator('#share-limit, #share-notes, #share-dimensions, #download-metadata').count(), 0);
  assert.equal(await page.locator('#share-status').textContent(), '');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#share-modal').evaluate(d => d.scrollWidth <= d.clientWidth), true);
  await page.screenshot({ path: 'test-results/share-narrow.png' });
  await page.locator('#close-share-modal').click();
  await page.locator('#theme-toggle').click(); await open(); await generate();
  await page.screenshot({ path: 'test-results/share-light.png' });
  check('automatic animation limit and compact sharing modal work in narrow and light layouts');
  await page.locator('#close-share-modal').click(); await page.locator('#theme-toggle').click();
  await page.setViewportSize({ width: 1000, height: 900 });
  for (const id of [12, 13, 10]) {
    await submit(id); await open(); await generate();
    const still = await inspectOutput();
    assert.equal(still.type, 'image/jpeg'); assert.equal(still.count, 1);
    assert.equal(await page.locator('#share-format-label').isVisible(), false);
    assert.equal(await page.locator('#share-animation-controls').isVisible(), false);
    await page.locator('#close-share-modal').click();
  }
  check('single-frame GIF, static WebP and PNG keep animation controls hidden and export still images');
  if (process.env.MODAL_UI_ONLY) { assert.deepEqual(errors, []); console.log(`${count} modal conversion checks passed.`); return; }
  for (const id of [23, 24]) {
    await submit(id); await open();
    await page.waitForFunction(() => document.querySelector('#share-original').textContent.includes('10.8 × 5.6'));
    await page.locator('#share-edge').selectOption('500');
    await generate(); const bounded = await inspectOutput();
    assert.equal(bounded.width, 500); assert.equal(bounded.height, 259);
    await page.locator('#close-share-modal').click();
  }
  check('static and animated SVG exports upscale fractional source dimensions with proportional rounding');
  const svgRequests = [];
  page.on('request', request => { if (request.url().includes('svg-attacker.example')) svgRequests.push(request.url()); });
  await submit(14); await open();
  await page.locator('#share-svg-duration').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#share-svg-duration').inputValue(), '1');
  await page.locator('#share-edge').selectOption('custom'); await page.locator('#share-custom-edge').fill('100');
  await page.locator('#share-fps').selectOption('20'); await generate(); info = await inspectOutput();
  assert.equal(info.type, 'image/gif'); assert.equal(info.count, 20); assert.equal(info.duration, 1000);
  assert.notDeepEqual(info.samples[0], info.samples[10]);
  assert.equal(await page.locator('#share-download').getAttribute('download'), `${contract}--14--sharing-fixture-14--web.gif`);
  check('SMIL SVG is detected before generation and exports changing GIF frames with the selected duration');
  for (const format of ['gif', 'webp']) {
    for (const rate of [25, 30, 50]) {
      await page.locator('#share-format').selectOption(format); await page.locator('#share-fps').selectOption(String(rate));
      await generate(); info = await inspectOutput();
      assert.equal(info.type, `image/${format}`); assert.equal(info.count, rate); assert.equal(info.duration, 1000);
      assert.equal(info.width, 100); assert.equal(info.height, 100); assert.ok(info.size < 15_000_000);
      assert.notDeepEqual(info.samples[0], info.samples[Math.floor(rate / 2)]);
      assert.equal(await page.locator('#share-download').getAttribute('download'), `${contract}--14--sharing-fixture-14--web.${format}`);
      check(`SMIL SVG exports ${rate} fps ${format} with changing frames, exact duration and upscaled dimensions`);
    }
  }
  await page.screenshot({ path: 'test-results/share-webp.png' });
  await page.locator('#share-format').selectOption('gif'); await page.locator('#share-fps').selectOption('20'); await generate();

  await page.screenshot({ path: 'test-results/share-svg.png' });
  await page.locator('#close-share-modal').click();
  await submit(15); await open(); await page.locator('#share-edge').selectOption('2000'); await generate(); info = await inspectOutput();
  assert.equal(info.type, 'image/jpeg'); assert.equal(info.count, 1);
  assert.equal(info.width, 2000); assert.equal(info.height, 2000);
  assert.equal(await page.locator('#share-animation-controls').isVisible(), false);
  assert.equal(await page.locator('#share-svg-duration-label').isVisible(), false);
  assert.equal(await page.locator('#share-download').getAttribute('download'), `${contract}--15--sharing-fixture-15--web.jpg`);
  check('static SVG exports JPEG upscaled to 2000 px without animation or clip-length controls');
  await page.locator('#close-share-modal').click();
  await submit(16); await open(); await page.locator('#share-svg-duration').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#share-svg-duration').inputValue(), '2');
  await page.locator('#share-edge').selectOption('custom'); await page.locator('#share-custom-edge').fill('100');
  await generate(); info = await inspectOutput();
  assert.equal(info.width / info.height, 2); assert.equal(info.duration, 2000); assert.equal(info.count, 40);
  assert.notDeepEqual(info.samples[0], info.samples[20]);
  await page.locator('#share-svg-duration').fill('0.5'); await page.locator('#share-fps').selectOption('10'); await generate(); info = await inspectOutput();
  assert.equal(info.count, 5); assert.equal(info.duration, 500);
  check('CSS keyframe SVG exports animated frames, preserves aspect ratio, and honors clip length and frame rate');
  await page.locator('#close-share-modal').click();
  for (const id of [28, 31]) {
    await submit(id); await open(); await page.locator('#share-edge').selectOption('2000');
    await generate(); info = await inspectOutput();
    assert.equal(info.type, 'image/jpeg'); assert.equal(info.width, 2000); assert.equal(info.height, 2000);
    assert.ok(info.samples[0][0] > 240 && info.samples[0][1] < 10 && info.samples[0][2] < 10, 'embedded PNG must render red, not a blank background');
    const original = await page.evaluate(async () => await (await fetch(document.querySelector('#download-media').href)).text());
    assert.equal(original, fixtures[id === 28 ? 'embedded-background.svg' : 'embedded-filter.svg'].toString());
    await page.locator('#close-share-modal').click();
  }
  check('embedded PNG CSS backgrounds and SVG filter images export JPEG at the selected size and preserve original bytes');
  for (const id of [29, 30]) {
    await submit(id); await open(); await page.locator('#share-svg-duration').waitFor({ state: 'visible' });
    await page.locator('#share-edge').selectOption('500'); await page.locator('#share-fps').selectOption('10');
    await page.locator('#share-svg-duration').fill('1');
    for (const format of ['gif', 'webp']) {
      await page.locator('#share-format').selectOption(format); await generate(); info = await inspectOutput();
      assert.equal(info.type, `image/${format}`); assert.equal(info.count, 10); assert.equal(info.duration, 1000);
      assert.equal(info.width, 500); assert.equal(info.height, 500);
      assert.ok(info.samples[0][0] > 240 && info.samples[0][1] < 10 && info.samples[0][2] < 10);
      assert.notDeepEqual(info.samples[0], info.samples[5]);
    }
    await page.locator('#close-share-modal').click();
  }
  check('embedded PNG stylesheets and xlink images retain animation in GIF and WebP exports');
  for (const id of [17, 18, 19, 26, 32]) {
    await submit(id); await open();
    await page.waitForFunction(() => document.querySelector('#share-status').dataset.warning === 'true');
    assert.match(await page.locator('#share-status').textContent(), /original SVG download/);
    assert.equal(await page.locator('#share-animation-controls').isVisible(), false);
    await page.locator('#share-generate').click();
    await page.waitForFunction(() => document.querySelector('#share-status').dataset.warning === 'true');
    assert.equal(await page.locator('#share-download').isVisible(), false);
    await page.locator('#close-share-modal').click();
  }
  assert.deepEqual(svgRequests, []);
  check('scripted SVG, external resources and event-driven timing warn without executing scripts or fetching linked resources');
  for (const id of [20, 21]) {
    await submit(id); await open(); await page.locator('#share-svg-duration').waitFor({ state: 'visible' });
    await page.locator('#share-edge').selectOption('custom'); await page.locator('#share-custom-edge').fill('100');
    await page.locator('#share-format').selectOption('gif');
    await generate(); info = await inspectOutput();
    assert.ok(info.count > 1); assert.notDeepEqual(info.samples[0], info.samples[Math.floor(info.count / 2)]);
    await page.locator('#close-share-modal').click();
  }
  check('CSS animation delays and SMIL transforms retain changes across sampled frames');
  await submit(25); await open(); await page.locator('#share-svg-duration').waitFor({ state: 'visible' });
  assert.match(await page.locator('#media-caption').textContent(), /^20 × 10/);
  assert.match(await page.locator('#share-original').textContent(), /^20 × 10/);
  await page.locator('#share-background').selectOption('#ffffff'); await generate(); info = await inspectOutput();
  assert.equal(info.width, 100); assert.equal(info.height, 50);
  assert.notDeepEqual(info.samples[0], info.samples[Math.floor(info.count / 2)]);
  assert.ok(info.samples[0][1] > 100 && info.samples[0][1] < 160, 'responsive opacity rule must apply inside the exported SVG viewport');
  await page.locator('#close-share-modal').click();
  check('nested responsive CSS and internal shape-reference animation render correctly, with viewBox dimensions in the modal');

  await submit(22); await open(); await page.locator('#share-svg-duration').waitFor({ state: 'visible' });
  await page.locator('#share-edge').selectOption('1000'); await page.locator('#share-fps').selectOption('20');
  await page.locator('#share-svg-duration').fill('10'); await page.locator('#share-generate').click();
  await page.waitForFunction(() => document.querySelector('#share-status').textContent.includes('Rendering SVG'));
  assert.equal(await page.locator('#share-status').getAttribute('data-warning'), 'false');
  await page.locator('#share-cancel').click();
  await page.locator('#share-format').selectOption('webp'); await generate();
  info = await inspectOutput();
  assert.equal(info.width, 1000); assert.equal(info.height, 1000); assert.equal(info.count, 200); assert.equal(info.duration, 10000);
  assert.ok(info.size <= 15_000_000);
  check('SVG exports above the former 160-million-pixel budget retain dimensions, frame rate and duration');
  await page.locator('#share-format').selectOption('gif');
  await page.locator('#share-svg-duration').fill('5'); await page.locator('#share-generate').click();
  await page.waitForFunction(() => document.querySelector('#share-status').textContent.includes('Rendering SVG'));
  await page.locator('#share-cancel').click(); await page.waitForTimeout(300);
  assert.match(await page.locator('#share-status').textContent(), /Cancelled/);
  assert.equal(await page.locator('#share-download').isVisible(), false);
  await page.locator('#share-generate').click();
  await page.evaluate(() => { document.querySelector('#token').value = '1'; document.querySelector('#lookup-form').requestSubmit(); });
  await page.waitForFunction(() => !document.querySelector('#share-modal').open);
  await page.waitForFunction(() => !document.querySelector('#image').hidden);
  await open(); assert.equal(await page.locator('#share-svg-duration-label').isVisible(), false);
  assert.equal(await page.locator('#share-download').isVisible(), false);
  await page.locator('#close-share-modal').click();
  check('SVG Cancel and changing tokens stop work without publishing stale exports');

  await submit(10); await open(); await page.locator('#share-edge').selectOption('2000'); await generate();
  info = await inspectOutput(); assert.ok(info.size <= 5_000_000); assert.equal(info.width / info.height, 2);
  check('automatic still-image limit is checked against the actual encoded JPEG');
  await page.locator('#close-share-modal').click();
  for (const id of [4, 5, 9]) {
    await submit(id); await open(); await page.locator('#share-generate').click();
    await page.waitForFunction(() => document.querySelector('#share-status').dataset.warning === 'true');
    assert.equal(await page.locator('#share-download').isVisible(), false);
    assert.equal(await page.locator('#share-generate').isEnabled(), true);
    await page.locator('#close-share-modal').click();
  }
  check('oversized dimensions, malformed media and excessive source bytes warn without exporting');
  await submit(6); await open();
  const originalEvent = page.waitForEvent('download');
  await page.locator('#download-media').click();
  const originalFile = await originalEvent;
  assert.equal(originalFile.suggestedFilename(), `${contract}--6--media.jpg`);
  assert.deepEqual(await readFile(await originalFile.path()), fixtures['wide.jpg']);
  assert.equal(await page.locator('#share-download').isVisible(), false);
  await page.locator('#close-share-modal').click();
  check('original download with large declared size preserves exact bytes and filename without conversion');
  await submit(7); await open(); await page.locator('#fetch-original-media').click();
  await page.waitForFunction(() => document.querySelector('#fetch-original-media').textContent.includes('Allow and download'));
  await page.evaluate(() => { chrome.permissions.request = async () => false; });
  await page.locator('#fetch-original-media').click();
  await page.waitForFunction(() => document.querySelector('#original-status').textContent.includes('not granted'));
  assert.equal(await page.locator('#download-media').isVisible(), false);
  await page.locator('#close-share-modal').click();
  check('original download requests host access and handles denial independently of conversion');
  slowAttempts = 0; await submit(8); await open(); await page.locator('#fetch-original-media').click();
  await page.evaluate(() => { document.querySelector('#token').value = '11'; document.querySelector('#lookup-form').requestSubmit(); });
  await page.waitForFunction(() => !document.querySelector('#share-modal').open && !document.querySelector('#image').hidden);
  await page.waitForTimeout(800);
  await open();
  assert.equal(await page.locator('#download-media').getAttribute('download'), `${contract}--11--media.gif`);
  await page.locator('#close-share-modal').click();
  check('new token cancels pending original download and prevents a stale original link');
  await submit(6); assert.equal(await page.locator('#status').textContent(), '');
  await open(); await generate(); assert.ok((await inspectOutput()).width <= 2000);
  check('sharing reuses an original with a large declared Content-Length');
  await page.locator('#close-share-modal').click();
  await submit(7); await open(); await page.locator('#share-generate').click();
  await page.waitForFunction(() => document.querySelector('#share-generate').textContent === 'Allow and convert');
  await page.evaluate(() => { chrome.permissions.request = async () => false; });
  await page.locator('#share-generate').click();
  await page.waitForFunction(() => document.querySelector('#share-status').textContent.includes('not granted'));
  assert.equal(await page.locator('#share-download').isVisible(), false);
  check('sharing requests missing host permission explicitly and handles denial');
  await page.locator('#close-share-modal').click();
  slowAttempts = 0; await submit(8); await open(); await page.locator('#share-generate').click(); await page.locator('#share-cancel').click();
  await page.waitForTimeout(800); assert.equal(await page.locator('#share-download').isVisible(), false);
  assert.match(await page.locator('#share-status').textContent(), /Cancelled/);
  check('Cancel aborts an in-flight original fetch and cannot reveal a late result');
  await page.locator('#share-generate').click();
  await page.evaluate(() => { document.querySelector('#token').value = '1'; document.querySelector('#lookup-form').requestSubmit(); });
  await page.waitForFunction(() => !document.querySelector('#share-modal').open);
  await page.waitForFunction(() => !document.querySelector('#image').hidden);
  await page.waitForTimeout(800); assert.equal(await page.locator('#share-download').isVisible(), false);
  await open(); await generate(); assert.equal(await page.locator('#share-download').getAttribute('download'), `${contract}--1--sharing-fixture-1--web.jpg`);
  check('new token lookup cancels conversion, clears old media, and keeps the correct output identity');
  await page.locator('#close-share-modal').click();
  await submit(27); await open(); await page.locator('#share-fps').selectOption('0'); await page.locator('#share-edge').selectOption('2000');
  for (const format of ['gif', 'webp']) {
    await page.locator('#share-format').selectOption(format); await generate();
    const result = await page.evaluate(async url => {
      const src = await (await fetch(url)).arrayBuffer();
      const out = await (await fetch(document.querySelector('#share-download').href)).blob();
      const original = new ImageDecoder({ data: src, type: 'image/gif' });
      const decoder = new ImageDecoder({ data: await out.arrayBuffer(), type: out.type });
      await original.completed; await decoder.completed; await decoder.tracks.ready;
      let time = 0, maximumError = 0;
      const pixels = image => { const c = new OffscreenCanvas(64, 32); const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); image.close(); return ctx.getImageData(0,0,64,32).data; };
      for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
        const frame = (await decoder.decode({ frameIndex: i })).image; const delay = frame.duration / 1000;
        const expected = pixels((await original.decode({frameIndex: Math.floor(time/100)})).image);
        const actual = pixels(frame); let error = 0;
        for (let p = 0; p < actual.length; p++) error += Math.abs(expected[p]-actual[p]);
        maximumError = Math.max(maximumError, error / actual.length); time += delay;
      }
      original.close(); decoder.close(); return {time, maximumError};
    }, `${base}/delta.gif`);
    assert.equal(result.time, 1000); assert.ok(result.maximumError < (format === 'gif' ? 0.01 : 2), JSON.stringify(result));
    check(`${format} delta rectangles preserve moving pixels, erasure, repeated frames and the full timeline`);
  }
  await page.locator('#share-format').selectOption('gif'); await page.locator('#share-fps').selectOption('20'); await page.locator('#close-share-modal').click();
  // Stress the existing bounded encoder with a small limit without reintroducing
  // a target selector in the product UI. Inspection probes pass through unchanged.
  await page.evaluate(() => {
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      postMessage(message, ...args) {
        if (message.options) message = { ...message, options: { ...message.options, target: 'custom', maxMB: 0.1 } };
        super.postMessage(message, ...args);
      }
    };
  });
  await submit(11); await open();
  await page.locator('#share-edge').selectOption('2000');
  await page.locator('#share-generate').click();
  await page.waitForFunction(() => document.querySelector('#share-status').textContent.includes('Encoding GIF'));
  await page.locator('#share-cancel').click();
  await page.waitForTimeout(300);
  assert.match(await page.locator('#share-status').textContent(), /Cancelled/);
  assert.equal(await page.locator('#share-download').isVisible(), false);
  check('Cancel terminates a real GIF encoding worker without publishing a partial file');
  await page.locator('#share-generate').click();
  await page.waitForFunction(() => document.querySelector('#share-status').dataset.warning === 'true', null, { timeout: 125000 });
  assert.match(await page.locator('#share-status').textContent(), /Could not fit the complete media/);
  assert.equal(await page.locator('#share-download').isVisible(), false);
  check('an animation that still exceeds the byte limit after bounded attempts warns without truncation');
  await page.locator('#share-edge').selectOption('custom'); await page.locator('#share-custom-edge').fill('32'); await generate();
  info = await inspectOutput(); assert.equal(info.count, 60); assert.equal(info.duration, 3000);
  assert.equal(info.width, 32); assert.equal(info.height, 16); assert.ok(info.size <= 100000);
  check('manually choosing smaller dimensions can fit a previously oversized animation');
  await page.locator('#share-format').selectOption('webp'); await page.locator('#share-edge').selectOption('2000');
  await page.locator('#share-generate').click();
  await page.waitForFunction(() => document.querySelector('#share-status').textContent.includes('Encoding WEBP'));
  await page.locator('#share-cancel').click(); await page.waitForTimeout(300);
  assert.equal(await page.locator('#share-download').isVisible(), false);
  assert.match(await page.locator('#share-status').textContent(), /Cancelled/);
  check('Cancel stops native WebP frame encoding without publishing a partial file');
  await page.locator('#share-generate').click();
  await page.waitForFunction(() => !document.querySelector('#share-download').hidden || document.querySelector('#share-status').dataset.warning === 'true');
  if (await page.locator('#share-download').isVisible()) {
    info = await inspectOutput(); assert.equal(info.count, 60); assert.equal(info.duration, 3000); assert.ok(info.size <= 100000);
  } else assert.match(await page.locator('#share-status').textContent(), /Could not fit the complete media/);
  await page.locator('#share-edge').selectOption('custom'); await page.locator('#share-custom-edge').fill('32'); await generate();
  info = await inspectOutput(); assert.equal(info.type, 'image/webp'); assert.equal(info.count, 60); assert.equal(info.duration, 3000);
  assert.equal(info.width, 32); assert.equal(info.height, 16); assert.ok(info.size <= 100000);
  check('GIF source exports complete WebP animation within the test byte limit after reducing dimensions');

  await page.locator('#close-share-modal').click();
  await open();
  await page.clock.install();
  await page.evaluate(() => {
    window.savedWorker = window.Worker;
    window.Worker = class { postMessage() {} terminate() {} };
  });
  await page.locator('#share-generate').click();
  await page.clock.fastForward(120001);
  assert.match(await page.locator('#share-status').textContent(), /exceeded two minutes/);
  assert.equal(await page.locator('#share-download').isVisible(), false);
  await page.evaluate(() => { window.Worker = window.savedWorker; });
  check('stalled conversion times out with a warning and no download (worker stall simulated)');
  await page.locator('#close-share-modal').click();
  assert.deepEqual(errors, []);
  assert.deepEqual(cspErrors, [], 'SVG parsing must not execute inline styles or violate the extension CSP');
  console.log(`\n${count} sharing browser checks passed.`);
  })();
} finally { largeServer.closeAllConnections(); largeServer.close(); await context.close().catch(() => {}); await rm(profile, { recursive: true, force: true }); }
