import { prepareVault } from './vault-browser-helpers.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const isArtblocks = url => new URL(url).hostname.endsWith('.artblocks.io') || new URL(url).hostname === 'artblocks-mainnet.s3.amazonaws.com';
await mkdir('test-results', { recursive: true });
const root = await mkdtemp(path.resolve('test-results/artblocks-'));
let context;
try {
  const extension = path.join(root, 'extension');
  await cp('extension', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  for (const granted of [false, true]) {
    if (granted) {
      // Disposable-profile grants only. Production hosts remain optional.
      manifest.host_permissions.push('https://token.artblocks.io/*', 'https://artblocks-mainnet.s3.amazonaws.com/*');
      await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
    }
    context = await chromium.launchPersistentContext(path.join(root, `profile-${granted}`), {
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await prepareVault(context, worker);
    const requests = [];
    context.on('request', request => requests.push(request.url()));
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
      await context.route(direct, route => route.fulfill({ json: { name: 'Chromie Squiggle #5603', image: media } }));
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
    } else {
      await page.waitForFunction(() => !document.querySelector('#image').hidden || document.querySelector('#status-row').dataset.state === 'error', null, { timeout: 60_000 });
      assert.equal(await page.locator('#status').textContent(), '');
      assert.equal(await page.locator('#name').textContent(), 'Chromie Squiggle #5603');
      assert.ok(await page.locator('#image').evaluate(img => img.naturalWidth > 0));
      assert.equal(await page.locator('#image-link').getAttribute('href'), media);
      assert.deepEqual(requests.filter(isArtblocks), [direct, directMedia]);
      if (live) await page.screenshot({ path: 'test-results/artblocks-5603-live.png', fullPage: true });
      console.log(`PASS ${live ? 'live' : 'fixture'} Chromie Squiggle #5603 metadata and preview use direct URLs`);
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
