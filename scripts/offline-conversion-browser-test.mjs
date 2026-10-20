import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';
import gifenc from 'gifenc';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/offline-profile-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

  const origin = new URL(sw.url()).origin;
  // Node's URL origin is "null" for chrome-extension URLs.
  const extension = origin === 'null' ? `chrome-extension://${new URL(sw.url()).host}` : origin;
  const busy = gifenc.GIFEncoder();
  const palette = Array.from({ length: 256 }, (_, i) => [i, i * 73 % 256, i * 131 % 256]);
  let seed = 74231;
  for (let frame = 0; frame < 20; frame++) {
    const pixels = new Uint8Array(160 * 80);
    for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
    busy.writeFrame(pixels, 160, 80, { palette, delay: 50, repeat: 0 });
  }
  busy.finish();
  const fixtures = [
    { type: 'image/jpeg', bytes: await readFile('tests/fixtures/wide.jpg'), format: 'jpg', animated: false },
    { type: 'image/webp', bytes: await readFile('tests/fixtures/moving.webp'), format: 'webp', animated: true },
    { type: 'image/gif', bytes: Buffer.from(busy.bytes()), format: 'gif', animated: true },
  ];
  let fixture = fixtures[0], offline = false;
  const externalRequests = [], errors = [];
  context.on('request', request => {
    if (offline && /^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  await context.route(/^https?:\/\//, async route => {
    if (offline || !route.request().url().startsWith('https://ethereum-rpc.publicnode.com/')) return route.abort();
    const request = route.request().postDataJSON();
    const metadata = { name: 'Offline fixture', image: `data:${fixture.type};base64,${fixture.bytes.toString('base64')}` };
    const result = request.method === 'eth_chainId' ? '0x1' : request.params[0].data.startsWith('0x01ffc9a7')
      ? encodeAbiParameters([{ type: 'bool' }], [true])
      : encodeAbiParameters([{ type: 'string' }], [`data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`]);
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } });
  });
  async function openFixture(id, mode = 'normal') {
    offline = false; await context.setOffline(false);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      window.conversionEvents = [];
      const RealWorker = window.Worker;
      window.Worker = class extends RealWorker {
        constructor(url, options) {
          if (mode === 'no-worker' && String(url).includes('conversion-capabilities-worker')) throw new Error('Simulated unavailable worker');
          super(url, options);
          this.addEventListener('message', event => {
            if (String(url).includes('conversion-capabilities-worker') && mode !== 'normal') {
              const data = { ...event.data };
              if (mode === 'no-webp') data.webp = false;
              if (mode === 'no-canvas') data.canvas = false;
              if (mode === 'no-decoder') data.decoders = {};
              if (mode === 'no-jpeg') data.jpeg = false;
              if (mode === 'no-wasm') data.wasm = false;
              event.stopImmediatePropagation();
              this.onmessage?.call(this, new MessageEvent('message', { data }));
              return;
            }
            if (event.data.kind === 'progress') window.conversionEvents.push(event.data.text);
          });
        }
        postMessage(message, ...args) {
          // Exercise the real optimizer using a bounded local fixture.
          if (message?.options?.format === 'gif') message = { ...message, options: { ...message.options, target: 'custom', maxMB: 0.1 } };
          super.postMessage(message, ...args);
        }
      };
    }, mode);
    await page.goto(`${extension}/results.html`);
    await page.waitForFunction(() => document.querySelector('.shell')?.inert === false);
    await page.locator('#contract').fill('0x0000000000000000000000000000000000000001');
    await page.locator('#token').fill(String(id)); await page.locator('#token').press('Enter');
    await page.waitForFunction(() => !document.querySelector('#image').hidden && !document.querySelector('#download-media').hidden);
    offline = true; await context.setOffline(true);
    await page.locator('#share-media').click();
    await page.waitForFunction(() => !document.querySelector('#share-capabilities').textContent.includes('Checking'));
    return page;
  }
  async function output(page) {
    return page.evaluate(async () => {
      const blob = await (await fetch(document.querySelector('#share-download').href)).blob();
      const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
      await decoder.tracks.ready; await decoder.completed;
      const frames = decoder.tracks.selectedTrack.frameCount;
      let duration = 0;
      for (let index = 0; index < frames; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        duration += (image.duration || 0) / 1000; image.close();
      }
      decoder.close();
      return { type: blob.type, frames, duration, bytes: blob.size, events: window.conversionEvents };
    });
  }
  for (const [index, item] of fixtures.entries()) {
    fixture = item;
    const page = await openFixture(index + 1);
    if (item.animated) {
      await page.locator('#share-format').waitFor({ state: 'visible' });
      await page.locator('#share-format').selectOption(item.format);
      await page.locator('#share-fps').selectOption('0');
    }
    await page.locator('#share-generate').click();
    await page.waitForFunction(() => !document.querySelector('#share-download').hidden || document.querySelector('#share-status').dataset.warning === 'true', null, { timeout: 120_000 });
    assert.equal(await page.locator('#share-download').isVisible(), true, await page.locator('#share-status').textContent());
    const result = await output(page);
    assert.equal(result.type, item.type); assert.equal(result.frames > 1, item.animated); assert.ok(result.bytes > 0);
    if (item.format === 'gif') {
      assert.ok(result.events.some(text => text.startsWith('Optimizing GIF')), 'Bundled WASM optimizer must run');
      assert.equal(result.frames, 20); assert.equal(result.duration, 1000); assert.ok(result.bytes <= 100000);
    }
    assert.deepEqual(externalRequests, []);
    console.log(`PASS ${item.format} conversion and output decoding offline${item.format === 'gif' ? ', including bundled WASM optimization' : ''}`);
    await page.close();
  }
  for (const [index, mode] of ['no-webp', 'no-wasm', 'no-canvas', 'no-decoder', 'no-jpeg', 'no-worker'].entries()) {
    fixture = mode === 'no-jpeg' ? fixtures[0] : fixtures[1];
    const page = await openFixture(10 + index, mode);
    const fallback = mode === 'no-webp' || mode === 'no-wasm';
    if (fallback) {
      await page.locator('#share-format').waitFor({ state: 'visible' });
      assert.equal(await page.locator(`#share-format option[value="${mode === 'no-webp' ? 'webp' : 'gif'}"]`).evaluate(option => option.disabled), true);
      assert.equal(await page.locator('#share-format').inputValue(), mode === 'no-webp' ? 'gif' : 'webp');
      assert.equal(await page.locator('#share-generate').isEnabled(), true);
    } else {
      await page.waitForFunction(() => document.querySelector('#share-generate').disabled && document.querySelector('#share-capabilities').textContent.includes('Original download'));
    }
    assert.equal(await page.locator('#download-media').isVisible(), true);
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('#download-media').href)).arrayBuffer())));
    assert.deepEqual(Buffer.from(bytes), fixture.bytes);
    // Changes and reopen must not accidentally re-enable unavailable conversion.
    await page.locator('#share-edge').selectOption('1000');
    await page.locator('#close-share-modal').click(); await page.locator('#share-media').click();
    assert.equal(await page.locator('#share-generate').isDisabled(), !fallback);
    console.log(`PASS ${mode}: unavailable export disabled and original bytes preserved`);
    await page.close();
  }
  assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
} finally {
  await context?.close(); await rm(profile, { recursive: true, force: true });
}
