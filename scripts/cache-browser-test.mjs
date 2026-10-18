import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/cache-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium',
  headless: true, acceptDownloads: true, viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
});
const contract = '0x0000000000000000000000000000000000000001';
const cid = 'QmYwAPJzv5CZsnAzt8auVTLnEKjHhhtvE4s1wKpR1X4M8F';
let revision = 1, offline = false, rpc = 0, metadata = 0, images = 0, checks = 0;
const errors = [];
const check = name => { checks++; console.log(`PASS ${name}`); };
const counts = () => [rpc, metadata, images];
const svg = rev => `<svg xmlns="http://www.w3.org/2000/svg" width="${100 + rev}" height="100"><rect width="100%" height="100%" fill="${rev === 1 ? 'green' : 'purple'}"/></svg>`;
// Inspect/mutate only this test profile's IndexedDB, never a user's profile.
async function records(page, operation = 'read', token) {
  return page.evaluate(({ operation, token }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('tokint-recents', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('tokens', operation === 'read' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('tokens');
      let rows;
      const request = store.getAll();
      request.onsuccess = () => {
        rows = request.result;
        for (const row of rows) {
          if (operation === 'expire' && row.token === token) { row.snapshot.fetchedAt -= 25 * 60 * 60 * 1000; store.put(row); }
        }
      };
      tx.oncomplete = () => { db.close(); resolve(rows.map(r => ({ ...r, snapshot: r.snapshot && { ...r.snapshot, image: r.snapshot.image && { url: r.snapshot.image.url, size: r.snapshot.image.blob.size } } }))); };
      tx.onerror = () => reject(tx.error);
    };
  }), { operation, token });
}
async function saved(page, token) {
  for (let i = 0; i < 100; i++) {
    if ((await records(page)).some(r => r.token === String(token) && r.snapshot?.image)) return;
    await page.waitForTimeout(30);
  }
  throw new Error(`Cache did not save token ${token}`);
}
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const root = `chrome-extension://${new URL(worker.url()).host}`;
  await context.route('https://ethereum-rpc.publicnode.com/**', async route => {
    rpc++; if (offline) return route.fulfill({ status: 503, body: 'Offline fixture' });
    const req = route.request().postDataJSON();
    let result = '0x1';
    if (req.method !== 'eth_chainId') {
      const data = req.params[0].data;
      const id = BigInt(`0x${data.slice(-64)}`).toString();
      result = data.startsWith('0x01ffc9a7')
        ? encodeAbiParameters([{ type: 'bool' }], [data.includes('5b5e139f')])
        : encodeAbiParameters([{ type: 'string' }], [`ipfs://${cid}/${id}.json`]);
    }
    return route.fulfill({ json: { jsonrpc: '2.0', id: req.id, result } });
  });
  await context.route('https://gateway.pinata.cloud/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('.svg')) { images++; return route.fulfill({ contentType: 'image/svg+xml', body: svg(revision) }); }
    metadata++; if (offline) return route.fulfill({ status: 503 });
    const token = url.pathname.split('/').at(-1).replace('.json', '');
    const rev = revision;
    if (token === '100' || token === '200' || (token === '300' && rev === 3)) await new Promise(resolve => setTimeout(resolve, 500));
    try { await route.fulfill({ json: { name: `Fixture ${token} v${rev}`, image: './art.svg', description: 'Cache test artwork' } }); } catch { /* cancelled request */ }
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${root}/results.html`);
  const submit = async (token, method = 'auto', target = page) => {
    await target.locator('#contract').fill(contract); await target.locator('#token').fill(String(token));
    await target.locator('#method').selectOption(method);
    await target.locator('#lookup-form').evaluate(form => form.requestSubmit());
  };
  const loaded = (target = page) => target.waitForFunction(() => !document.querySelector('#image').hidden && document.querySelector('#image').naturalWidth > 0);
  await submit(1); await loaded(); await saved(page, 1);
  assert.equal(await page.locator('#cache-status').textContent(), '');
  assert.equal(await page.locator('#recent-tokens option').count(), 2);
  check('successful lookups save metadata, source bytes, and a recent shortcut');
  const original = counts(); offline = true;
  await page.reload(); await loaded();
  assert.deepEqual(counts(), original);
  assert.match(await page.locator('#cache-status').textContent(), /^Cached/);
  await page.locator('#share-media').click();
  const downloading = page.waitForEvent('download'); await page.locator('#download-media').click();
  const download = await downloading;
  assert.equal(await readFile(await download.path(), 'utf8'), svg(1));
  assert.equal(download.suggestedFilename(), `${contract}--1--media.svg`);
  await page.locator('#close-share-modal').click();
  check('offline reload uses no network and original download retains exact cached bytes/identity');
  offline = false; revision = 2;
  await page.locator('#refresh').click(); await loaded(); await saved(page, 1);
  assert.equal(await page.locator('#name').textContent(), 'Fixture 1 v2');
  assert.equal(await page.locator('#image').evaluate(img => img.naturalWidth), 102);
  assert.equal(await page.locator('#cache-status').textContent(), '');
  assert.ok(counts().every((n, i) => n > original[i]));
  check('Refresh bypasses contract, metadata and media caches even when source URLs are unchanged');
  offline = true;
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('503'));
  assert.equal(await page.locator('#cache-status').textContent(), '');
  assert.notEqual(await page.locator('#name').textContent(), 'Fixture 1 v2');
  await page.locator('#recent-tokens').selectOption(`${contract}:1:auto`); await loaded();
  assert.equal(await page.locator('#name').textContent(), 'Fixture 1 v2');
  assert.match(await page.locator('#cache-status').textContent(), /^Cached/);
  check('failed Refresh reports its error; the previous snapshot remains explicitly available through Recents');
  offline = false;
  const beforeMethod = rpc;
  await submit(1, 'uri'); await loaded();
  assert.ok(rpc > beforeMethod); assert.equal(await page.locator('#cache-status').textContent(), '');
  assert.equal(await page.locator('#recent-tokens option').count(), 2);
  check('manual metadata methods are isolated and recents deduplicate the token');
  await records(page, 'expire', '1');
  const beforeExpiry = rpc; await submit(1, 'uri'); await loaded();
  assert.ok(rpc > beforeExpiry);
  check('expired snapshots trigger a fresh lookup');
  await worker.evaluate(() => chrome.storage.local.set({ settingsVersion: 2, settings: { rpcUrl: 'https://ethereum-rpc.publicnode.com/?fixture=new', gatewayUrl: 'https://gateway.pinata.cloud', gatewayStyle: 'path' } }));
  const beforeSettings = rpc; await submit(1, 'uri'); await loaded();
  assert.ok(rpc > beforeSettings);
  check('changing provider configuration invalidates cache reuse');
  const huge = (2n ** 256n - 1n).toString();
  await submit(huge); await loaded(); await saved(page, huge);
  await submit(2); await loaded(); await saved(page, 2);
  const beforeRecent = counts(); await page.locator('#recent-tokens').selectOption(`${contract}:${huge}:auto`); await loaded();
  assert.equal(await page.locator('#token').inputValue(), huge); assert.deepEqual(counts(), beforeRecent);
  assert.ok((await page.locator('#recent-tokens option').nth(1).getAttribute('value')).includes(huge));
  check('recent selection restores exact large IDs and promotes revisited tokens');
  await submit(100);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Fetching metadata'));
  await page.locator('#recent-tokens').selectOption(`${contract}:2:auto`); await loaded();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#name').textContent(), 'Fixture 2 v2');
  assert.equal((await records(page)).some(r => r.token === '100'), false);
  check('switching to a cached token cancels an older in-flight response');
  await page.screenshot({ path: 'test-results/recents-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#theme-toggle').click();
  await page.screenshot({ path: 'test-results/recents-narrow-light.png', fullPage: true });
  check('recent controls fit narrow and light layouts');
  const other = await context.newPage(); other.on('pageerror', e => errors.push(e.message));
  await other.goto(`${root}/results.html`);
  await submit(3, 'auto', other); await loaded(other); await saved(other, 3);
  await page.waitForFunction(() => Array.from(document.querySelector('#recent-tokens').options).some(o => o.value.endsWith(':3:auto')));
  await submit(200, 'auto', other);
  await other.waitForFunction(() => document.querySelector('#status').textContent.includes('Fetching metadata'));
  await page.locator('#clear-recents').click();
  await page.waitForFunction(() => document.querySelector('#recent-tokens').hidden);
  await loaded(other); await other.waitForTimeout(100);
  assert.deepEqual(await records(page), []);
  assert.equal(await other.locator('#recent-tokens').isVisible(), false);
  check('tabs share recents; clear removes data and blocks pending requests from repopulating it');
  await submit(4); await loaded(); await saved(page, 4);
  check('new lookups save normally after clearing');
  const unavailable = await context.newPage(); unavailable.on('pageerror', e => errors.push(e.message));
  await unavailable.addInitScript(() => { indexedDB.open = () => { throw new Error('Storage disabled fixture'); }; });
  await unavailable.goto(`${root}/results.html`); await submit(5, 'auto', unavailable); await loaded(unavailable);
  assert.equal(await unavailable.locator('#name').textContent(), 'Fixture 5 v2');
  assert.equal(await unavailable.locator('#recent-tokens').isVisible(), false);
  check('unavailable storage falls back to normal network lookups');
  revision = 3;
  await submit(300, 'auto', other);
  await other.waitForFunction(() => document.querySelector('#status').textContent.includes('Fetching metadata'));
  revision = 4;
  await submit(300); await loaded(); await saved(page, 300);
  await loaded(other); await other.waitForTimeout(100);
  assert.equal((await records(page)).find(r => r.token === '300').snapshot.metadata.data.name, 'Fixture 300 v4');
  check('an older lookup in another tab cannot overwrite a newer snapshot');
  const beforeQuota = await records(page);
  const quota = await context.newPage(); quota.on('pageerror', e => errors.push(e.message));
  await quota.addInitScript(() => {
    IDBObjectStore.prototype.put = function() { throw new DOMException('Quota fixture', 'QuotaExceededError'); };
  });
  await quota.goto(`${root}/results.html`); await submit(6, 'auto', quota); await loaded(quota);
  await quota.waitForTimeout(100);
  assert.equal(await quota.locator('#name').textContent(), 'Fixture 6 v4');
  assert.deepEqual(await records(page), beforeQuota);
  check('cache write quota failure leaves the lookup usable and preserves earlier entries atomically');
  assert.deepEqual(errors, []);
  console.log(`${checks} cache/browser checks passed.`);
} finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
