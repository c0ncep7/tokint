import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';

const live = process.argv.includes('--live');
const contract = '0x059edd72cd353df5106d2b9cc5ab83a52287ac3a';
const legacy = 'https://api.artblocks.io/token/5603';
const short = 'https://token.artblocks.io/5603';
const direct = `https://token.artblocks.io/1/${contract}/5603`;
const media = `https://media-proxy.artblocks.io/1/${contract}/5603.png`;
const mediaApi = `https://core-api.artblocks.io/media/1/${contract}/5603.png`;
const directMedia = 'https://artblocks-mainnet.s3.amazonaws.com/5603.png';
const animation = `https://generator.artblocks.io/1/${contract}/5603`;
const dependency = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.0.0/p5.min.js';
const html = '<!doctype html><script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.0.0/p5.min.js"></script><script>let playing=false,index=0;function setup(){createCanvas(windowWidth,windowHeight);noStroke()}function draw(){background(255);fill(index%20<10?"red":"blue");rect(10,10,300,140);if(playing)index++}function mouseClicked(){playing=!playing}</script>';
const isArtblocks = url => new URL(url).hostname.endsWith('.artblocks.io') || new URL(url).hostname === 'artblocks-mainnet.s3.amazonaws.com';
await mkdir('test-results', { recursive: true });
const root = await mkdtemp(path.resolve('test-results/artblocks-'));
let context;
try {
  const extension = path.join(root, 'extension');
  await cp('extension', extension, { recursive: true });
  await assert.rejects(access(path.join(extension, 'p5-1.0.0.min.js')));
  const productionManifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  for (const granted of [false, 'artwork-only', true]) {
    const manifest = structuredClone(productionManifest);
    if (granted) {
      // Disposable-profile grants only. Production hosts remain optional.
      manifest.host_permissions.push('https://token.artblocks.io/*', 'https://generator.artblocks.io/*', 'https://artblocks-mainnet.s3.amazonaws.com/*');
    }
    if (granted === true) manifest.host_permissions.push('https://cdnjs.cloudflare.com/*');
    await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(path.join(root, `profile-${granted}`), {
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true, acceptDownloads: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

    const requests = [];
    context.on('request', request => requests.push(request.url()));
    let cdnRequests = 0;
    await context.route('https://cdnjs.cloudflare.com/**', route => {
      cdnRequests++;
      assert.equal(route.request().url(), dependency);
      assert.equal(new URL(route.request().frame().url()).pathname, '/results.html');
      assert.equal(route.request().resourceType(), 'fetch');
      return live ? route.continue() : route.fulfill({ contentType: 'application/javascript', path: 'node_modules/p5/lib/p5.min.js' });
    });
    if (!live) {
      await context.route('https://ethereum-rpc.publicnode.com/**', route => {
        const call = route.request().postDataJSON();
        const result = call.method === 'eth_chainId' ? '0x1' : call.params[0].data.startsWith('0x01ffc9a7')
          ? encodeAbiParameters([{ type: 'bool' }], [true])
          : encodeAbiParameters([{ type: 'string' }], [legacy]);
        return route.fulfill({ json: { jsonrpc: '2.0', id: call.id, result } });
      });
      await context.route(legacy, route => route.fulfill({ status: 302, headers: { Location: short } }));
      await context.route(short, route => route.fulfill({ status: 301, headers: { Location: direct } }));
      await context.route(direct, route => route.fulfill({ json: { name: 'Chromie Squiggle #5603', image: media, animation_url: animation } }));
      await context.route(animation, route => route.fulfill({ contentType: 'text/html', body: html }));
      await context.route(media, route => route.fulfill({ status: 301, headers: { Location: mediaApi } }));
      await context.route(mediaApi, route => route.fulfill({ status: 302, headers: { Location: directMedia } }));
      await context.route(directMedia, route => route.fulfill({ contentType: 'image/jpeg', path: 'tests/fixtures/wide.jpg' }));
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/results.html`);
    await page.waitForFunction(() => document.querySelector('.shell')?.inert === false);
    await page.locator('#contract').fill(contract);
    await page.locator('#token').fill('5603');
    await page.locator('#token').press('Enter');
    if (!granted) {
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Allow access to https://token.artblocks.io'));
      assert.equal(await page.locator('#retry').textContent(), 'Allow and retry');
      assert.equal(requests.some(isArtblocks), false);
      console.log('PASS missing Art Blocks access identifies the canonical host before any content request');
    } else if (granted === 'artwork-only') {
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Allow access to https://cdnjs.cloudflare.com'), null, { timeout: 60_000 });
      assert.equal(await page.locator('#retry').textContent(), 'Allow and retry');
      assert.equal(cdnRequests, 0);
      assert.equal(await page.locator('#html-stage iframe').count(), 0);
      console.log('PASS missing dependency access is actionable and makes no CDN request');
    } else {
      await page.waitForFunction(() => document.querySelector('#media-type').textContent === 'HTML' || document.querySelector('#status-row').dataset.state === 'error', null, { timeout: 60_000 });
      assert.equal(await page.locator('#status').textContent(), '');
      assert.equal(await page.locator('#name').textContent(), 'Chromie Squiggle #5603');
      assert.equal(await page.locator('#media-source').inputValue(), 'animation_url');
      assert.equal(await page.locator('#image-link').getAttribute('href'), animation);
      const frame = await (await page.locator('#html-stage iframe').elementHandle()).contentFrame();
      const canvas = frame.locator('canvas');
      await canvas.waitFor();
      await frame.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 64) if (pixels[i + 3] && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 200) return true;
        return false;
      });
      const before = await canvas.evaluate(canvas => canvas.toDataURL());
      await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await canvas.evaluate(canvas => canvas.toDataURL()), before, 'Artwork starts paused');
      await canvas.click();
      await frame.waitForFunction(before => document.querySelector('canvas').toDataURL() !== before, before);
      assert.equal(await frame.evaluate(() => typeof chrome === 'undefined' || !chrome.runtime), true);
      assert.equal(await page.evaluate(() => typeof window.p5), 'undefined');
      assert.equal(await page.locator('#html-stage iframe').getAttribute('sandbox'), 'allow-scripts');
      assert.equal(requests.some(url => url.endsWith('/p5-1.0.0.min.js')), false);
      assert.equal(cdnRequests, 1);
      assert.deepEqual(requests.filter(isArtblocks), [direct, animation]);
      if (live) await page.screenshot({ path: 'test-results/artblocks-5603-animation-live.png', fullPage: true });
      await page.locator('#share-media').click();
      await page.waitForFunction(() => !document.querySelector('#download-media').hidden);
      const download = page.waitForEvent('download');
      await page.locator('#download-media').click();
      const original = await readFile(await (await download).path());
      if (!live) assert.equal(original.toString(), html);
      else assert.ok(original.toString().includes('let loops = false;'));
      await page.locator('#share-format').selectOption('gif');
      await page.locator('#share-edge').selectOption('custom');
      await page.locator('#share-custom-edge').fill('96');
      await page.locator('#share-svg-duration').fill('0.5');
      await page.locator('#share-fps').selectOption('10');
      assert.equal(await page.locator('#share-html-click').isChecked(), false);
      for (const click of [false, true]) {
        await page.locator('#share-html-click').setChecked(click);
        await page.locator('#share-generate').click();
        await page.waitForFunction(() => !document.querySelector('#share-download').hidden || document.querySelector('#share-status').dataset.warning === 'true', null, { timeout: 60_000 });
        assert.equal(await page.locator('#share-download').isVisible(), true, await page.locator('#share-status').textContent());
        const hashes = await page.evaluate(async () => {
          const blob = await (await fetch(document.querySelector('#share-download').href)).blob();
          const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
          await decoder.tracks.ready; await decoder.completed;
          const hashes = [];
          for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].join(','));
            image.close();
          }
          decoder.close();
          return hashes;
        });
        assert.equal(new Set(hashes).size > 1, click, 'Export must animate only with the click option enabled');
        if (live && click) {
          const gif = page.waitForEvent('download');
          await page.locator('#share-download').click();
          await (await gif).saveAs('test-results/artblocks-5603-animation.gif');
          await page.screenshot({ path: 'test-results/artblocks-5603-export-live.png', fullPage: true });
        }
      }
      await page.locator('#close-share-modal').click();
      assert.equal(cdnRequests, 1, 'Exports reuse the verified dependency cache');
      await context.setOffline(true);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.shell')?.inert === false);
      await page.locator('#contract').fill(contract); await page.locator('#token').fill('5603');
      await page.locator('#token').press('Enter');
      await page.waitForFunction(() => document.querySelector('#media-type').textContent === 'HTML');
      assert.equal(cdnRequests, 1, 'Reload reuses persistent library and artwork caches offline');
      await context.setOffline(false);
      await page.locator('#fullscreen-media').click();
      await page.frameLocator('#fullscreen-stage iframe').locator('canvas').waitFor();
      await page.locator('#close-media-modal').click();
      await page.locator('#media-source').selectOption('image');
      await page.waitForFunction(() => !document.querySelector('#image').hidden);
      assert.ok(await page.locator('#image').evaluate(img => img.naturalWidth > 0));
      assert.equal(await page.locator('#image-link').getAttribute('href'), media);
      assert.deepEqual(requests.filter(isArtblocks), [direct, animation, directMedia]);
      if (live) await page.screenshot({ path: 'test-results/artblocks-5603-live.png', fullPage: true });
      console.log(`PASS ${live ? 'live' : 'fixture'} Chromie Squiggle #5603 uses on-demand p5, verified offline reuse, click-to-start GIF export, fullscreen and image selection`);
    }
    assert.equal(await page.locator('#raw-uri').inputValue(), legacy);
    assert.equal(await page.locator('#resolved-uri').inputValue(), direct);
    assert.equal(await page.locator('#metadata-link').getAttribute('href'), direct);
    assert.deepEqual(errors, []);
    await context.close(); context = undefined;
  }
} finally {
  await context?.close();
  await rm(root, { recursive: true, force: true });
}
