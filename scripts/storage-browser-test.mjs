import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/storage-profile-'));
const launch = () => chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true,
  viewport: { width: 1100, height: 1000 },
  args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
});
let context, root, checks = 0;
const errors = [];
const pass = text => { checks++; console.log(`PASS ${text}`); };
async function start() {
  context = await launch();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  root = `chrome-extension://${new URL(worker.url()).host}`;
}
async function pageAt(file) {
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${root}/${file}`);
  return page;
}
const ready = page => page.waitForFunction(() => !document.querySelector('.shell').inert);
const saved = async page => {
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.startsWith('Saved.'));
};
const read = page => page.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
try {
  await start();
  let page = await pageAt('options.html'); await ready(page);
  assert.equal(await page.locator('input[type=password]').count(), 0);
  assert.equal(await page.locator('#rpc-preset').inputValue(), 'publicnode');
  assert.equal(await page.locator('#rpc-remember-control').isVisible(), false);
  pass('fresh installs open immediately with public defaults and no passphrase setup');
  const endpoint = 'https://eth-mainnet.g.alchemy.com/v2/browser-session-fixture';
  await page.locator('#rpc-preset').selectOption('alchemy');
  await page.locator('#rpc-url').fill(endpoint);
  assert.equal(await page.locator('#remember-rpc').isChecked(), false);
  assert.match(await page.locator('#remember-rpc-help').textContent(), /Warning:.*unencrypted.*browser profile/);
  await saved(page);
  let state = await read(page);
  assert.ok(!JSON.stringify(state.local).includes('browser-session-fixture'));
  assert.equal(state.session.tokintSessionRpc.rpcUrl, endpoint);
  const other = await pageAt('options.html'); await ready(other);
  assert.equal(await other.locator('#rpc-url').inputValue(), endpoint);
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#rpc-url').inputValue(), endpoint);
  await page.locator('#theme-toggle').click();
  await page.waitForFunction(async () => (await chrome.storage.local.get('theme')).theme === 'light');
  pass('Alchemy URLs default to session storage, work across tabs/reloads, and preferences remain ordinary local data');
  await context.close(); await start();
  page = await pageAt('options.html'); await ready(page);
  assert.equal(await page.locator('#rpc-preset').inputValue(), 'alchemy');
  assert.equal(await page.locator('#rpc-url').inputValue(), '');
  assert.match(await page.locator('#settings-status').textContent(), /expired/);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  let requests = 0;
  await context.route('https://**/*', route => { requests++; return route.abort(); });
  const inspector = await pageAt('results.html#contract=0x0000000000000000000000000000000000000001&token=1&run=1');
  await inspector.waitForFunction(() => document.querySelector('#status').textContent.includes('session-only RPC URL has expired'));
  assert.equal(requests, 0);
  pass('browser restart clears session-only URLs and lookups report expiry without contacting a fallback provider');
  await page.locator('#rpc-url').fill(endpoint);
  await page.locator('#remember-rpc').check(); await saved(page);
  await inspector.waitForFunction(() => !document.querySelector('#alchemy-actions').hidden);
  state = await read(page);
  assert.ok(JSON.stringify(state.local).includes('browser-session-fixture'));
  assert.equal(state.session.tokintSessionRpc, undefined);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/storage-remember-settings.png', fullPage: true });
  await context.close(); await start();
  page = await pageAt('options.html'); await ready(page);
  assert.equal(await page.locator('#rpc-url').inputValue(), endpoint);
  assert.equal(await page.locator('#remember-rpc').isChecked(), true);
  await page.locator('#remember-rpc').uncheck(); await saved(page);
  state = await read(page);
  assert.ok(!JSON.stringify(state.local).includes('browser-session-fixture'));
  assert.equal(state.session.tokintSessionRpc.rpcUrl, endpoint);
  const active = await pageAt('results.html'); await ready(active);
  await active.waitForFunction(() => !document.querySelector('#alchemy-actions').hidden);
  await page.evaluate(() => chrome.storage.session.clear());
  await active.waitForFunction(() => document.querySelector('#alchemy-actions').hidden);
  pass('Remember is explicit and survives restart; opting out removes the persisted key and session expiry disables Alchemy across tabs');
  await page.locator('#rpc-url').fill('https://eth-mainnet.g.alchemy.com/v2/new-fixture');
  assert.equal(await page.locator('#remember-rpc').isChecked(), false);
  await page.locator('#rpc-preset').selectOption('publicnode'); await saved(page);
  await active.close();
  await page.evaluate(async () => {
    await chrome.storage.local.clear(); await chrome.storage.session.clear();
    const sealed = { sealed: 1, ciphertext: 'obsolete-encrypted-fixture' };
    await chrome.storage.local.set({ vaultHeader: { version: 1 }, settings: sealed, lastContract: sealed, theme: sealed });
    await chrome.storage.session.set({ tokintVaultSession: { material: 'obsolete-session-fixture' } });
    await new Promise((resolve, reject) => {
      const remove = indexedDB.deleteDatabase('tokint-recents');
      remove.onerror = () => reject(remove.error); remove.onsuccess = resolve;
    });
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('tokint-recents', 1);
      open.onupgradeneeded = () => { open.result.createObjectStore('tokens', { keyPath: 'key' }); open.result.createObjectStore('control'); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction('tokens', 'readwrite');
        tx.objectStore('tokens').put({ key: 'old-encrypted-row', record: sealed });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  });
  await page.reload(); await ready(page);
  assert.equal(await page.locator('input[type=password], dialog[open]').count(), 0);
  assert.equal(await page.locator('#rpc-preset').inputValue(), 'publicnode');
  state = await read(page);
  for (const key of ['vaultHeader', 'lastContract', 'theme']) assert.equal(state.local[key], undefined);
  assert.equal(state.session.tokintVaultSession, undefined);
  const newRow = { key: '0x0000000000000000000000000000000000000001:1:auto', contract: '0x0000000000000000000000000000000000000001', token: '1', method: 'auto', name: 'New cached token', visitedAt: Date.now() };
  const reset = await page.evaluate(async row => {
    const cache = await import(chrome.runtime.getURL('token-cache.js'));
    const before = await cache.readCache();
    await cache.rememberToken(row, before.epoch);
    return { before, after: await cache.readCache() };
  }, newRow);
  assert.deepEqual(reset.before.rows, []);
  assert.ok(reset.before.epoch >= 0);
  assert.deepEqual(reset.after.rows, [newRow]);
  pass('old encrypted settings and cache are discarded without a passphrase; new cache entries work immediately');
  await page.locator('#rpc-preset').selectOption('alchemy');
  await page.locator('#rpc-url').fill(endpoint); await page.locator('#remember-rpc').check(); await saved(page);
  await context.close(); await start();
  page = await pageAt('options.html'); await ready(page);
  assert.equal(await page.locator('#rpc-url').inputValue(), endpoint);
  assert.equal(await page.locator('#remember-rpc').isChecked(), true);
  const rows = await page.evaluate(async () => (await (await import(chrome.runtime.getURL('token-cache.js'))).readCache()).rows);
  assert.deepEqual(rows, [newRow]);
  pass('new preferences and cache survive restart after the old encrypted data is discarded');
  assert.deepEqual(errors, []);
  console.log(`${checks} storage/browser checks passed.`);
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
